import { describe, it, expect, afterAll } from "vitest";
import { registerTeacher, getStudentsForTeacher } from "../teachers";
import { createInvite, acceptInviteAsNewUser } from "../invites";
import {
  createGroup,
  getGroupsForTeacher,
  addStudentToGroup,
  removeStudentFromGroup,
  archiveGroup,
} from "../groups";
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

describe("Groups", () => {
  it("a teacher can create a group, add students, and see them in the roster", async () => {
    const teacher = await makeTeacher("group-basic");
    const { link: link1 } = await linkNewStudent(teacher.teacherId, "group-basic-1");
    const { link: link2 } = await linkNewStudent(teacher.teacherId, "group-basic-2");

    const group = await createGroup(teacher.teacherId, "Группа А");
    await addStudentToGroup(teacher.teacherId, group.id, link1.id);
    await addStudentToGroup(teacher.teacherId, group.id, link2.id);

    const groups = await getGroupsForTeacher(teacher.teacherId);
    const found = groups.find((g) => g.id === group.id)!;
    expect(found.members.map((m) => m.studentLinkId).sort()).toEqual([link1.id, link2.id].sort());
  });

  it("rejects adding a student who belongs to a DIFFERENT teacher", async () => {
    const teacherA = await makeTeacher("group-cross-a");
    const teacherB = await makeTeacher("group-cross-b");
    const { link } = await linkNewStudent(teacherA.teacherId, "group-cross-student");

    const groupB = await createGroup(teacherB.teacherId, "Group B");
    await expect(addStudentToGroup(teacherB.teacherId, groupB.id, link.id)).rejects.toThrow(
      /не привязан/,
    );
  });

  it("rejects adding to a group that belongs to a DIFFERENT teacher", async () => {
    const teacherA = await makeTeacher("group-ownership-a");
    const teacherB = await makeTeacher("group-ownership-b");
    const { link } = await linkNewStudent(teacherB.teacherId, "group-ownership-student");
    const groupA = await createGroup(teacherA.teacherId, "Group A");

    await expect(addStudentToGroup(teacherB.teacherId, groupA.id, link.id)).rejects.toThrow(
      /Группа не найдена/,
    );
  });

  it("removing a student sets leftAt and they no longer appear in the roster, but can be re-added", async () => {
    const teacher = await makeTeacher("group-remove");
    const { link } = await linkNewStudent(teacher.teacherId, "group-remove-student");
    const group = await createGroup(teacher.teacherId, "Removable group");

    await addStudentToGroup(teacher.teacherId, group.id, link.id);
    let groups = await getGroupsForTeacher(teacher.teacherId);
    expect(groups.find((g) => g.id === group.id)!.members).toHaveLength(1);

    await removeStudentFromGroup(teacher.teacherId, group.id, link.id);
    groups = await getGroupsForTeacher(teacher.teacherId);
    expect(groups.find((g) => g.id === group.id)!.members).toHaveLength(0);

    // Re-adding must revive the same row (unique constraint), not throw.
    await addStudentToGroup(teacher.teacherId, group.id, link.id);
    groups = await getGroupsForTeacher(teacher.teacherId);
    expect(groups.find((g) => g.id === group.id)!.members).toHaveLength(1);
  });

  it("archiving a group hides it from getGroupsForTeacher", async () => {
    const teacher = await makeTeacher("group-archive");
    const group = await createGroup(teacher.teacherId, "Archivable group");

    let groups = await getGroupsForTeacher(teacher.teacherId);
    expect(groups.map((g) => g.id)).toContain(group.id);

    await archiveGroup(teacher.teacherId, group.id);
    groups = await getGroupsForTeacher(teacher.teacherId);
    expect(groups.map((g) => g.id)).not.toContain(group.id);
  });

  it("a teacher only ever sees their own groups", async () => {
    const teacherA = await makeTeacher("group-isolation-a");
    const teacherB = await makeTeacher("group-isolation-b");
    const groupA = await createGroup(teacherA.teacherId, "A's group");
    const groupB = await createGroup(teacherB.teacherId, "B's group");

    const groupsOfA = await getGroupsForTeacher(teacherA.teacherId);
    expect(groupsOfA.map((g) => g.id)).toContain(groupA.id);
    expect(groupsOfA.map((g) => g.id)).not.toContain(groupB.id);
  });
});
