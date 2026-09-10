import { createId } from "@paralleldrive/cuid2";
import { withTenantContext } from "./tenant-context";
import { saveFile } from "../lib/files/local-disk-storage";
import { detectImageType } from "../lib/files/detect-image-type";

/**
 * Homework for an individual student (not groups, matching lessons.ts's precedent — groups
 * have no UI yet, see docs/ROADMAP.md). A homework entry optionally links back to a past
 * lesson and optionally carries one photo attachment, viewed inline via
 * src/app/api/files/[teacherId]/[materialFileId]/route.ts, never downloaded as a bare link.
 */

const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // product constant, not architecture

export interface CreateHomeworkInput {
  teacherId: string;
  studentLinkId: string;
  title: string;
  description?: string;
  dueAt?: Date;
  lessonId?: string;
  /** Set by the Server Action handling the create form's FormData directly — no separate
   *  upload endpoint, see the plan discussed before implementation. */
  photo?: { originalFileName: string; data: Buffer } | null;
  /** The teacher's own User.id (from session) — MaterialFile.ownerUserId is the uploader,
   *  which the caller already has and there is no reason to re-derive here. */
  uploaderUserId: string;
}

export async function createHomework(input: CreateHomeworkInput) {
  return withTenantContext({ teacherId: input.teacherId }, async (tx) => {
    // Same ownership-check rationale as createLessonForStudent in lessons.ts: RLS already
    // makes another teacher's link invisible here, but this turns a mismatch into a clear
    // error and also catches an archived (no longer active) link.
    const link = await tx.teacherStudentLink.findUnique({ where: { id: input.studentLinkId } });
    if (!link || link.teacherId !== input.teacherId || link.status !== "active") {
      throw new Error("Этот ученик не привязан к вам или приглашение ещё не принято.");
    }

    if (input.lessonId) {
      const lesson = await tx.lesson.findUnique({ where: { id: input.lessonId } });
      if (!lesson || lesson.teacherId !== input.teacherId) {
        throw new Error("Занятие не найдено.");
      }
    }

    const homework = await tx.homework.create({
      data: {
        teacherId: input.teacherId,
        studentLinkId: input.studentLinkId,
        lessonId: input.lessonId,
        title: input.title,
        description: input.description,
        dueAt: input.dueAt,
      },
    });

    if (input.photo) {
      if (input.photo.data.byteLength > MAX_PHOTO_BYTES) {
        throw new Error("Файл слишком большой (максимум 10 МБ).");
      }
      // Magic bytes, not the client-supplied filename/extension — a renamed .exe with a
      // .jpg name must not pass (docs/THREAT_MODEL.md upload-validation requirement).
      const detectedType = detectImageType(input.photo.data);
      if (!detectedType) {
        throw new Error("Файл не распознан как изображение (поддерживаются JPEG, PNG, WebP).");
      }

      const materialFileId = createId();
      // Namespaced by teacherId so the storage layout itself groups files per tenant —
      // convenient for a future per-teacher export/deletion, not required for isolation
      // (that's the ownership check in getMaterialFileForAccess below, not the file path).
      const storageKey = `${input.teacherId}/${materialFileId}`;
      await saveFile(storageKey, input.photo.data);

      await tx.materialFile.create({
        data: {
          id: materialFileId,
          teacherId: input.teacherId,
          ownerUserId: input.uploaderUserId,
          homeworkId: homework.id,
          storageKey,
          originalFileName: input.photo.originalFileName,
          mimeType: detectedType,
          sizeBytes: input.photo.data.byteLength,
        },
      });
    }

    return homework;
  });
}

