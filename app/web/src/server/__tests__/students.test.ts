import { describe, it, expect, afterAll } from "vitest";
import { registerTeacher, getStudentsForTeacher, getStudentLinkForTeacher, updateStudentLink } from "../teachers";
import { createInvite, acceptInviteAsNewUser } from "../invites";
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

describe("Student card fields", () => {
  it("a teacher can fill in and read back the full card for their own student", async () => {
    const teacher = await makeTeacher("card-basic");
    const { link } = await linkNewStudent(teacher.teacherId, "card-basic-student");

    await updateStudentLink({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      displayName: "Иванов Иван Иванович",
      subject: "Математика",
      gradeLevel: "9 класс",
      contactPhone: "+7 900 123-45-67",
      contactTelegram: "@ivanov",
      defaultPriceCents: 150000,
      defaultDurationMinutes: 60,
      notes: "Готовится к ОГЭ",
    });

    const updated = await getStudentLinkForTeacher(teacher.teacherId, link.id);
    expect(updated?.displayName).toBe("Иванов Иван Иванович");
    expect(updated?.subject).toBe("Математика");
    expect(updated?.gradeLevel).toBe("9 класс");
    expect(updated?.contactPhone).toBe("+7 900 123-45-67");
    expect(updated?.contactTelegram).toBe("@ivanov");
    expect(updated?.defaultPriceCents).toBe(150000);
    expect(updated?.defaultDurationMinutes).toBe(60);
    expect(updated?.notes).toBe("Готовится к ОГЭ");
  });

  it("rejects updating a student link that belongs to a DIFFERENT teacher", async () => {
    const teacherA = await makeTeacher("card-cross-a");
    const teacherB = await makeTeacher("card-cross-b");
    const { link } = await linkNewStudent(teacherA.teacherId, "card-cross-student");

    await expect(
      updateStudentLink({
        teacherId: teacherB.teacherId,
        studentLinkId: link.id,
        displayName: "Should not apply",
      }),
    ).rejects.toThrow();

    const untouched = await getStudentLinkForTeacher(teacherA.teacherId, link.id);
    expect(untouched?.displayName).not.toBe("Should not apply");
  });

  it("getStudentLinkForTeacher returns null for a link belonging to another teacher", async () => {
    const teacherA = await makeTeacher("card-lookup-a");
    const teacherB = await makeTeacher("card-lookup-b");
    const { link } = await linkNewStudent(teacherA.teacherId, "card-lookup-student");

    const result = await getStudentLinkForTeacher(teacherB.teacherId, link.id);
    expect(result).toBeNull();
  });
});

describe("Student filters", () => {
  it("filters by subject and gradeLevel", async () => {
    const teacher = await makeTeacher("filter-subject");
    const { link: link1 } = await linkNewStudent(teacher.teacherId, "filter-subject-student-1");
    const { link: link2 } = await linkNewStudent(teacher.teacherId, "filter-subject-student-2");

    await updateStudentLink({
      teacherId: teacher.teacherId,
      studentLinkId: link1.id,
      subject: "Математика",
      gradeLevel: "9 класс",
    });
    await updateStudentLink({
      teacherId: teacher.teacherId,
      studentLinkId: link2.id,
      subject: "Физика",
      gradeLevel: "11 класс",
    });

    const mathOnly = await getStudentsForTeacher(teacher.teacherId, { subject: "Математика" });
    expect(mathOnly.map((s) => s.id)).toEqual([link1.id]);

    const grade11Only = await getStudentsForTeacher(teacher.teacherId, { gradeLevel: "11 класс" });
    expect(grade11Only.map((s) => s.id)).toEqual([link2.id]);
  });

  it("filters by price and duration ranges", async () => {
    const teacher = await makeTeacher("filter-range");
    const { link: cheap } = await linkNewStudent(teacher.teacherId, "filter-range-cheap");
    const { link: pricey } = await linkNewStudent(teacher.teacherId, "filter-range-pricey");

    await updateStudentLink({
      teacherId: teacher.teacherId,
      studentLinkId: cheap.id,
      defaultPriceCents: 100000,
      defaultDurationMinutes: 45,
    });
    await updateStudentLink({
      teacherId: teacher.teacherId,
      studentLinkId: pricey.id,
      defaultPriceCents: 300000,
      defaultDurationMinutes: 90,
    });

    const underTwoThousand = await getStudentsForTeacher(teacher.teacherId, { priceMaxCents: 200000 });
    expect(underTwoThousand.map((s) => s.id)).toEqual([cheap.id]);

    const longLessonsOnly = await getStudentsForTeacher(teacher.teacherId, { durationMinMinutes: 60 });
    expect(longLessonsOnly.map((s) => s.id)).toEqual([pricey.id]);
  });

  it("search matches displayName, contactPhone, and contactTelegram (case-insensitive)", async () => {
    const teacher = await makeTeacher("filter-search");
    const { link } = await linkNewStudent(teacher.teacherId, "filter-search-student");

    await updateStudentLink({
      teacherId: teacher.teacherId,
      studentLinkId: link.id,
      displayName: "Петрова Мария",
      contactTelegram: "@mpetrova",
    });

    const byName = await getStudentsForTeacher(teacher.teacherId, { search: "петров" });
    expect(byName.map((s) => s.id)).toContain(link.id);

    const byTelegram = await getStudentsForTeacher(teacher.teacherId, { search: "MPETROVA" });
    expect(byTelegram.map((s) => s.id)).toContain(link.id);

    const noMatch = await getStudentsForTeacher(teacher.teacherId, { search: "nonexistent-xyz" });
    expect(noMatch.map((s) => s.id)).not.toContain(link.id);
  });

  it("filters never cross into another teacher's students", async () => {
    const teacherA = await makeTeacher("filter-cross-a");
    const teacherB = await makeTeacher("filter-cross-b");
    const { link: linkA } = await linkNewStudent(teacherA.teacherId, "filter-cross-student-a");
    const { link: linkB } = await linkNewStudent(teacherB.teacherId, "filter-cross-student-b");

    await updateStudentLink({ teacherId: teacherA.teacherId, studentLinkId: linkA.id, subject: "Химия" });
    await updateStudentLink({ teacherId: teacherB.teacherId, studentLinkId: linkB.id, subject: "Химия" });

    const teacherAResults = await getStudentsForTeacher(teacherA.teacherId, { subject: "Химия" });
    expect(teacherAResults.map((s) => s.id)).toEqual([linkA.id]);
  });
});
