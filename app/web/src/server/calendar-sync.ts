import { withTenantContext } from "./tenant-context";
import { getUsableAccessToken } from "./calendar-integration";
import {
  createGoogleCalendarEvent,
  updateGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
} from "../lib/google-calendar/client";
import { labelForLesson } from "./lesson-label";

/**
 * Best-effort, one-way sync (Pomateshe → Google, docs/CALENDAR.md §3) triggered after a lesson
 * is created, rescheduled, or has its status changed. "Best-effort" is not a figure of speech
 * here: every public function in this file swallows its own errors and never throws — a
 * Google outage, a rate limit, or simply no integration connected must never be the reason a
 * lesson create/reschedule in Pomateshe itself fails (docs/CALENDAR.md §4). Callers invoke
 * these from inside `after()` (next/server) at the Server Action layer, off the request path
 * entirely — see src/app/teacher/schedule/actions.ts and src/app/teacher/calendar/actions.ts.
 *
 * Deliberately NOT called for src/server/personal-events.ts — personal calendar events are
 * Pomateshe-only and fully private (docs/MULTI_TENANCY.md §4.4); nothing about them is ever
 * sent to Google.
 */

async function fetchLessonForSync(teacherId: string, lessonId: string) {
  return withTenantContext({ teacherId }, (tx) =>
    tx.lesson.findUnique({
      where: { id: lessonId },
      include: {
        studentLink: { select: { displayName: true, studentUser: { select: { email: true } } } },
        group: { select: { name: true } },
      },
    }),
  );
}

async function setCalendarEventId(teacherId: string, lessonId: string, calendarEventId: string | null) {
  await withTenantContext({ teacherId }, (tx) =>
    tx.lesson.updateMany({ where: { id: lessonId, teacherId }, data: { calendarEventId } }),
  );
}

export async function syncLessonToGoogleCalendar(teacherId: string, lessonId: string): Promise<void> {
  try {
    const usable = await getUsableAccessToken(teacherId);
    if (!usable) return; // Not connected, or disabled — nothing to do, silently.

    const lesson = await fetchLessonForSync(teacherId, lessonId);
    if (!lesson) return; // Raced with a delete/ownership change — nothing left to sync.

    if (lesson.status === "cancelled") {
      if (lesson.calendarEventId) {
        await deleteGoogleCalendarEvent(usable.accessToken, usable.calendarId, lesson.calendarEventId);
        await setCalendarEventId(teacherId, lessonId, null);
      }
      return;
    }

    // Only "scheduled" lessons get a live calendar event — a lesson that's "completed"/
    // "no_show" without ever having synced (e.g. it predates connecting Google) has nothing
    // useful to add to the teacher's calendar at this point; one that already has an event
    // from when it WAS scheduled just keeps that event as-is (nothing to update it to).
    if (lesson.status !== "scheduled") return;

    const startIso = lesson.scheduledAt.toISOString();
    const endIso = new Date(lesson.scheduledAt.getTime() + lesson.durationMinutes * 60_000).toISOString();
    const eventInput = { summary: labelForLesson(lesson), startIso, endIso, pomatesheLessonId: lesson.id };

    if (lesson.calendarEventId) {
      await updateGoogleCalendarEvent(usable.accessToken, usable.calendarId, lesson.calendarEventId, eventInput);
    } else {
      const googleEventId = await createGoogleCalendarEvent(usable.accessToken, usable.calendarId, eventInput);
      await setCalendarEventId(teacherId, lessonId, googleEventId);
    }
  } catch (err) {
    console.error(`[calendar-sync] best-effort sync failed for lesson ${lessonId}`, err);
  }
}

/**
 * Runs once, right after a teacher's first successful OAuth connect (docs/CALENDAR.md's
 * agreed scope: only future scheduled lessons are backfilled — past, cancelled, and completed
 * lessons are not retroactively pushed to a calendar the teacher has only just connected).
 * Sequential, not parallel — an MVP teacher's future lesson count is small, and a straight
 * loop keeps this readable without needing a concurrency limiter for what's a one-time,
 * off-the-request-path operation (called via `after()` from the OAuth callback route).
 */
export async function backfillFutureLessonsToGoogleCalendar(teacherId: string): Promise<void> {
  try {
    const lessons = await withTenantContext({ teacherId }, (tx) =>
      tx.lesson.findMany({
        where: {
          teacherId,
          status: "scheduled",
          scheduledAt: { gt: new Date() },
          calendarEventId: null,
        },
        select: { id: true },
      }),
    );
    for (const lesson of lessons) {
      await syncLessonToGoogleCalendar(teacherId, lesson.id);
    }
  } catch (err) {
    console.error(`[calendar-sync] backfill failed for teacher ${teacherId}`, err);
  }
}