export async function getHomeworkForTeacher(teacherId: string, filterStudentLinkId?: string) {
  return withTenantContext({ teacherId }, (tx) =>
    tx.homework.findMany({
      where: {
        teacherId,
        ...(filterStudentLinkId ? { studentLinkId: filterStudentLinkId } : {}),
      },
      // studentLink.studentUser is a join to User, which has no RLS — safe regardless of
      // tenant context, same reasoning as getLessonsForTeacher's existing include.
      include: {
        studentLink: {
          select: { id: true, displayName: true, studentUser: { select: { email: true } } },
        },
        materialFiles: { select: { id: true, mimeType: true, originalFileName: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  );
}

export type MaterialFileAccess =
  | { allowed: true; storageKey: string; mimeType: string; originalFileName: string }
  | { allowed: false };

export type FileAccessRequester =
  | { role: "teacher"; teacherId: string }
  | { role: "student"; studentUserId: string };

/**
 * Dual-path authorization for GET /api/files/[teacherId]/[materialFileId]: a teacher may see
 * their own files (checked directly); a student may see a file only if they are the assignee
 * of the specific homework it's attached to — resolved via that homework's studentLinkId,
 * mirroring the multi-teacher-aggregation pattern already established in
 * getMyLessonsAsStudent (lessons.ts). teacherId comes from the URL (client-controlled); the
 * requester's own identity comes from the session (server-trusted) — the check below is what
 * actually enforces access, the tenant context is only the mechanism for reading the rows.
 */
export async function getMaterialFileForAccess(
  materialFileId: string,
  teacherIdFromUrl: string,
  requester: FileAccessRequester,
): Promise<MaterialFileAccess> {
  if (requester.role === "teacher") {
    if (requester.teacherId !== teacherIdFromUrl) return { allowed: false };
    return withTenantContext({ teacherId: requester.teacherId }, async (tx) => {
      const file = await tx.materialFile.findUnique({ where: { id: materialFileId } });
      if (!file || file.teacherId !== requester.teacherId) return { allowed: false };
      return {
        allowed: true,
        storageKey: file.storageKey,
        mimeType: file.mimeType,
        originalFileName: file.originalFileName,
      };
    });
  }

  return withTenantContext({ teacherId: teacherIdFromUrl }, async (tx) => {
    const file = await tx.materialFile.findUnique({ where: { id: materialFileId } });
    if (!file || file.teacherId !== teacherIdFromUrl || !file.homeworkId) {
      return { allowed: false };
    }

    const homework = await tx.homework.findUnique({ where: { id: file.homeworkId } });
    if (!homework || !homework.studentLinkId) return { allowed: false };

    const link = await tx.teacherStudentLink.findUnique({ where: { id: homework.studentLinkId } });
    if (!link || link.studentUserId !== requester.studentUserId) return { allowed: false };

    return {
      allowed: true,
      storageKey: file.storageKey,
      mimeType: file.mimeType,
      originalFileName: file.originalFileName,
    };
  });
}

export interface StudentHomeworkGroup {
  teacherId: string;
  teacherDisplayName: string;
  homework: Array<{
    id: string;
    title: string;
    description: string | null;
    dueAt: Date | null;
    createdAt: Date;
    materialFiles: Array<{ id: string; mimeType: string; originalFileName: string }>;
  }>;
}

/** Same "no single tenant context covers every teacher" reasoning as getMyLessonsAsStudent
 *  in lessons.ts — see docs/MULTI_TENANCY.md §4.1-4.2. */
export async function getMyHomeworkAsStudent(studentUserId: string): Promise<StudentHomeworkGroup[]> {
  const links = await withTenantContext({ studentUserId }, (tx) =>
    tx.teacherStudentLink.findMany({ where: { studentUserId, status: "active" } }),
  );

  return Promise.all(
    links.map(async (link) => {
      const [teacher, homework] = await Promise.all([
        withTenantContext({ teacherId: link.teacherId }, (tx) =>
          tx.teacherProfile.findUniqueOrThrow({
            where: { id: link.teacherId },
            select: { displayName: true },
          }),
        ),
        withTenantContext({ teacherId: link.teacherId }, (tx) =>
          tx.homework.findMany({
            where: { teacherId: link.teacherId, studentLinkId: link.id },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              title: true,
              description: true,
              dueAt: true,
              createdAt: true,
              materialFiles: { select: { id: true, mimeType: true, originalFileName: true } },
            },
          }),
        ),
      ]);

      return { teacherId: link.teacherId, teacherDisplayName: teacher.displayName, homework };
    }),
  );
}
