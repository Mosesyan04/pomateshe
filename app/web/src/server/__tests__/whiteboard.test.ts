import { describe, it, expect, afterAll } from "vitest";
import { registerTeacher, getStudentsForTeacher } from "../teachers";
import { createInvite, acceptInviteAsNewUser } from "../invites";
import { createGroup, addStudentToGroup, removeStudentFromGroup } from "../groups";
import { createLessonForStudent, createLessonForGroup } from "../lessons";
import { resolveWhiteboardForTeacher, resolveWhiteboardForStudent, ACCESS_BUFFER_MINUTES } from "../whiteboard";
import { withTenantContext } from "../tenant-context";
import { cleanupTestData } from "./test-helpers";
import { prisma } from "../db";

/** whiteboards has RLS — a plain prisma.whiteboard.findMany() with no tenant context set
 *  fails closed (0 rows), same as every other tenant table. Route verification queries
 *  through the teacher's own context, like the rest of the codebase does. */
function boardsForTeacher(teacherId: string) {
  return withTenantContext({ teacherId }, (tx) => tx.whiteboard.findMany({ where: { teacherId } }));
}

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
  const invite = await createInvite(teacherId, `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`);
  const { session } = await acceptInviteAsNewUser(invite.token, "student password 123456");
  const students = await getStudentsForTeacher(teacherId);
  const link = students.find((s) => s.status === "active")!;
  createdUserIds.push(link.studentUserId);
  return { link, sessionToken: session.token };
}

// A fixed "now" so window-boundary math is deterministic, not flaky against wall-clock time.
const NOW = new Date("2026-10-06T10:00:00.000Z");
const LESSON_DURATION_MIN = 60;

function lessonAt(offsetMinutesFromNow: number): Date {
  return new Date(NOW.getTime() + offsetMinutesFromNow * 60_000);
}

