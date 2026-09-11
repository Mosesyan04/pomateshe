import { describe, it, expect, afterAll } from "vitest";
import { registerTeacher, getStudentsForTeacher } from "../teachers";
import { createInvite, acceptInviteAsNewUser } from "../invites";
import { createGroup, addStudentToGroup, removeStudentFromGroup } from "../groups";
import {
  createLessonForGroup,
  getLessonsForTeacher,
  getMyLessonsAsStudent,
  updateLessonStatus,
  setLessonPaid,
  rescheduleLesson,
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

describe("Group lessons", () => {
  it("a teacher can schedule a lesson for a group and it appears in their list with the group name", async () => {
    const teacher = await makeTeacher("grouplesson-basic");
    const { link } = await linkNewStudent(teacher.teacherId, "grouplesson-basic-student");
    const group = await createGroup(teacher.teacherId, "Group basic");
    await addStudentToGroup(teacher.teacherId, group.id, link.id);

    const lesson = await createLessonForGroup({
      teacherId: teacher.teacherId,
      groupId: group.id,
      scheduledAt: new Date(),
      durationMinutes: 90,
      priceCents: 400000,
    });

    const lessons = await getLessonsForTeacher(teacher.teacherId);
    const found = lessons.find((l) => l.id === lesson.id)!;
    expect(found.group?.name).toBe("Group basic");
    expect(found.studentLinkId).toBeNull();
  });

  it("rejects scheduling a lesson for a group belonging to a DIFFERENT teacher", async () => {
    const teacherA = await makeTeacher("grouplesson-cross-a");
    const teacherB = await makeTeacher("grouplesson-cross-b");
    const groupA = await createGroup(teacherA.teacherId, "A's group");

    await expect(
      createLessonForGroup({
        teacherId: teacherB.teacherId,
        groupId: groupA.id,
        scheduledAt: new Date(),
        durationMinutes: 60,
        priceCents: 100000,
      }),
    ).rejects.toThrow(/не найдена/);
  });

  it("rejects scheduling a lesson for an archived group", async () => {
    const teacher = await makeTeacher("grouplesson-archived");
    const group = await createGroup(teacher.teacherId, "Soon archived");
    const { archiveGroup } = await import("../groups");
    await archiveGroup(teacher.teacherId, group.id);

    await expect(
      createLessonForGroup({
        teacherId: teacher.teacherId,
        groupId: group.id,
        scheduledAt: new Date(),
        durationMinutes: 60,
        priceCents: 100000,
      }),
    ).rejects.toThrow(/не найдена|архивирована/);
  });

  it("updateLessonStatus and setLessonPaid work on a group lesson exactly like an individual one", async () => {
    const teacher = await makeTeacher("grouplesson-status");
    const group = await createGroup(teacher.teacherId, "Status group");
    const lesson = await createLessonForGroup({
      teacherId: teacher.teacherId,
      groupId: group.id,
      scheduledAt: new Date(),
      durationMinutes: 60,
      priceCents: 250000,
    });

    await updateLessonStatus(teacher.teacherId, lesson.id, "completed");
    await setLessonPaid(teacher.teacherId, lesson.id, true);

    const [updated] = await getLessonsForTeacher(teacher.teacherId);
    expect(updated.status).toBe("completed");
    expect(updated.paidAt).not.toBeNull();
  });

  it("a student who is a member of the group sees the group lesson on their own schedule", async () => {
    const teacher = await makeTeacher("grouplesson-student-view");
    const { link } = await linkNewStudent(teacher.teacherId, "grouplesson-student-view-student");
    const group = await createGroup(teacher.teacherId, "Visible group");
    await addStudentToGroup(teacher.teacherId, group.id, link.id);

    const lesson = await createLessonForGroup({
      teacherId: teacher.teacherId,
      groupId: group.id,
      scheduledAt: new Date(),
      durationMinutes: 60,
      priceCents: 300000,
    });

    const groups = await getMyLessonsAsStudent(link.studentUserId);
    const teacherGroup = groups.find((g) => g.teacherId === teacher.teacherId)!;
    const found = teacherGroup.lessons.find((l) => l.id === lesson.id);
    expect(found).toBeDefined();
    expect(found!.groupName).toBe("Visible group");
  });

  it("a group lesson snapshots the teacher's Zoom link too, visible to a group member", async () => {
    const teacher = await makeTeacher("grouplesson-zoom");
    const { link } = await linkNewStudent(teacher.teacherId, "grouplesson-zoom-student");
    const group = await createGroup(teacher.teacherId, "Zoom group");
    await addStudentToGroup(teacher.teacherId, group.id, link.id);

    const profile = await getTeacherProfileForEditing(teacher.teacherId);
    await updateTeacherProfile({
      teacherId: teacher.teacherId,
      displayName: profile.displayName,
      slug: profile.slug,
      subjects: [],
      zoomPersonalLink: "https://zoom.us/j/4443332221",
    });

    const lesson = await createLessonForGroup({
      teacherId: teacher.teacherId,
      groupId: group.id,
      scheduledAt: new Date(),
      durationMinutes: 60,
      priceCents: 100000,
    });

    const [teacherSideLesson] = await getLessonsForTeacher(teacher.teacherId);
    expect(teacherSideLesson.zoomLinkSnapshot).toBe("https://zoom.us/j/4443332221");

    const groups = await getMyLessonsAsStudent(link.studentUserId);
    const found = groups.find((g) => g.teacherId === teacher.teacherId)!.lessons.find((l) => l.id === lesson.id);
    expect(found?.zoomLinkSnapshot).toBe("https://zoom.us/j/4443332221");
  });

  it("a student removed from the group no longer sees NEW group lessons created after they left", async () => {
    const teacher = await makeTeacher("grouplesson-left");
    const { link } = await linkNewStudent(teacher.teacherId, "grouplesson-left-student");
    const group = await createGroup(teacher.teacherId, "Left group");
    await addStudentToGroup(teacher.teacherId, group.id, link.id);
    await removeStudentFromGroup(teacher.teacherId, group.id, link.id);

    const lesson = await createLessonForGroup({
      teacherId: teacher.teacherId,
      groupId: group.id,
      scheduledAt: new Date(),
      durationMinutes: 60,
      priceCents: 300000,
    });

    const groups = await getMyLessonsAsStudent(link.studentUserId);
    const teacherGroup = groups.find((g) => g.teacherId === teacher.teacherId);
    const found = teacherGroup?.lessons.find((l) => l.id === lesson.id);
    expect(found).toBeUndefined();
  });

  it("a student in one teacher's group does not see another teacher's group lessons", async () => {
    const teacherA = await makeTeacher("grouplesson-isolation-a");
    const teacherB = await makeTeacher("grouplesson-isolation-b");
    const { link: linkA } = await linkNewStudent(teacherA.teacherId, "grouplesson-isolation-student");
    const groupA = await createGroup(teacherA.teacherId, "Isolation group A");
    await addStudentToGroup(teacherA.teacherId, groupA.id, linkA.id);
    await createLessonForGroup({
      teacherId: teacherA.teacherId,
      groupId: groupA.id,
      scheduledAt: new Date(),
      durationMinutes: 60,
      priceCents: 100000,
    });

    // teacherB's group lessons must never leak into linkA's view, even though linkA has no
    // relationship to teacherB at all.
    const groups = await getMyLessonsAsStudent(linkA.studentUserId);
    expect(groups.find((g) => g.teacherId === teacherB.teacherId)).toBeUndefined();
  });

  it("rescheduling a group lesson moves it for every member in one action — there's only ever one row to move", async () => {
    const teacher = await makeTeacher("grouplesson-reschedule");
    const { link: link1 } = await linkNewStudent(teacher.teacherId, "grouplesson-reschedule-1");
    const { link: link2 } = await linkNewStudent(teacher.teacherId, "grouplesson-reschedule-2");
    const group = await createGroup(teacher.teacherId, "Reschedule group");
    await addStudentToGroup(teacher.teacherId, group.id, link1.id);
    await addStudentToGroup(teacher.teacherId, group.id, link2.id);

    const lesson = await createLessonForGroup({
      teacherId: teacher.teacherId,
      groupId: group.id,
      scheduledAt: new Date("2026-10-01T10:00:00Z"),
      durationMinutes: 60,
      priceCents: 200000,
    });

    await rescheduleLesson(teacher.teacherId, lesson.id, new Date("2026-10-03T14:00:00Z"));

    const [teacherSide] = await getLessonsForTeacher(teacher.teacherId);
    expect(teacherSide.scheduledAt.toISOString()).toBe("2026-10-03T14:00:00.000Z");

    for (const link of [link1, link2]) {
      const groups = await getMyLessonsAsStudent(link.studentUserId);
      const found = groups.find((g) => g.teacherId === teacher.teacherId)!.lessons.find((l) => l.id === lesson.id);
      expect(found?.scheduledAt.toISOString()).toBe("2026-10-03T14:00:00.000Z");
    }
  });
});
