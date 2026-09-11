import { describe, it, expect, afterAll } from "vitest";
import { registerTeacher, getStudentsForTeacher } from "../teachers";
import { createInvite, acceptInviteAsNewUser } from "../invites";
import {
  createPersonalEvent,
  getPersonalEventsForUser,
  reschedulePersonalEvent,
  deletePersonalEvent,
} from "../personal-events";
import { cleanupTestData, rawAppPool } from "./test-helpers";
import { prisma } from "../db";

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

async function makeStudentUser(teacherId: string, label: string): Promise<string> {
  const invite = await createInvite(
    teacherId,
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
  );
  await acceptInviteAsNewUser(invite.token, "student password 123456");
  const students = await getStudentsForTeacher(teacherId);
  const link = students.find((s) => s.status === "active")!;
  createdUserIds.push(link.studentUserId);
  return link.studentUserId;
}

describe("Personal calendar events", () => {
  it("a teacher can create, list, reschedule, and delete their own event", async () => {
    const teacher = await makeTeacher("pev-teacher-basic");

    const created = await createPersonalEvent({
      ownerUserId: teacher.userId,
      title: "Занят — своя учёба",
      scheduledAt: new Date("2026-10-01T10:00:00Z"),
      durationMinutes: 60,
    });

    let events = await getPersonalEventsForUser(teacher.userId, {
      from: new Date("2026-09-30T00:00:00Z"),
      toExclusive: new Date("2026-10-02T00:00:00Z"),
    });
    expect(events.map((e) => e.id)).toContain(created.id);

    await reschedulePersonalEvent(teacher.userId, created.id, new Date("2026-10-01T14:00:00Z"), 90);
    events = await getPersonalEventsForUser(teacher.userId, {
      from: new Date("2026-09-30T00:00:00Z"),
      toExclusive: new Date("2026-10-02T00:00:00Z"),
    });
    const rescheduled = events.find((e) => e.id === created.id)!;
    expect(rescheduled.scheduledAt.toISOString()).toBe("2026-10-01T14:00:00.000Z");
    expect(rescheduled.durationMinutes).toBe(90);

    await deletePersonalEvent(teacher.userId, created.id);
    events = await getPersonalEventsForUser(teacher.userId, {
      from: new Date("2026-09-30T00:00:00Z"),
      toExclusive: new Date("2026-10-02T00:00:00Z"),
    });
    expect(events.map((e) => e.id)).not.toContain(created.id);
  });

  it("a student can create and manage their own personal events the same way", async () => {
    const teacher = await makeTeacher("pev-student-owner");
    const studentUserId = await makeStudentUser(teacher.teacherId, "pev-student-owner-student");

    const created = await createPersonalEvent({
      ownerUserId: studentUserId,
      title: "Секция плавания",
      scheduledAt: new Date("2026-10-05T16:00:00Z"),
      durationMinutes: 45,
    });

    const events = await getPersonalEventsForUser(studentUserId, {
      from: new Date("2026-10-04T00:00:00Z"),
      toExclusive: new Date("2026-10-06T00:00:00Z"),
    });
    expect(events.map((e) => e.id)).toContain(created.id);
  });

  it("one user's events are completely invisible to another user, teacher or student", async () => {
    const teacherA = await makeTeacher("pev-isolation-a");
    const teacherB = await makeTeacher("pev-isolation-b");

    const eventA = await createPersonalEvent({
      ownerUserId: teacherA.userId,
      title: "A's private event",
      scheduledAt: new Date("2026-11-01T09:00:00Z"),
      durationMinutes: 30,
    });

    const eventsSeenByB = await getPersonalEventsForUser(teacherB.userId, {
      from: new Date("2026-10-31T00:00:00Z"),
      toExclusive: new Date("2026-11-02T00:00:00Z"),
    });
    expect(eventsSeenByB.map((e) => e.id)).not.toContain(eventA.id);
  });

  it("rejects rescheduling/deleting another user's event as a tampering attempt", async () => {
    const teacherA = await makeTeacher("pev-tamper-a");
    const teacherB = await makeTeacher("pev-tamper-b");

    const eventA = await createPersonalEvent({
      ownerUserId: teacherA.userId,
      title: "A's event",
      scheduledAt: new Date("2026-11-10T09:00:00Z"),
      durationMinutes: 30,
    });

    await expect(
      reschedulePersonalEvent(teacherB.userId, eventA.id, new Date("2026-11-11T09:00:00Z")),
    ).rejects.toThrow(/не найдено/);
    await expect(deletePersonalEvent(teacherB.userId, eventA.id)).rejects.toThrow(/не найдено/);

    // Confirm it's genuinely untouched, not just that the calling function threw.
    const stillThere = await getPersonalEventsForUser(teacherA.userId, {
      from: new Date("2026-11-09T00:00:00Z"),
      toExclusive: new Date("2026-11-12T00:00:00Z"),
    });
    expect(stillThere.map((e) => e.id)).toContain(eventA.id);
  });

  it("the raw app-role connection with NO context set cannot see personal_calendar_events at all (RLS itself, not just app code)", async () => {
    const teacher = await makeTeacher("pev-raw-sql");
    await createPersonalEvent({
      ownerUserId: teacher.userId,
      title: "Should not be visible with no context",
      scheduledAt: new Date("2026-12-01T09:00:00Z"),
      durationMinutes: 30,
    });

    const { rows } = await rawAppPool.query<{ count: string }>(
      `SELECT count(*)::text FROM personal_calendar_events WHERE "ownerUserId" = $1`,
      [teacher.userId],
    );
    expect(rows[0].count).toBe("0");
  });
});
