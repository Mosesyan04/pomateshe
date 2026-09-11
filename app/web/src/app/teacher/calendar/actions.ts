"use server";

import { redirect } from "next/navigation";
import { requireRole } from "../../../lib/auth/current-user";
import { rescheduleLesson } from "../../../server/lessons";
import {
  createPersonalEvent,
  reschedulePersonalEvent,
  deletePersonalEvent,
} from "../../../server/personal-events";

/** Called directly from the client grid (src/app/_components/calendar/time-grid.tsx /
 *  month-grid.tsx), not via a <form> — a Server Action invoked programmatically. Returns a
 *  result object rather than throwing so the client doesn't need to parse a serialized error;
 *  requireRole is still what actually enforces this is a teacher's own lesson, never the
 *  client-side `editable` flag on the dragged item. */
export async function rescheduleLessonFromCalendarAction(
  lessonId: string,
  newScheduledAtIso: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireRole("teacher");
  try {
    await rescheduleLesson(user.teacherId!, lessonId, new Date(newScheduledAtIso));
    return { ok: true };
  } catch {
    return { ok: false, error: "Не удалось перенести занятие." };
  }
}

export async function reschedulePersonalEventFromCalendarAction(
  eventId: string,
  newScheduledAtIso: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireRole("teacher");
  try {
    await reschedulePersonalEvent(user.userId, eventId, new Date(newScheduledAtIso));
    return { ok: true };
  } catch {
    return { ok: false, error: "Не удалось перенести событие." };
  }
}

export async function createPersonalEventAction(formData: FormData): Promise<void> {
  const user = await requireRole("teacher");
  const title = String(formData.get("title") ?? "").trim();
  const scheduledAtRaw = String(formData.get("scheduledAt") ?? "");
  const durationMinutes = Number(formData.get("durationMinutes"));

  if (!title || !scheduledAtRaw || !durationMinutes) {
    redirect("/teacher/calendar?error=missing_fields");
  }
  const scheduledAt = new Date(scheduledAtRaw);
  if (Number.isNaN(scheduledAt.getTime())) {
    redirect("/teacher/calendar?error=invalid_date");
  }

  await createPersonalEvent({ ownerUserId: user.userId, title, scheduledAt, durationMinutes });
  redirect("/teacher/calendar?created=1");
}

export async function deletePersonalEventAction(formData: FormData): Promise<void> {
  const user = await requireRole("teacher");
  const eventId = String(formData.get("eventId") ?? "");
  if (eventId) {
    await deletePersonalEvent(user.userId, eventId).catch(() => {});
  }
  redirect("/teacher/calendar?deleted=1");
}
