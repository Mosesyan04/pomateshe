import { describe, it, expect, afterAll, vi } from "vitest";
import { registerTeacher, getStudentsForTeacher } from "../teachers";
import { createInvite, acceptInviteAsNewUser } from "../invites";
import {
  createLessonForStudent,
  getLessonsForTeacher,
  rescheduleLesson,
  updateLessonStatus,
} from "../lessons";
import { saveCalendarIntegration } from "../calendar-integration";
import { syncLessonToGoogleCalendar, backfillFutureLessonsToGoogleCalendar } from "../calendar-sync";
import { cleanupTestData } from "./test-helpers";
import { prisma } from "../db";

vi.mock("../../lib/google-calendar/client", () => ({
  createGoogleCalendarEvent: vi.fn(),
  updateGoogleCalendarEvent: vi.fn(),
  deleteGoogleCalendarEvent: vi.fn(),
  refreshGoogleAccessToken: vi.fn(),
}));
import {
  createGoogleCalendarEvent,
  updateGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
} from "../../lib/google-calendar/client";
const createMock = vi.mocked(createGoogleCalendarEvent);
const updateMock = vi.mocked(updateGoogleCalendarEvent);
const deleteMock = vi.mocked(deleteGoogleCalendarEvent);

const createdUserIds: string[] = [];

afterAll(async () => {
  await cleanupTestData(createdUserIds);
  await prisma.$disconnect();
});

async function makeTeacher(label: string) {
  const t = await registerTeacher({
    email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: "correct horse battery staple",
    displayName: `${label} teacher`,
    slug: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timezone: "Europe/Moscow",
  });
  createdUserIds.push(t.userId);
  return t;
}

async function linkNewStudent(teacherId: string, label: string) {
  const invite = await createInvite(
    teacherId,
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
  );
  await acceptInviteAsNewUser(invite.token, "student password 123456");
  const students = await getStudentsForTeacher(teacherId);
  const link = students.find((s) => s.status === "active")!;
  createdUserIds.push(link.studentUserId);
  return link;
}

async function connectCalendar(teacherId: string) {
  await saveCalendarIntegration(teacherId, {
    accessToken: "at",
    refreshToken: "rt",
    expiresAt: new Date(Date.now() + 3600_000), // far from expiry — refreshGoogleAccessToken must never be needed here
  });
}

async function findLesson(teacherId: string, lessonId: string) {
  const lessons = await getLessonsForTeacher(teacherId);
  return lessons.find((l) => l.id === lessonId)!;
}

