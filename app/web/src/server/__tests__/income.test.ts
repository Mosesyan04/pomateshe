import { describe, it, expect, afterAll } from "vitest";
import { registerTeacher, getStudentsForTeacher } from "../teachers";
import { createInvite, acceptInviteAsNewUser } from "../invites";
import { createLessonForStudent, updateLessonStatus, setLessonPaid } from "../lessons";
import { getIncomeOverview } from "../income";
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

function utcDay(offsetDays: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}

describe("getIncomeOverview", () => {
  it("splits scheduled/paid/unpaid totals correctly and lists every record in the period", async () => {
    const teacher = await makeTeacher("income-basic");
    const { link } = await linkNewStudent(teacher.teacherId, "income-basic-student");

    const paidLesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: utcDay(0),
      durationMinutes: 60,
      priceCents: 150000,
    });
    await setLessonPaid(teacher.teacherId, paidLesson.id, true);

    const unpaidLesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: utcDay(0),
      durationMinutes: 60,
      priceCents: 90000,
    });

    const from = utcDay(-3);
    const toExclusive = utcDay(3);
    const overview = await getIncomeOverview(teacher.teacherId, from, toExclusive);

    expect(overview.scheduledCents).toBe(150000 + 90000);
    expect(overview.paidCents).toBe(150000);
    expect(overview.unpaidCents).toBe(90000);
    expect(overview.records.map((r) => r.id).sort()).toEqual([paidLesson.id, unpaidLesson.id].sort());
  });

  it("excludes lessons scheduled outside the requested period", async () => {
    const teacher = await makeTeacher("income-outside");
    const { link } = await linkNewStudent(teacher.teacherId, "income-outside-student");

    const insideLesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: utcDay(0),
      durationMinutes: 60,
      priceCents: 100000,
    });
    const outsideLesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: utcDay(-100),
      durationMinutes: 60,
      priceCents: 999999,
    });

    const overview = await getIncomeOverview(teacher.teacherId, utcDay(-5), utcDay(5));
    const ids = overview.records.map((r) => r.id);
    expect(ids).toContain(insideLesson.id);
    expect(ids).not.toContain(outsideLesson.id);
    expect(overview.scheduledCents).toBe(100000);
  });

  it("the 'to' boundary is exclusive — a lesson scheduled exactly on 'to' is not included", async () => {
    const teacher = await makeTeacher("income-boundary");
    const { link } = await linkNewStudent(teacher.teacherId, "income-boundary-student");
    const toExclusive = utcDay(2);

    const onBoundary = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: toExclusive, // exactly at the exclusive boundary
      durationMinutes: 60,
      priceCents: 100000,
    });

    const overview = await getIncomeOverview(teacher.teacherId, utcDay(-1), toExclusive);
    expect(overview.records.map((r) => r.id)).not.toContain(onBoundary.id);
  });

  it("the chart has one point per calendar day in range, including zero-income days, and sums correctly per day", async () => {
    const teacher = await makeTeacher("income-chart");
    const { link } = await linkNewStudent(teacher.teacherId, "income-chart-student");

    const day0Lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: utcDay(0),
      durationMinutes: 60,
      priceCents: 100000,
    });
    await setLessonPaid(teacher.teacherId, day0Lesson.id, true);

    const from = utcDay(-2);
    const toExclusive = utcDay(3); // 5 calendar days: -2, -1, 0, 1, 2
    const overview = await getIncomeOverview(teacher.teacherId, from, toExclusive);

    expect(overview.chart).toHaveLength(5);
    const day0Key = utcDay(0).toISOString().slice(0, 10);
    const day0Point = overview.chart.find((p) => p.date === day0Key)!;
    expect(day0Point.paidCents).toBe(100000);
    // Every other day has zero income but still exists as a point.
    const otherDays = overview.chart.filter((p) => p.date !== day0Key);
    expect(otherDays.every((p) => p.paidCents === 0)).toBe(true);
  });

  it("a completed-but-unpaid lesson and a cancelled lesson are both still listed as records with correct totals", async () => {
    const teacher = await makeTeacher("income-statuses");
    const { link } = await linkNewStudent(teacher.teacherId, "income-statuses-student");

    const completed = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: utcDay(0),
      durationMinutes: 60,
      priceCents: 100000,
    });
    await updateLessonStatus(teacher.teacherId, completed.id, "completed");

    const cancelled = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: utcDay(0),
      durationMinutes: 60,
      priceCents: 200000,
    });
    await updateLessonStatus(teacher.teacherId, cancelled.id, "cancelled");

    const overview = await getIncomeOverview(teacher.teacherId, utcDay(-1), utcDay(1));
    const record = (id: string) => overview.records.find((r) => r.id === id);
    expect(record(completed.id)?.status).toBe("completed");
    expect(record(cancelled.id)?.status).toBe("cancelled");
    // Cancelled lessons still count toward "scheduled" totals here — this page shows the full
    // record, it doesn't quietly drop cancelled entries from the sums.
    expect(overview.scheduledCents).toBe(300000);
  });

  it("never mixes one teacher's income records with another's", async () => {
    const teacherA = await makeTeacher("income-isolation-a");
    const teacherB = await makeTeacher("income-isolation-b");
    const { link: linkA } = await linkNewStudent(teacherA.teacherId, "income-isolation-student-a");

    const lessonA = await createLessonForStudent({
      teacherId: teacherA.teacherId,
      studentLinkId: linkA.id,
      scheduledAt: utcDay(0),
      durationMinutes: 60,
      priceCents: 500000,
    });
    await setLessonPaid(teacherA.teacherId, lessonA.id, true);

    const overviewB = await getIncomeOverview(teacherB.teacherId, utcDay(-1), utcDay(1));
    expect(overviewB.records.map((r) => r.id)).not.toContain(lessonA.id);
    expect(overviewB.paidCents).toBe(0);
  });
});
