import { describe, it, expect, afterAll } from "vitest";
import { registerTeacher, getStudentsForTeacher } from "../teachers";
import { createInvite, acceptInviteAsNewUser } from "../invites";
import { createLessonForStudent } from "../lessons";
import { uploadWhiteboardAsset, getWhiteboardAssetForAccess } from "../whiteboard-assets";
import { cleanupTestData } from "./test-helpers";
import { prisma } from "../db";

const createdUserIds: string[] = [];

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
const NOT_AN_IMAGE = Buffer.from("this is a text file pretending to be a photo");

afterAll(async () => {
  await cleanupTestData(createdUserIds);
  await prisma.$disconnect();
});

async function makeTeacherWithStudentAndLesson(label: string) {
  const t = await registerTeacher({
    email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: "correct horse battery staple",
    displayName: `${label} teacher`,
    slug: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timezone: "Europe/Moscow",
  });
  createdUserIds.push(t.userId);

  const invite = await createInvite(t.teacherId, `${label}-student-${Date.now()}@example.com`);
  const { session } = await acceptInviteAsNewUser(invite.token, "student password 123456");
  const students = await getStudentsForTeacher(t.teacherId);
  const link = students.find((s) => s.status === "active")!;
  createdUserIds.push(link.studentUserId);
  void session;

  const lesson = await createLessonForStudent({
    teacherId: t.teacherId,
    studentLinkId: link.id,
    scheduledAt: new Date(), // now — inside the whiteboard access window
    durationMinutes: 60,
    priceCents: 100000,
  });

  return { teacherId: t.teacherId, studentUserId: link.studentUserId, lessonId: lesson.id };
}

describe("uploadWhiteboardAsset", () => {
  it("accepts a real image and returns an assetId + detected MIME type", async () => {
    const { teacherId, lessonId } = await makeTeacherWithStudentAndLesson("wba-upload");
    const result = await uploadWhiteboardAsset({ role: "teacher", teacherId }, lessonId, PNG_BYTES);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mimeType).toBe("image/png");
      expect(typeof result.assetId).toBe("string");
    }
  });

  it("rejects a file that isn't actually an image, regardless of what it's named", async () => {
    const { teacherId, lessonId } = await makeTeacherWithStudentAndLesson("wba-nonimage");
    const result = await uploadWhiteboardAsset({ role: "teacher", teacherId }, lessonId, NOT_AN_IMAGE);
    expect(result).toEqual({ ok: false, error: "invalid_type" });
  });

  it("rejects an upload for a lesson the requester has no access to", async () => {
    const a = await makeTeacherWithStudentAndLesson("wba-foreign-a");
    const b = await makeTeacherWithStudentAndLesson("wba-foreign-b");
    // Teacher A tries to upload against teacher B's lesson.
    const result = await uploadWhiteboardAsset({ role: "teacher", teacherId: a.teacherId }, b.lessonId, PNG_BYTES);
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("lets the participating student upload to the same lesson's board too", async () => {
    const { studentUserId, lessonId } = await makeTeacherWithStudentAndLesson("wba-student-upload");
    const result = await uploadWhiteboardAsset({ role: "student", studentUserId }, lessonId, PNG_BYTES);
    expect(result.ok).toBe(true);
  });
});

describe("getWhiteboardAssetForAccess", () => {
  it("serves back exactly what was uploaded, with the correct MIME type", async () => {
    const { teacherId, lessonId } = await makeTeacherWithStudentAndLesson("wba-roundtrip");
    const uploaded = await uploadWhiteboardAsset({ role: "teacher", teacherId }, lessonId, PNG_BYTES);
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    const access = await getWhiteboardAssetForAccess({ role: "teacher", teacherId }, lessonId, uploaded.assetId);
    expect(access.allowed).toBe(true);
    if (access.allowed) {
      expect(access.data).toEqual(PNG_BYTES);
      expect(access.mimeType).toBe("image/png");
    }
  });

  it("the participating student can read an asset the teacher uploaded (same board)", async () => {
    const { teacherId, studentUserId, lessonId } = await makeTeacherWithStudentAndLesson("wba-cross-role-read");
    const uploaded = await uploadWhiteboardAsset({ role: "teacher", teacherId }, lessonId, PNG_BYTES);
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    const access = await getWhiteboardAssetForAccess({ role: "student", studentUserId }, lessonId, uploaded.assetId);
    expect(access.allowed).toBe(true);
  });

  it("a foreign teacher cannot read an asset belonging to someone else's board", async () => {
    const owner = await makeTeacherWithStudentAndLesson("wba-deny-owner");
    const outsider = await makeTeacherWithStudentAndLesson("wba-deny-outsider");
    const uploaded = await uploadWhiteboardAsset({ role: "teacher", teacherId: owner.teacherId }, owner.lessonId, PNG_BYTES);
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    const access = await getWhiteboardAssetForAccess(
      { role: "teacher", teacherId: outsider.teacherId },
      owner.lessonId,
      uploaded.assetId,
    );
    expect(access.allowed).toBe(false);
  });

  it("a nonexistent assetId is simply not found, not an error", async () => {
    const { teacherId, lessonId } = await makeTeacherWithStudentAndLesson("wba-missing");
    const access = await getWhiteboardAssetForAccess({ role: "teacher", teacherId }, lessonId, "does-not-exist");
    expect(access.allowed).toBe(false);
  });
});
