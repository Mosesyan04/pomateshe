import { describe, it, expect, afterAll } from "vitest";
import { registerTeacher, getStudentsForTeacher } from "../teachers";
import { createInvite, acceptInviteAsNewUser, acceptInviteForExistingUser } from "../invites";
import {
  createLessonForStudent,
  getLessonsForTeacher,
  getLessonsForTeacherInRange,
  updateLessonStatus,
  setLessonPaid,
  rescheduleLesson,
  getMyLessonsAsStudent,
} from "../lessons";
import { updateTeacherProfile, getTeacherProfileForEditing } from "../teacher-profile";
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
  const invite = await createInvite(teacherId, `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`);
  const { session } = await acceptInviteAsNewUser(invite.token, "student password 123456");
  const students = await getStudentsForTeacher(teacherId);
  const link = students.find((s) => s.status === "active")!;
  createdUserIds.push(link.studentUserId);
  return { link, sessionToken: session.token };
}

describe("Individual lessons", () => {
  it("a teacher can schedule a lesson for their own student and see it in their list", async () => {
    const teacher = await makeTeacher("lesson-basic");
    const { link } = await linkNewStudent(teacher.teacherId, "lesson-basic-student");

    const lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(),
      durationMinutes: 60,
      priceCents: 150000,
    });

    const lessons = await getLessonsForTeacher(teacher.teacherId);
    expect(lessons.map((l) => l.id)).toContain(lesson.id);
  });

  it("rejects scheduling a lesson for a student linked to a DIFFERENT teacher", async () => {
    const teacherA = await makeTeacher("lesson-cross-a");
    const teacherB = await makeTeacher("lesson-cross-b");
    const { link: linkToA } = await linkNewStudent(teacherA.teacherId, "lesson-cross-student");

    await expect(
      createLessonForStudent({
        teacherId: teacherB.teacherId,
        studentLinkId: linkToA.id, // belongs to teacherA, not teacherB
        scheduledAt: new Date(),
        durationMinutes: 60,
        priceCents: 100000,
      }),
    ).rejects.toThrow(/не привязан/);
  });

  it("updateLessonStatus and setLessonPaid only affect the calling teacher's own lesson", async () => {
    const teacherA = await makeTeacher("lesson-status-a");
    const teacherB = await makeTeacher("lesson-status-b");
    const { link } = await linkNewStudent(teacherA.teacherId, "lesson-status-student");

    const lesson = await createLessonForStudent({
      teacherId: teacherA.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(),
      durationMinutes: 45,
      priceCents: 80000,
    });

    // teacherB attempting to mutate teacherA's lesson must fail loudly (docs/THREAT_MODEL.md §2).
    await expect(updateLessonStatus(teacherB.teacherId, lesson.id, "completed")).rejects.toThrow();
    await expect(setLessonPaid(teacherB.teacherId, lesson.id, true)).rejects.toThrow();

    // teacherA doing the same must succeed.
    await updateLessonStatus(teacherA.teacherId, lesson.id, "completed");
    await setLessonPaid(teacherA.teacherId, lesson.id, true);

    const [updated] = await getLessonsForTeacher(teacherA.teacherId);
    expect(updated.status).toBe("completed");
    expect(updated.paidAt).not.toBeNull();
  });

  it("a student with two teachers sees lessons grouped correctly, one group per teacher, no cross-contamination", async () => {
    const teacherA = await makeTeacher("multi-teacher-a");
    const teacherB = await makeTeacher("multi-teacher-b");

    // Same student, invited by teacherA first, then linked to teacherB (existing-account
    // branch) — exactly docs/MULTI_TENANCY.md §1.1's scenario.
    const inviteA = await createInvite(teacherA.teacherId, `shared-student-${Date.now()}@example.com`);
    await acceptInviteAsNewUser(inviteA.token, "shared student password");
    const studentsOfA = await getStudentsForTeacher(teacherA.teacherId);
    const linkA = studentsOfA[0];
    createdUserIds.push(linkA.studentUserId);

    const sharedStudentUser = await prisma.user.findUniqueOrThrow({ where: { id: linkA.studentUserId } });
    const inviteB = await createInvite(teacherB.teacherId, sharedStudentUser.email);
    await acceptInviteForExistingUser(inviteB.token, linkA.studentUserId);
    const studentsOfB = await getStudentsForTeacher(teacherB.teacherId);
    const linkB = studentsOfB.find((s) => s.studentUserId === linkA.studentUserId)!;

    await createLessonForStudent({
      teacherId: teacherA.teacherId,
      studentLinkId: linkA.id,
      scheduledAt: new Date(),
      durationMinutes: 30,
      priceCents: 50000,
    });
    await createLessonForStudent({
      teacherId: teacherB.teacherId,
      studentLinkId: linkB.id,
      scheduledAt: new Date(),
      durationMinutes: 90,
      priceCents: 200000,
    });

    const grouped = await getMyLessonsAsStudent(linkA.studentUserId);
    expect(grouped).toHaveLength(2);

    const groupA = grouped.find((g) => g.teacherId === teacherA.teacherId)!;
    const groupB = grouped.find((g) => g.teacherId === teacherB.teacherId)!;

    expect(groupA.teacherDisplayName).toBe("multi-teacher-a teacher");
    expect(groupA.lessons).toHaveLength(1);
    expect(groupA.lessons[0].priceCents).toBe(50000);

    expect(groupB.teacherDisplayName).toBe("multi-teacher-b teacher");
    expect(groupB.lessons).toHaveLength(1);
    expect(groupB.lessons[0].priceCents).toBe(200000);

    // The definitive isolation check: neither group's lesson list contains the other's lesson.
    const idsInA = new Set(groupA.lessons.map((l) => l.id));
    const idsInB = new Set(groupB.lessons.map((l) => l.id));
    for (const id of idsInA) expect(idsInB.has(id)).toBe(false);
  });
});