describe("resolveWhiteboardForTeacher — individual lessons", () => {
  it("grants access inside the lesson's window and creates the board", async () => {
    const teacher = await makeTeacher("wb-teacher-basic");
    const { link } = await linkNewStudent(teacher.teacherId, "wb-teacher-basic-student");
    const lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: lessonAt(0),
      durationMinutes: LESSON_DURATION_MIN,
      priceCents: 100000,
    });

    const result = await resolveWhiteboardForTeacher(teacher.teacherId, lesson.id, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.teacherId).toBe(teacher.teacherId);
  });

  it("the SAME board is reused across two different lessons for the same student (series continuity)", async () => {
    const teacher = await makeTeacher("wb-teacher-series");
    const { link } = await linkNewStudent(teacher.teacherId, "wb-teacher-series-student");
    const lessonA = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: lessonAt(0),
      durationMinutes: LESSON_DURATION_MIN,
      priceCents: 100000,
    });
    const lessonB = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: lessonAt(0), // a second "lesson" happening at the same fixed NOW, for test simplicity
      durationMinutes: LESSON_DURATION_MIN,
      priceCents: 100000,
    });

    const resultA = await resolveWhiteboardForTeacher(teacher.teacherId, lessonA.id, NOW);
    const resultB = await resolveWhiteboardForTeacher(teacher.teacherId, lessonB.id, NOW);
    expect(resultA.ok && resultB.ok).toBe(true);
    if (resultA.ok && resultB.ok) {
      expect(resultB.whiteboardId).toBe(resultA.whiteboardId);
    }

    const boards = await boardsForTeacher(teacher.teacherId);
    expect(boards).toHaveLength(1); // not two, despite two resolve calls for two different lessons
  });

  it("rejects a lesson before the access window opens, with the correct availableFrom", async () => {
    const teacher = await makeTeacher("wb-teacher-early");
    const { link } = await linkNewStudent(teacher.teacherId, "wb-teacher-early-student");
    const scheduledAt = lessonAt(60); // starts an hour from NOW
    const lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt,
      durationMinutes: LESSON_DURATION_MIN,
      priceCents: 100000,
    });

    const result = await resolveWhiteboardForTeacher(teacher.teacherId, lesson.id, NOW);
    expect(result).toEqual({
      ok: false,
      reason: "outside_window",
      availableFrom: new Date(scheduledAt.getTime() - ACCESS_BUFFER_MINUTES * 60_000),
    });
  });

  it("rejects a lesson well after it ended", async () => {
    const teacher = await makeTeacher("wb-teacher-late");
    const { link } = await linkNewStudent(teacher.teacherId, "wb-teacher-late-student");
    const lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: lessonAt(-180), // ended 2 hours ago (60 min lesson)
      durationMinutes: LESSON_DURATION_MIN,
      priceCents: 100000,
    });

    const result = await resolveWhiteboardForTeacher(teacher.teacherId, lesson.id, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("outside_window");
  });

  it("accepts right at the inclusive edges of the window", async () => {
    const teacher = await makeTeacher("wb-teacher-edge");
    const { link } = await linkNewStudent(teacher.teacherId, "wb-teacher-edge-student");
    const scheduledAt = lessonAt(0);
    const lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt,
      durationMinutes: LESSON_DURATION_MIN,
      priceCents: 100000,
    });

    const windowStart = new Date(scheduledAt.getTime() - ACCESS_BUFFER_MINUTES * 60_000);
    const windowEnd = new Date(scheduledAt.getTime() + LESSON_DURATION_MIN * 60_000 + ACCESS_BUFFER_MINUTES * 60_000);

    expect((await resolveWhiteboardForTeacher(teacher.teacherId, lesson.id, windowStart)).ok).toBe(true);
    expect((await resolveWhiteboardForTeacher(teacher.teacherId, lesson.id, windowEnd)).ok).toBe(true);
    expect(
      (await resolveWhiteboardForTeacher(teacher.teacherId, lesson.id, new Date(windowStart.getTime() - 1))).ok,
    ).toBe(false);
    expect(
      (await resolveWhiteboardForTeacher(teacher.teacherId, lesson.id, new Date(windowEnd.getTime() + 1))).ok,
    ).toBe(false);
  });

  it("rejects a lesson belonging to a DIFFERENT teacher", async () => {
    const teacherA = await makeTeacher("wb-teacher-cross-a");
    const teacherB = await makeTeacher("wb-teacher-cross-b");
    const { link } = await linkNewStudent(teacherA.teacherId, "wb-teacher-cross-student");
    const lesson = await createLessonForStudent({
      teacherId: teacherA.teacherId,
      studentLinkId: link.id,
      scheduledAt: lessonAt(0),
      durationMinutes: LESSON_DURATION_MIN,
      priceCents: 100000,
    });

    const result = await resolveWhiteboardForTeacher(teacherB.teacherId, lesson.id, NOW);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("resolveWhiteboardForTeacher — group lessons", () => {
  it("the SAME board is reused across two different lessons for the same group", async () => {
    const teacher = await makeTeacher("wb-group-series");
    const { link } = await linkNewStudent(teacher.teacherId, "wb-group-series-student");
    const group = await createGroup(teacher.teacherId, "WB Group");
    await addStudentToGroup(teacher.teacherId, group.id, link.id);

    const lessonA = await createLessonForGroup({
      teacherId: teacher.teacherId,
      groupId: group.id,
      scheduledAt: lessonAt(0),
      durationMinutes: LESSON_DURATION_MIN,
      priceCents: 400000,
    });
    const lessonB = await createLessonForGroup({
      teacherId: teacher.teacherId,
      groupId: group.id,
      scheduledAt: lessonAt(0),
      durationMinutes: LESSON_DURATION_MIN,
      priceCents: 400000,
    });

    const resultA = await resolveWhiteboardForTeacher(teacher.teacherId, lessonA.id, NOW);
    const resultB = await resolveWhiteboardForTeacher(teacher.teacherId, lessonB.id, NOW);
    expect(resultA.ok && resultB.ok).toBe(true);
    if (resultA.ok && resultB.ok) expect(resultB.whiteboardId).toBe(resultA.whiteboardId);
  });

  it("an individual-lesson board and a group-lesson board for the same teacher never collide", async () => {
    const teacher = await makeTeacher("wb-mixed");
    const { link } = await linkNewStudent(teacher.teacherId, "wb-mixed-student");
    const group = await createGroup(teacher.teacherId, "WB Mixed Group");
    await addStudentToGroup(teacher.teacherId, group.id, link.id);

    const individualLesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: lessonAt(0),
      durationMinutes: LESSON_DURATION_MIN,
      priceCents: 100000,
    });
    const groupLesson = await createLessonForGroup({
      teacherId: teacher.teacherId,
      groupId: group.id,
      scheduledAt: lessonAt(0),
      durationMinutes: LESSON_DURATION_MIN,
      priceCents: 400000,
    });

    const individualResult = await resolveWhiteboardForTeacher(teacher.teacherId, individualLesson.id, NOW);
    const groupResult = await resolveWhiteboardForTeacher(teacher.teacherId, groupLesson.id, NOW);
    expect(individualResult.ok && groupResult.ok).toBe(true);
    if (individualResult.ok && groupResult.ok) {
      expect(individualResult.whiteboardId).not.toBe(groupResult.whiteboardId);
    }

    const boards = await boardsForTeacher(teacher.teacherId);
    expect(boards).toHaveLength(2);
  });
});