describe("syncLessonToGoogleCalendar", () => {
  it("does nothing when the teacher has no Google Calendar connected", async () => {
    createMock.mockClear();
    const teacher = await makeTeacher("sync-unconnected");
    const link = await linkNewStudent(teacher.teacherId, "sync-unconnected-student");
    const lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(Date.now() + 86_400_000),
      durationMinutes: 60,
      priceCents: 100000,
    });

    await syncLessonToGoogleCalendar(teacher.teacherId, lesson.id);

    expect(createMock).not.toHaveBeenCalled();
    expect((await findLesson(teacher.teacherId, lesson.id)).calendarEventId).toBeNull();
  });

  it("creates a Google event for a newly-scheduled lesson and stores the returned id", async () => {
    createMock.mockReset();
    createMock.mockResolvedValueOnce("gcal-created-1");

    const teacher = await makeTeacher("sync-create");
    await connectCalendar(teacher.teacherId);
    const link = await linkNewStudent(teacher.teacherId, "sync-create-student");
    const lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(Date.now() + 86_400_000),
      durationMinutes: 60,
      priceCents: 100000,
    });

    await syncLessonToGoogleCalendar(teacher.teacherId, lesson.id);

    expect(createMock).toHaveBeenCalledTimes(1);
    const [accessToken, calendarId, eventInput] = createMock.mock.calls[0];
    expect(accessToken).toBe("at");
    expect(calendarId).toBe("primary");
    expect(eventInput.pomatesheLessonId).toBe(lesson.id);
    expect((await findLesson(teacher.teacherId, lesson.id)).calendarEventId).toBe("gcal-created-1");
  });

  it("updates the existing Google event (not create-again) when rescheduled", async () => {
    createMock.mockReset();
    updateMock.mockReset();
    createMock.mockResolvedValueOnce("gcal-reschedule-1");
    updateMock.mockResolvedValueOnce(undefined);

    const teacher = await makeTeacher("sync-reschedule");
    await connectCalendar(teacher.teacherId);
    const link = await linkNewStudent(teacher.teacherId, "sync-reschedule-student");
    const lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(Date.now() + 86_400_000),
      durationMinutes: 60,
      priceCents: 100000,
    });
    await syncLessonToGoogleCalendar(teacher.teacherId, lesson.id); // creates

    await rescheduleLesson(teacher.teacherId, lesson.id, new Date(Date.now() + 2 * 86_400_000));
    await syncLessonToGoogleCalendar(teacher.teacherId, lesson.id); // should update

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledTimes(1);
    const [, , googleEventId] = updateMock.mock.calls[0];
    expect(googleEventId).toBe("gcal-reschedule-1");
    expect((await findLesson(teacher.teacherId, lesson.id)).calendarEventId).toBe("gcal-reschedule-1");
  });

  it("deletes the Google event and clears calendarEventId when a synced lesson is cancelled", async () => {
    createMock.mockReset();
    deleteMock.mockReset();
    createMock.mockResolvedValueOnce("gcal-cancel-1");
    deleteMock.mockResolvedValueOnce(undefined);

    const teacher = await makeTeacher("sync-cancel");
    await connectCalendar(teacher.teacherId);
    const link = await linkNewStudent(teacher.teacherId, "sync-cancel-student");
    const lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(Date.now() + 86_400_000),
      durationMinutes: 60,
      priceCents: 100000,
    });
    await syncLessonToGoogleCalendar(teacher.teacherId, lesson.id); // creates gcal-cancel-1

    await updateLessonStatus(teacher.teacherId, lesson.id, "cancelled");
    await syncLessonToGoogleCalendar(teacher.teacherId, lesson.id);

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deleteMock.mock.calls[0][2]).toBe("gcal-cancel-1");
    expect((await findLesson(teacher.teacherId, lesson.id)).calendarEventId).toBeNull();
  });

  it("does nothing when a lesson is cancelled before it ever had a Google event", async () => {
    createMock.mockReset();
    deleteMock.mockReset();

    const teacher = await makeTeacher("sync-cancel-unsynced");
    await connectCalendar(teacher.teacherId);
    const link = await linkNewStudent(teacher.teacherId, "sync-cancel-unsynced-student");
    const lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(Date.now() + 86_400_000),
      durationMinutes: 60,
      priceCents: 100000,
    });
    await updateLessonStatus(teacher.teacherId, lesson.id, "cancelled");
    await syncLessonToGoogleCalendar(teacher.teacherId, lesson.id);

    expect(deleteMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("leaves a completed/no-show lesson alone (never creates an event for it)", async () => {
    createMock.mockReset();

    const teacher = await makeTeacher("sync-completed");
    await connectCalendar(teacher.teacherId);
    const link = await linkNewStudent(teacher.teacherId, "sync-completed-student");
    const lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(Date.now() - 86_400_000), // in the past
      durationMinutes: 60,
      priceCents: 100000,
    });
    await updateLessonStatus(teacher.teacherId, lesson.id, "completed");
    await syncLessonToGoogleCalendar(teacher.teacherId, lesson.id);

    expect(createMock).not.toHaveBeenCalled();
    expect((await findLesson(teacher.teacherId, lesson.id)).calendarEventId).toBeNull();
  });

  it("never throws even when the Google API call itself fails (best-effort)", async () => {
    createMock.mockReset();
    createMock.mockRejectedValueOnce(new Error("Google is down"));

    const teacher = await makeTeacher("sync-failure");
    await connectCalendar(teacher.teacherId);
    const link = await linkNewStudent(teacher.teacherId, "sync-failure-student");
    const lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(Date.now() + 86_400_000),
      durationMinutes: 60,
      priceCents: 100000,
    });

    await expect(syncLessonToGoogleCalendar(teacher.teacherId, lesson.id)).resolves.toBeUndefined();
    expect((await findLesson(teacher.teacherId, lesson.id)).calendarEventId).toBeNull();
  });
});

