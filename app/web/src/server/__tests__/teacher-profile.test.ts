import { describe, it, expect, afterAll } from "vitest";
import { registerTeacher } from "../teachers";
import {
  getPublicTeacherProfile,
  getTeacherProfileForEditing,
  updateTeacherProfile,
} from "../teacher-profile";
import { cleanupTestData, rawAppPool } from "./test-helpers";
import { prisma } from "../db";

const createdUserIds: string[] = [];

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);

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

describe("Public teacher profile", () => {
  it("getPublicTeacherProfile finds a teacher by slug with NO tenant context set", async () => {
    const teacher = await makeTeacher("pub-basic");
    const editable = await getTeacherProfileForEditing(teacher.teacherId);

    const publicProfile = await getPublicTeacherProfile(editable.slug);
    expect(publicProfile).not.toBeNull();
    expect(publicProfile!.displayName).toBe(editable.displayName);
  });

  it("returns null for an unknown slug rather than throwing", async () => {
    const result = await getPublicTeacherProfile(`nonexistent-slug-${Date.now()}`);
    expect(result).toBeNull();
  });

  it("the raw app-role connection with zero context can SELECT teacher_profiles (public_read policy)", async () => {
    const teacher = await makeTeacher("pub-raw-sql");
    const { rows } = await rawAppPool.query<{ id: string }>(
      `SELECT id FROM teacher_profiles WHERE id = $1`,
      [teacher.teacherId],
    );
    // No app.current_teacher_id was ever set on this connection — if this returns the row,
    // it's the public_read policy (FOR SELECT USING (true)) doing it, not tenant context.
    expect(rows).toHaveLength(1);
  });

  it("updateTeacherProfile changes displayName/bio/subjects and is reflected publicly", async () => {
    const teacher = await makeTeacher("pub-update");
    const editable = await getTeacherProfileForEditing(teacher.teacherId);

    await updateTeacherProfile({
      teacherId: teacher.teacherId,
      displayName: "Updated Name",
      slug: editable.slug,
      bio: "New bio text",
      subjects: ["Математика", "Физика"],
      contactInfo: "Telegram: @example",
      defaultLessonPriceCents: 150000,
    });

    const publicProfile = await getPublicTeacherProfile(editable.slug);
    expect(publicProfile!.displayName).toBe("Updated Name");
    expect(publicProfile!.bio).toBe("New bio text");
    expect(publicProfile!.subjects).toEqual(["Математика", "Физика"]);
    expect(publicProfile!.contactInfo).toBe("Telegram: @example");
    expect(publicProfile!.defaultLessonPriceCents).toBe(150000);
  });

  it("rejects a non-image avatar upload (bad magic bytes)", async () => {
    const teacher = await makeTeacher("pub-bad-avatar");
    const editable = await getTeacherProfileForEditing(teacher.teacherId);

    await expect(
      updateTeacherProfile({
        teacherId: teacher.teacherId,
        displayName: editable.displayName,
        slug: editable.slug,
        subjects: [],
        avatar: { data: Buffer.from("not an image") },
      }),
    ).rejects.toThrow(/не распознан/);
  });

  it("accepts a valid avatar and exposes an avatarUrl on the public profile", async () => {
    const teacher = await makeTeacher("pub-good-avatar");
    const editable = await getTeacherProfileForEditing(teacher.teacherId);

    await updateTeacherProfile({
      teacherId: teacher.teacherId,
      displayName: editable.displayName,
      slug: editable.slug,
      subjects: [],
      avatar: { data: PNG_BYTES },
    });

    const publicProfile = await getPublicTeacherProfile(editable.slug);
    expect(publicProfile!.avatarUrl).toBe(`/api/public/avatars/${teacher.teacherId}`);
  });

  it("a teacher cannot steal another teacher's slug", async () => {
    const teacherA = await makeTeacher("pub-slug-a");
    const teacherB = await makeTeacher("pub-slug-b");
    const editableA = await getTeacherProfileForEditing(teacherA.teacherId);
    const editableB = await getTeacherProfileForEditing(teacherB.teacherId);

    await expect(
      updateTeacherProfile({
        teacherId: teacherB.teacherId,
        displayName: editableB.displayName,
        slug: editableA.slug, // already taken by teacherA
        subjects: [],
      }),
    ).rejects.toThrow();
  });
});