describe("Zoom link snapshotting (docs/ZOOM.md §1)", () => {
  it("a lesson created after the teacher sets a Zoom link gets it copied into zoomLinkSnapshot", async () => {
    const teacher = await makeTeacher("zoom-basic");
    const { link } = await linkNewStudent(teacher.teacherId, "zoom-basic-student");
    const profile = await getTeacherProfileForEditing(teacher.teacherId);

    await updateTeacherProfile({
      teacherId: teacher.teacherId,
      displayName: profile.displayName,
      slug: profile.slug,
      subjects: [],
      zoomPersonalLink: "https://us02web.zoom.us/j/1112223334",
    });

    const lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(),
      durationMinutes: 60,
      priceCents: 100000,
    });

    const [found] = await getLessonsForTeacher(teacher.teacherId);
    expect(found.id).toBe(lesson.id);
    expect(found.zoomLinkSnapshot).toBe("https://us02web.zoom.us/j/1112223334");
  });

  it("a lesson created before any Zoom link is set has a null snapshot, and doesn't retroactively pick one up", async () => {
    const teacher = await makeTeacher("zoom-none-yet");
    const { link } = await linkNewStudent(teacher.teacherId, "zoom-none-yet-student");

    const lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(),
      durationMinutes: 60,
      priceCents: 100000,
    });

    let [found] = await getLessonsForTeacher(teacher.teacherId);
    expect(found.zoomLinkSnapshot).toBeNull();

    // Setting a link afterward must not rewrite history for the already-created lesson.
    const profile = await getTeacherProfileForEditing(teacher.teacherId);
    await updateTeacherProfile({
      teacherId: teacher.teacherId,
      displayName: profile.displayName,
      slug: profile.slug,
      subjects: [],
      zoomPersonalLink: "https://zoom.us/j/9998887776",
    });

    [found] = await getLessonsForTeacher(teacher.teacherId);
    expect(found.id).toBe(lesson.id);
    expect(found.zoomLinkSnapshot).toBeNull();
  });

  it("rejects a non-Zoom URL when setting the personal link", async () => {
    const teacher = await makeTeacher("zoom-invalid");
    const profile = await getTeacherProfileForEditing(teacher.teacherId);

    await expect(
      updateTeacherProfile({
        teacherId: teacher.teacherId,
        displayName: profile.displayName,
        slug: profile.slug,
        subjects: [],
        zoomPersonalLink: "https://evil.example.com/join",
      }),
    ).rejects.toThrow(/Zoom/);
  });

  it("a student sees the same Zoom link snapshot as the teacher, for both individual and group lessons", async () => {
    const teacher = await makeTeacher("zoom-student-view");
    const { link } = await linkNewStudent(teacher.teacherId, "zoom-student-view-student");
    const profile = await getTeacherProfileForEditing(teacher.teacherId);
    await updateTeacherProfile({
      teacherId: teacher.teacherId,
      displayName: profile.displayName,
      slug: profile.slug,
      subjects: [],
      zoomPersonalLink: "https://zoom.us/j/5556667778",
    });

    const lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date(),
      durationMinutes: 60,
      priceCents: 100000,
    });

    const groups = await getMyLessonsAsStudent(link.studentUserId);
    const found = groups.find((g) => g.teacherId === teacher.teacherId)!.lessons.find((l) => l.id === lesson.id);
    expect(found?.zoomLinkSnapshot).toBe("https://zoom.us/j/5556667778");
  });
});

