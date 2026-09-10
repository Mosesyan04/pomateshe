import { withTenantContext } from "./tenant-context";
import type { LessonStatus } from "../../generated/prisma/client";

/**
 * Individual (student, not group) lessons — Phase 2 first slice per docs/ROADMAP.md.
 * Group lessons already work at the schema/RLS level (docs/DATABASE.md's CHECK constraint,
 * teachers.ts's createGroup/createLesson used by the Phase 1 isolation tests) but have no
 * teacher-facing UI yet — deliberately deferred, not forgotten, see docs/ROADMAP.md.
 */

export interface CreateLessonInput {
  teacherId: string;
  studentLinkId: string;
  scheduledAt: Date;
  durationMinutes: number;
  priceCents: number;
  notes?: string;
}

export async function createLessonForStudent(input: CreateLessonInput) {
  return withTenantContext({ teacherId: input.teacherId }, async (tx) => {
    // Ownership check: RLS (teacher_scope on teacher_student_links, docs/MULTI_TENANCY.md
    // §2.2) already makes another teacher's link invisible in this context, so a mismatched
    // id comes back null regardless of this check — the check turns that into a clear error
    // instead of a confusing foreign-key failure on the INSERT below, and also catches an
    // archived (no longer active) link, which RLS alone wouldn't reject.
    const link = await tx.teacherStudentLink.findUnique({ where: { id: input.studentLinkId } });
    if (!link || link.teacherId !== input.teacherId || link.status !== "active") {
      throw new Error("Этот ученик не привязан к вам или приглашение ещё не принято.");
    }

    return tx.lesson.create({
      data: {
        teacherId: input.teacherId,
        studentLinkId: input.studentLinkId,
        scheduledAt: input.scheduledAt,
        durationMinutes: input.durationMinutes,
        priceCents: input.priceCents,
        notes: input.notes,
      },
    });
  });
}

export async function getLessonsForTeacher(teacherId: string) {
  return withTenantContext({ teacherId }, (tx) =>
    tx.lesson.findMany({
      where: { teacherId },
      // studentLink.studentUser is a join to User, which has no RLS (docs/DATABASE.md §2) —
      // safe regardless of tenant context, same as getStudentsForTeacher's existing include.
      include: {
        studentLink: {
          select: { id: true, displayName: true, studentUser: { select: { email: true } } },
        },
      },
      orderBy: { scheduledAt: "desc" },
    }),
  );
}

/**
 * updateMany, not update — mirrors src/server/invites.ts's revokeInvite: the compound
 * {id, teacherId} filter is the real ownership check, RLS is the backstop behind it. Unlike
 * revokeInvite (which silently no-ops on a mismatch), this throws on zero rows affected:
 * the only way a teacher's own dashboard button click can target a lessonId that isn't
 * theirs is a tampered request (docs/THREAT_MODEL.md §2 "Tampering"), which should fail
 * loudly, not look like a successful no-op status change.
 */
export async function updateLessonStatus(
  teacherId: string,
  lessonId: string,
  status: LessonStatus,
) {
  return withTenantContext({ teacherId }, async (tx) => {
    const result = await tx.lesson.updateMany({
      where: { id: lessonId, teacherId },
      data: { status },
    });
    if (result.count === 0) {
      throw new Error("Занятие не найдено.");
    }
  });
}

export async function setLessonPaid(teacherId: string, lessonId: string, paid: boolean) {
  return withTenantContext({ teacherId }, async (tx) => {
    const result = await tx.lesson.updateMany({
      where: { id: lessonId, teacherId },
      data: { paidAt: paid ? new Date() : null },
    });
    if (result.count === 0) {
      throw new Error("Занятие не найдено.");
    }
  });
}

export interface StudentLessonGroup {
  teacherId: string;
  teacherDisplayName: string;
  lessons: Array<{
    id: string;
    scheduledAt: Date;
    durationMinutes: number;
    status: LessonStatus;
    priceCents: number;
    paidAt: Date | null;
    notes: string | null;
  }>;
}

/**
 * A student can have multiple teachers (docs/MULTI_TENANCY.md §1.1) — there is no single
 * tenant context that covers "all my lessons across every teacher" for the tenant-scoped
 * Lesson table, only for TeacherStudentLink itself (the one dual-policy table,
 * docs/MULTI_TENANCY.md §3.2). So this fetches the student's own links under
 * studentUserId-context first, then re-opens teacherId-context per link to read that
 * teacher's lessons and profile — same pattern as src/server/invites.ts's lookupInvite,
 * documented in docs/MULTI_TENANCY.md §4.1-4.2 specifically so this wouldn't need
 * rediscovering by trial and error a third time.
 */
export async function getMyLessonsAsStudent(studentUserId: string): Promise<StudentLessonGroup[]> {
  const links = await withTenantContext({ studentUserId }, (tx) =>
    tx.teacherStudentLink.findMany({ where: { studentUserId, status: "active" } }),
  );

  return Promise.all(
    links.map(async (link) => {
      const [teacher, lessons] = await Promise.all([
        withTenantContext({ teacherId: link.teacherId }, (tx) =>
          tx.teacherProfile.findUniqueOrThrow({
            where: { id: link.teacherId },
            select: { displayName: true },
          }),
        ),
        withTenantContext({ teacherId: link.teacherId }, (tx) =>
          tx.lesson.findMany({
            where: { teacherId: link.teacherId, studentLinkId: link.id },
            orderBy: { scheduledAt: "desc" },
            select: {
              id: true,
              scheduledAt: true,
              durationMinutes: true,
              status: true,
              priceCents: true,
              paidAt: true,
              notes: true,
            },
          }),
        ),
      ]);

      return {
        teacherId: link.teacherId,
        teacherDisplayName: teacher.displayName,
        lessons,
      };
    }),
  );
}