describe("backfillFutureLessonsToGoogleCalendar", () => {
  it("syncs only future scheduled lessons without an existing calendarEventId", async () => {
    createMock.mockReset();
    createMock.mockResolvedValue("gcal-backfill");

    const teacher = await makeTeacher("backfill-basic");
    const link = await linkNewStudent(teacher.teacherId, "backfill-basic-student");

    const future = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(Date.now() + 86_400_000),
      durationMinutes: 60,
      priceCents: 100000,
    });
    const past = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(Date.now() - 86_400_000),
      durationMinutes: 60,
      priceCents: 100000,
    });
    const cancelledFuture = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(Date.now() + 172_800_000),
      durationMinutes: 60,
      priceCents: 100000,
    });
    await updateLessonStatus(teacher.teacherId, cancelledFuture.id, "cancelled");

    // Connect AFTER creating the lessons above, matching the real "first connect" flow —
    // saveCalendarIntegration must not itself trigger any sync.
    await connectCalendar(teacher.teacherId);
    await backfillFutureLessonsToGoogleCalendar(teacher.teacherId);

    expect(createMock).toHaveBeenCalledTimes(1);
    expect((await findLesson(teacher.teacherId, future.id)).calendarEventId).toBe("gcal-backfill");
    expect((await findLesson(teacher.teacherId, past.id)).calendarEventId).toBeNull();
    expect((await findLesson(teacher.teacherId, cancelledFuture.id)).calendarEventId).toBeNull();
  });

  it("skips a future lesson that already has a calendarEventId", async () => {
    createMock.mockReset();
    createMock.mockResolvedValueOnce("gcal-already-synced").mockResolvedValueOnce("gcal-should-not-happen");

    const teacher = await makeTeacher("backfill-already-synced");
    await connectCalendar(teacher.teacherId);
    const link = await linkNewStudent(teacher.teacherId, "backfill-already-synced-student");
    const lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(Date.now() + 86_400_000),
      durationMinutes: 60,
      priceCents: 100000,
    });
    await syncLessonToGoogleCalendar(teacher.teacherId, lesson.id); // pre-syncs it once

    createMock.mockClear();
    await backfillFutureLessonsToGoogleCalendar(teacher.teacherId);

    expect(createMock).not.toHaveBeenCalled();
  });

  it("never throws even if one lesson's sync fails mid-backfill", async () => {
    createMock.mockReset();
    createMock.mockRejectedValueOnce(new Error("transient failure")).mockResolvedValueOnce("gcal-second");

    const teacher = await makeTeacher("backfill-partial-failure");
    const link = await linkNewStudent(teacher.teacherId, "backfill-partial-failure-student");
    const first = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(Date.now() + 86_400_000),
      durationMinutes: 60,
      priceCents: 100000,
    });
    const second = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(Date.now() + 172_800_000),
      durationMinutes: 60,
      priceCents: 100000,
    });
    await connectCalendar(teacher.teacherId);

    await expect(backfillFutureLessonsToGoogleCalendar(teacher.teacherId)).resolves.toBeUndefined();

    const lessons = await Promise.all([
      findLesson(teacher.teacherId, first.id),
      findLesson(teacher.teacherId, second.id),
    ]);
    // One of the two failed to get an id (order not guaranteed to match array order beyond
    // insertion — both were created and iterated in creation order), but the important part is
    // the backfill as a whole never throws and doesn't stop processing after one failure.
    const withIds = lessons.filter((l) => l.calendarEventId != null);
    expect(withIds).toHaveLength(1);
  });
});