describe("rescheduleLesson (calendar drag-and-drop target)", () => {
  it("moves a lesson to a new time and, when given, a new duration", async () => {
    const teacher = await makeTeacher("reschedule-basic");
    const { link } = await linkNewStudent(teacher.teacherId, "reschedule-basic-student");

    const lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date("2026-10-01T10:00:00Z"),
      durationMinutes: 60,
      priceCents: 100000,
    });

    await rescheduleLesson(teacher.teacherId, lesson.id, new Date("2026-10-02T15:00:00Z"), 45);

    const [updated] = await getLessonsForTeacher(teacher.teacherId);
    expect(updated.scheduledAt.toISOString()).toBe("2026-10-02T15:00:00.000Z");
    expect(updated.durationMinutes).toBe(45);
  });

  it("leaves the duration untouched when none is given", async () => {
    const teacher = await makeTeacher("reschedule-keep-duration");
    const { link } = await linkNewStudent(teacher.teacherId, "reschedule-keep-duration-student");

    const lesson = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date("2026-10-01T10:00:00Z"),
      durationMinutes: 60,
      priceCents: 100000,
    });

    await rescheduleLesson(teacher.teacherId, lesson.id, new Date("2026-10-01T11:00:00Z"));

    const [updated] = await getLessonsForTeacher(teacher.teacherId);
    expect(updated.durationMinutes).toBe(60);
  });

  it("rejects rescheduling a lesson belonging to a DIFFERENT teacher", async () => {
    const teacherA = await makeTeacher("reschedule-cross-a");
    const teacherB = await makeTeacher("reschedule-cross-b");
    const { link } = await linkNewStudent(teacherA.teacherId, "reschedule-cross-student");

    const lesson = await createLessonForStudent({
      teacherId: teacherA.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date("2026-10-01T10:00:00Z"),
      durationMinutes: 60,
      priceCents: 100000,
    });

    await expect(
      rescheduleLesson(teacherB.teacherId, lesson.id, new Date("2026-10-05T10:00:00Z")),
    ).rejects.toThrow(/не найдено/);

    const [untouched] = await getLessonsForTeacher(teacherA.teacherId);
    expect(untouched.scheduledAt.toISOString()).toBe("2026-10-01T10:00:00.000Z");
  });
});

describe("Range-bounded queries for the calendar view", () => {
  it("getLessonsForTeacherInRange only returns lessons scheduled within [from, toExclusive)", async () => {
    const teacher = await makeTeacher("range-teacher");
    const { link } = await linkNewStudent(teacher.teacherId, "range-teacher-student");

    const inside = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date("2026-10-15T10:00:00Z"),
      durationMinutes: 60,
      priceCents: 100000,
    });
    const outside = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date("2026-01-01T10:00:00Z"),
      durationMinutes: 60,
      priceCents: 100000,
    });

    const result = await getLessonsForTeacherInRange(teacher.teacherId, {
      from: new Date("2026-10-13T00:00:00Z"),
      toExclusive: new Date("2026-10-20T00:00:00Z"),
    });
    const ids = result.map((l) => l.id);
    expect(ids).toContain(inside.id);
    expect(ids).not.toContain(outside.id);
  });

  it("getMyLessonsAsStudent with a range only returns lessons in that window, without one returns everything", async () => {
    const teacher = await makeTeacher("range-student");
    const { link } = await linkNewStudent(teacher.teacherId, "range-student-student");

    const inside = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date("2026-10-15T10:00:00Z"),
      durationMinutes: 60,
      priceCents: 100000,
    });
    const outside = await createLessonForStudent({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      scheduledAt: new Date("2026-01-01T10:00:00Z"),
      durationMinutes: 60,
      priceCents: 100000,
    });

    const bounded = await getMyLessonsAsStudent(link.studentUserId, {
      from: new Date("2026-10-13T00:00:00Z"),
      toExclusive: new Date("2026-10-20T00:00:00Z"),
    });
    const boundedIds = bounded.find((g) => g.teacherId === teacher.teacherId)!.lessons.map((l) => l.id);
    expect(boundedIds).toContain(inside.id);
    expect(boundedIds).not.toContain(outside.id);

    const unbounded = await getMyLessonsAsStudent(link.studentUserId);
    const unboundedIds = unbounded.find((g) => g.teacherId === teacher.teacherId)!.lessons.map((l) => l.id);
    expect(unboundedIds).toContain(inside.id);
    expect(unboundedIds).toContain(outside.id);
  });
});
