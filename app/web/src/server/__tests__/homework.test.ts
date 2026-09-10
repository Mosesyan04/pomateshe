import { describe, it, expect, afterAll } from "vitest";
import { registerTeacher, getStudentsForTeacher } from "../teachers";
import { createInvite, acceptInviteAsNewUser } from "../invites";
import { createLessonForStudent } from "../lessons";
import {
  createHomework,
  getHomeworkForTeacher,
  getMaterialFileForAccess,
  getMyHomeworkAsStudent,
} from "../homework";
import { cleanupTestData } from "./test-helpers";
import { prisma } from "../db";

const createdUserIds: string[] = [];

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
const NOT_AN_IMAGE = Buffer.from("this is a text file pretending to be a photo");

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

describe("Homework", () => {
  it("a teacher can create homework for their own student and see it in their list", async () => {
    const teacher = await makeTeacher("hw-basic");
    const { link } = await linkNewStudent(teacher.teacherId, "hw-basic-student");

    const homework = await createHomework({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      title: "Разобрать 5 упражнений",
      description: "Стр. 12-14",
      uploaderUserId: teacher.userId,
    });

    const list = await getHomeworkForTeacher(teacher.teacherId);
    expect(list.map((h) => h.id)).toContain(homework.id);
  });

  it("rejects homework for a student linked to a DIFFERENT teacher", async () => {
    const teacherA = await makeTeacher("hw-cross-a");
    const teacherB = await makeTeacher("hw-cross-b");
    const { link: linkToA } = await linkNewStudent(teacherA.teacherId, "hw-cross-student");

    await expect(
      createHomework({
        teacherId: teacherB.teacherId,
        studentLinkId: linkToA.id, // belongs to teacherA, not teacherB
        title: "Should not be created",
        uploaderUserId: teacherB.userId,
      }),
    ).rejects.toThrow(/не привязан/);
  });

  it("rejects a lessonId belonging to a different teacher", async () => {
    const teacherA = await makeTeacher("hw-lesson-a");
    const teacherB = await makeTeacher("hw-lesson-b");
    const { link: linkA } = await linkNewStudent(teacherA.teacherId, "hw-lesson-student-a");
    const { link: linkB } = await linkNewStudent(teacherB.teacherId, "hw-lesson-student-b");

    const lessonOfA = await createLessonForStudent({
      teacherId: teacherA.teacherId,
      studentLinkId: linkA.id,
      scheduledAt: new Date(),
      durationMinutes: 60,
      priceCents: 100000,
    });

    await expect(
      createHomework({
        teacherId: teacherB.teacherId,
        studentLinkId: linkB.id,
        lessonId: lessonOfA.id, // belongs to teacherA
        title: "Should not be created",
        uploaderUserId: teacherB.userId,
      }),
    ).rejects.toThrow(/Занятие не найдено/);
  });

  it("filters homework by studentLinkId", async () => {
    const teacher = await makeTeacher("hw-filter");
    const { link: link1 } = await linkNewStudent(teacher.teacherId, "hw-filter-student-1");
    const { link: link2 } = await linkNewStudent(teacher.teacherId, "hw-filter-student-2");

    const hw1 = await createHomework({
      teacherId: teacher.teacherId,
      studentLinkId: link1.id,
      title: "For student 1",
      uploaderUserId: teacher.userId,
    });
    const hw2 = await createHomework({
      teacherId: teacher.teacherId,
      studentLinkId: link2.id,
      title: "For student 2",
      uploaderUserId: teacher.userId,
    });

    const forStudent1 = await getHomeworkForTeacher(teacher.teacherId, link1.id);
    expect(forStudent1.map((h) => h.id)).toContain(hw1.id);
    expect(forStudent1.map((h) => h.id)).not.toContain(hw2.id);
  });

  it("rejects a photo whose magic bytes don't match jpeg/png/webp", async () => {
    const teacher = await makeTeacher("hw-bad-photo");
    const { link } = await linkNewStudent(teacher.teacherId, "hw-bad-photo-student");

    await expect(
      createHomework({
        teacherId: teacher.teacherId,
        studentLinkId: link.id,
        title: "Has a fake photo",
        uploaderUserId: teacher.userId,
        photo: { originalFileName: "totally-a-photo.jpg", data: NOT_AN_IMAGE },
      }),
    ).rejects.toThrow(/не распознан/);
  });

  it("attaches a valid photo, and only the owning teacher (or the assigned student) can access it", async () => {
    const teacherA = await makeTeacher("hw-photo-a");
    const teacherB = await makeTeacher("hw-photo-b");
    const { link } = await linkNewStudent(teacherA.teacherId, "hw-photo-student");

    const homework = await createHomework({
      teacherId: teacherA.teacherId,
      studentLinkId: link.id,
      title: "With a photo",
      uploaderUserId: teacherA.userId,
      photo: { originalFileName: "board.png", data: PNG_BYTES },
    });

    const [withPhoto] = await getHomeworkForTeacher(teacherA.teacherId, link.id);
    expect(withPhoto.id).toBe(homework.id);
    expect(withPhoto.materialFiles).toHaveLength(1);
    const fileId = withPhoto.materialFiles[0].id;
    expect(withPhoto.materialFiles[0].mimeType).toBe("image/png");

    // Owning teacher: allowed.
    const ownerAccess = await getMaterialFileForAccess(fileId, teacherA.teacherId, {
      role: "teacher",
      teacherId: teacherA.teacherId,
    });
    expect(ownerAccess.allowed).toBe(true);

    // A different teacher: denied, even if they somehow knew teacherA's id and the file id.
    const otherTeacherAccess = await getMaterialFileForAccess(fileId, teacherA.teacherId, {
      role: "teacher",
      teacherId: teacherB.teacherId,
    });
    expect(otherTeacherAccess.allowed).toBe(false);

    // The assigned student: allowed.
    const assignedStudentAccess = await getMaterialFileForAccess(fileId, teacherA.teacherId, {
      role: "student",
      studentUserId: link.studentUserId,
    });
    expect(assignedStudentAccess.allowed).toBe(true);

    // A different student (not the assignee, and not even teacherA's student): denied.
    const { link: unrelatedLink } = await linkNewStudent(teacherB.teacherId, "hw-photo-unrelated-student");
    const strangerAccess = await getMaterialFileForAccess(fileId, teacherA.teacherId, {
      role: "student",
      studentUserId: unrelatedLink.studentUserId,
    });
    expect(strangerAccess.allowed).toBe(false);
  });

  it("a student with two teachers sees homework grouped correctly, no cross-contamination", async () => {
    const teacherA = await makeTeacher("hw-multi-a");
    const teacherB = await makeTeacher("hw-multi-b");
    const { link: linkA } = await linkNewStudent(teacherA.teacherId, "hw-multi-student");

    await createHomework({
      teacherId: teacherA.teacherId,
      studentLinkId: linkA.id,
      title: "From teacher A",
      uploaderUserId: teacherA.userId,
    });

    const sharedStudentUser = await prisma.user.findUniqueOrThrow({ where: { id: linkA.studentUserId } });
    const inviteB = await createInvite(teacherB.teacherId, sharedStudentUser.email);
    const { acceptInviteForExistingUser } = await import("../invites");
    await acceptInviteForExistingUser(inviteB.token, linkA.studentUserId);
    const studentsOfB = await getStudentsForTeacher(teacherB.teacherId);
    const linkB = studentsOfB.find((s) => s.studentUserId === linkA.studentUserId)!;

    await createHomework({
      teacherId: teacherB.teacherId,
      studentLinkId: linkB.id,
      title: "From teacher B",
      uploaderUserId: teacherB.userId,
    });

    const grouped = await getMyHomeworkAsStudent(linkA.studentUserId);
    expect(grouped).toHaveLength(2);

    const groupA = grouped.find((g) => g.teacherId === teacherA.teacherId)!;
    const groupB = grouped.find((g) => g.teacherId === teacherB.teacherId)!;

    expect(groupA.homework.map((h) => h.title)).toEqual(["From teacher A"]);
    expect(groupB.homework.map((h) => h.title)).toEqual(["From teacher B"]);
  });
});
