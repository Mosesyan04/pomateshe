import { describe, it, expect, afterAll } from "vitest";
import { registerTeacher, getStudentsForTeacher } from "../teachers";
import { createInvite, acceptInviteAsNewUser } from "../invites";
import { createLessonForStudent, updateLessonStatus, setLessonPaid } from "../lessons";
import { getTeacherDashboardOverview } from "../dashboard";
import { cleanupTestData } from "./test-helpers";
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

async function linkNewStudent(teacherId: string, label: string) {
  const invite = await createInvite(
    teacherId,
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
  );
  const { session } = await acceptInviteAsNewUser(invite.token, "student password 123456");
  const students = await getStudentsForTeacher(teacherId);
  const link = students.find((s) => s.status === "active")!;
  createdUserIds.push(link.studentUserId);
  return { link, sessionToken: session.token };
}

describe("Teacher dashboard overview", () => {
  it("upcoming lessons only includes future scheduled lessons, ordered soonest first", async () => {
    const teacher = await makeTeacher("dash-upcoming");
    const { link } = await linkNewStudent(teacher.teacherId, "dash-upcoming-student");

    const soon = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const later = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const lessonLater = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: later,
      durationMinutes: 60,
      priceCents: 100000,
    });
    const lessonSoon = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: soon,
      durationMinutes: 60,
      priceCents: 100000,
    });
    // A past "scheduled" lesson (never marked completed/cancelled) must not count as upcoming.
    await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: past,
      durationMinutes: 60,
      priceCents: 100000,
    });

    const overview = await getTeacherDashboardOverview(teacher.teacherId);
    expect(overview.upcomingLessons.map((l) => l.id)).toEqual([lessonSoon.id, lessonLater.id]);
  });

  it("a cancelled or no-show lesson never appears in upcomingLessons even if scheduled in the future", async () => {
    const teacher = await makeTeacher("dash-cancelled");
    const { link } = await linkNewStudent(teacher.teacherId, "dash-cancelled-student");

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const cancelled = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: future,
      durationMinutes: 60,
      priceCents: 100000,
    });
    await updateLessonStatus(teacher.teacherId, cancelled.id, "cancelled");

    const overview = await getTeacherDashboardOverview(teacher.teacherId);
    expect(overview.upcomingLessons.map((l) => l.id)).not.toContain(cancelled.id);
  });

  it("unpaidLessons only includes completed lessons with no paidAt", async () => {
    const teacher = await makeTeacher("dash-unpaid");
    const { link } = await linkNewStudent(teacher.teacherId, "dash-unpaid-student");

    const completedUnpaid = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(),
      durationMinutes: 60,
      priceCents: 150000,
    });
    await updateLessonStatus(teacher.teacherId, completedUnpaid.id, "completed");

    const completedPaid = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(),
      durationMinutes: 60,
      priceCents: 200000,
    });
    await updateLessonStatus(teacher.teacherId, completedPaid.id, "completed");
    await setLessonPaid(teacher.teacherId, completedPaid.id, true);

    const stillScheduled = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      durationMinutes: 60,
      priceCents: 90000,
    });

    const overview = await getTeacherDashboardOverview(teacher.teacherId);
    const unpaidIds = overview.unpaidLessons.map((l) => l.id);
    expect(unpaidIds).toContain(completedUnpaid.id);
    expect(unpaidIds).not.toContain(completedPaid.id);
    expect(unpaidIds).not.toContain(stillScheduled.id);
  });

  it("weekIncomeCents sums only lessons paid THIS week, not their scheduled date or lessons paid in a different week", async () => {
    const teacher = await makeTeacher("dash-income");
    const { link } = await linkNewStudent(teacher.teacherId, "dash-income-student");

    const paidThisWeek = await createLessonForStudent({
      teacherId: teacher.teacherId,
      // Scheduled a month ago, but paid just now — income should count by paidAt, not by
      // when the lesson itself happened.
      scheduledAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      studentLinkId: link.id,
      durationMinutes: 60,
      priceCents: 120000,
    });
    await setLessonPaid(teacher.teacherId, paidThisWeek.id, true);

    const overview = await getTeacherDashboardOverview(teacher.teacherId);
    expect(overview.weekIncomeCents).toBeGreaterThanOrEqual(120000);

    // An unpaid lesson contributes nothing.
    await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(),
      durationMinutes: 60,
      priceCents: 999999,
    });
    const overviewAfter = await getTeacherDashboardOverview(teacher.teacherId);
    expect(overviewAfter.weekIncomeCents).toBe(overview.weekIncomeCents);
  });

  it("a lesson paid in a past week does not count toward this week's income", async () => {
    const teacher = await makeTeacher("dash-income-past");
    const { link } = await linkNewStudent(teacher.teacherId, "dash-income-past-student");

    const lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(),
      durationMinutes: 60,
      priceCents: 555500,
    });

    // Directly backdate paidAt to well over a week ago — setLessonPaid always uses "now", so
    // this reaches into the DB directly to simulate a payment from a prior week.
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    await prisma.$executeRawUnsafe(
      `UPDATE lessons SET "paidAt" = $1 WHERE id = $2`,
      twoWeeksAgo,
      lesson.id,
    );

    const overview = await getTeacherDashboardOverview(teacher.teacherId);
    // The 555500 must not be included — can't assert an exact total (other tests in this
    // file may run against the same week), only that this specific amount isn't silently in it
    // when it's the only lesson this teacher has.
    expect(overview.weekIncomeCents).toBe(0);
  });

  it("never mixes one teacher's dashboard numbers with another's", async () => {
    const teacherA = await makeTeacher("dash-isolation-a");
    const teacherB = await makeTeacher("dash-isolation-b");
    const { link: linkA } = await linkNewStudent(teacherA.teacherId, "dash-isolation-student-a");

    const lessonA = await createLessonForStudent({
      teacherId: teacherA.teacherId,
      studentLinkId: linkA.id,
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      durationMinutes: 60,
      priceCents: 100000,
    });

    const overviewB = await getTeacherDashboardOverview(teacherB.teacherId);
    expect(overviewB.upcomingLessons.map((l) => l.id)).not.toContain(lessonA.id);
    expect(overviewB.weekIncomeCents).toBe(0);
  });
});