describe("resolveWhiteboardForStudent", () => {
  it("grants the student the SAME board id the teacher gets for the same lesson", async () => {
    const teacher = await makeTeacher("wb-student-basic");
    const { link } = await linkNewStudent(teacher.teacherId, "wb-student-basic-student");
    const lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: lessonAt(0),
      durationMinutes: LESSON_DURATION_MIN,
      priceCents: 100000,
    });

    const teacherResult = await resolveWhiteboardForTeacher(teacher.teacherId, lesson.id, NOW);
    const studentResult = await resolveWhiteboardForStudent(link.studentUserId, lesson.id, NOW);
    expect(teacherResult.ok && studentResult.ok).toBe(true);
    if (teacherResult.ok && studentResult.ok) {
      expect(studentResult.whiteboardId).toBe(teacherResult.whiteboardId);
    }
  });

  it("rejects a student who isn't linked to this lesson's teacher at all", async () => {
    const teacherA = await makeTeacher("wb-student-cross-a");
    const teacherB = await makeTeacher("wb-student-cross-b");
    const { link: linkA } = await linkNewStudent(teacherA.teacherId, "wb-student-cross-student-a");
    const { link: linkB } = await linkNewStudent(teacherB.teacherId, "wb-student-cross-student-b");
    const lesson = await createLessonForStudent({
      teacherId: teacherA.teacherId,
      studentLinkId: linkA.id,
      scheduledAt: lessonAt(0),
      durationMinutes: LESSON_DURATION_MIN,
      priceCents: 100000,
    });

    const result = await resolveWhiteboardForStudent(linkB.studentUserId, lesson.id, NOW);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects a DIFFERENT student of the SAME teacher for someone else's individual lesson", async () => {
    const teacher = await makeTeacher("wb-student-sibling");
    const { link: linkA } = await linkNewStudent(teacher.teacherId, "wb-student-sibling-a");
    const { link: linkB } = await linkNewStudent(teacher.teacherId, "wb-student-sibling-b");
    const lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: linkA.id,
      scheduledAt: lessonAt(0),
      durationMinutes: LESSON_DURATION_MIN,
      priceCents: 100000,
    });

    const result = await resolveWhiteboardForStudent(linkB.studentUserId, lesson.id, NOW);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("grants an active group member access to the group's board", async () => {
    const teacher = await makeTeacher("wb-student-group");
    const { link } = await linkNewStudent(teacher.teacherId, "wb-student-group-student");
    const group = await createGroup(teacher.teacherId, "WB Student Group");
    await addStudentToGroup(teacher.teacherId, group.id, link.id);
    const lesson = await createLessonForGroup({
      teacherId: teacher.teacherId,
      groupId: group.id,
      scheduledAt: lessonAt(0),
      durationMinutes: LESSON_DURATION_MIN,
      priceCents: 400000,
    });

    const result = await resolveWhiteboardForStudent(link.studentUserId, lesson.id, NOW);
    expect(result.ok).toBe(true);
  });

  it("rejects a student who was removed from the group before requesting access", async () => {
    const teacher = await makeTeacher("wb-student-removed");
    const { link } = await linkNewStudent(teacher.teacherId, "wb-student-removed-student");
    const group = await createGroup(teacher.teacherId, "WB Removed Group");
    await addStudentToGroup(teacher.teacherId, group.id, link.id);
    const lesson = await createLessonForGroup({
      teacherId: teacher.teacherId,
      groupId: group.id,
      scheduledAt: lessonAt(0),
      durationMinutes: LESSON_DURATION_MIN,
      priceCents: 400000,
    });

    await removeStudentFromGroup(teacher.teacherId, group.id, link.id);

    const result = await resolveWhiteboardForStudent(link.studentUserId, lesson.id, NOW);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects the student outside the lesson's access window, same as the teacher path", async () => {
    const teacher = await makeTeacher("wb-student-window");
    const { link } = await linkNewStudent(teacher.teacherId, "wb-student-window-student");
    const lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: lessonAt(120),
      durationMinutes: LESSON_DURATION_MIN,
      priceCents: 100000,
    });

    const result = await resolveWhiteboardForStudent(link.studentUserId, lesson.id, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("outside_window");
  });
});
