import { withTenantContext } from "./tenant-context";
import type { LessonStatus, Prisma } from "../../generated/prisma/client";

/**
 * Lessons — either for one student (studentLinkId set) or a whole group (groupId set), never
 * both (docs/DATABASE.md's CHECK constraint on the lessons table). A group lesson is one
 * Lesson row for the whole session — one status, one price, one payment mark for the group as
 * a unit, not per-student billing within it; splitting that further is a bigger feature this
 * doesn't attempt (Правило 10 ТЗ).
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
        zoomLinkSnapshot: await currentZoomLink(tx, input.teacherId),
      },
    });
  });
}

/**
 * docs/ZOOM.md §1: the teacher's Zoom link is copied into the lesson at creation time, not
 * read live — so a later change to TeacherProfile.zoomPersonalLink doesn't rewrite history for
 * lessons already scheduled.
 */
async function currentZoomLink(
  tx: Prisma.TransactionClient,
  teacherId: string,
): Promise<string | undefined> {
  const profile = await tx.teacherProfile.findUnique({
    where: { id: teacherId },
    select: { zoomPersonalLink: true },
  });
  return profile?.zoomPersonalLink ?? undefined;
}

export interface CreateGroupLessonInput {
  teacherId: string;
  groupId: string;
  scheduledAt: Date;
  durationMinutes: number;
  priceCents: number;
  notes?: string;
}

export async function createLessonForGroup(input: CreateGroupLessonInput) {
  return withTenantContext({ teacherId: input.teacherId }, async (tx) => {
    // Same ownership-check rationale as createLessonForStudent above.
    const group = await tx.group.findFirst({
      where: { id: input.groupId, teacherId: input.teacherId, archivedAt: null },
    });
    if (!group) {
      throw new Error("Группа не найдена или архивирована.");
    }

    return tx.lesson.create({
      data: {
        teacherId: input.teacherId,
        groupId: input.groupId,
        scheduledAt: input.scheduledAt,
        durationMinutes: input.durationMinutes,
        priceCents: input.priceCents,
        notes: input.notes,
        zoomLinkSnapshot: await currentZoomLink(tx, input.teacherId),
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
        group: { select: { id: true, name: true } },
      },
      orderBy: { scheduledAt: "desc" },
    }),
  );
}

/** Bounded fetch for /teacher/calendar — the plain table on /teacher/schedule wants
 *  everything, the calendar only ever renders one visible window at a time. */
export async function getLessonsForTeacherInRange(
  teacherId: string,
  range: { from: Date; toExclusive: Date },
) {
  return withTenantContext({ teacherId }, (tx) =>
    tx.lesson.findMany({
      where: { teacherId, scheduledAt: { gte: range.from, lt: range.toExclusive } },
      include: {
        studentLink: {
          select: { id: true, displayName: true, studentUser: { select: { email: true } } },
        },
        group: { select: { id: true, name: true } },
      },
      orderBy: { scheduledAt: "asc" },
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

/**
 * The drag-and-drop target on /teacher/calendar. Same updateMany + throw-on-zero ownership
 * guard as updateLessonStatus above. A group lesson is one row for the whole session (see the
 * file-level comment) — rescheduling it here already moves it for every member in one action,
 * with no per-student fan-out needed, because there was never a per-student row to move.
 */
export async function rescheduleLesson(
  teacherId: string,
  lessonId: string,
  newScheduledAt: Date,
  newDurationMinutes?: number,
): Promise<void> {
  return withTenantContext({ teacherId }, async (tx) => {
    const result = await tx.lesson.updateMany({
      where: { id: lessonId, teacherId },
      data: {
        scheduledAt: newScheduledAt,
        ...(newDurationMinutes != null ? { durationMinutes: newDurationMinutes } : {}),
      },
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
    zoomLinkSnapshot: string | null;
    /** Set only for a group lesson — lets the student see WHY a lesson they didn't book
     *  individually is on their schedule. */
    groupName: string | null;
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
export async function getMyLessonsAsStudent(
  studentUserId: string,
  /** Bounds the query for the calendar view (/student/calendar) — omitted, it fetches every
   *  lesson ever, which is what /student/schedule's plain table has always wanted. */
  range?: { from: Date; toExclusive: Date },
): Promise<StudentLessonGroup[]> {
  const links = await withTenantContext({ studentUserId }, (tx) =>
    tx.teacherStudentLink.findMany({ where: { studentUserId, status: "active" } }),
  );
  const scheduledAtFilter = range ? { scheduledAt: { gte: range.from, lt: range.toExclusive } } : {};

  return Promise.all(
    links.map(async (link) => {
      const [teacher, individualLessons, groupMemberships] = await Promise.all([
        withTenantContext({ teacherId: link.teacherId }, (tx) =>
          tx.teacherProfile.findUniqueOrThrow({
            where: { id: link.teacherId },
            select: { displayName: true },
          }),
        ),
        withTenantContext({ teacherId: link.teacherId }, (tx) =>
          tx.lesson.findMany({
            where: { teacherId: link.teacherId, studentLinkId: link.id, ...scheduledAtFilter },
            select: {
              id: true,
              scheduledAt: true,
              durationMinutes: true,
              status: true,
              priceCents: true,
              paidAt: true,
              notes: true,
              zoomLinkSnapshot: true,
            },
          }),
        ),
        // Groups this student currently belongs to under this teacher — a group lesson isn't
        // tied to studentLinkId at all (it's tied to groupId), so it has to be found via
        // membership, not via the lesson row itself.
        withTenantContext({ teacherId: link.teacherId }, (tx) =>
          tx.groupMember.findMany({
            where: { teacherId: link.teacherId, studentLinkId: link.id, leftAt: null },
            select: { groupId: true, group: { select: { name: true } } },
          }),
        ),
      ]);

      const groupIds = groupMemberships.map((m) => m.groupId);
      const groupNameById = new Map(groupMemberships.map((m) => [m.groupId, m.group.name]));

      const groupLessons =
        groupIds.length === 0
          ? []
          : await withTenantContext({ teacherId: link.teacherId }, (tx) =>
              tx.lesson.findMany({
                where: { teacherId: link.teacherId, groupId: { in: groupIds }, ...scheduledAtFilter },
                select: {
                  id: true,
                  groupId: true,
                  scheduledAt: true,
                  durationMinutes: true,
                  status: true,
                  priceCents: true,
                  paidAt: true,
                  notes: true,
                  zoomLinkSnapshot: true,
                },
              }),
            );

      const lessons = [
        ...individualLessons.map((l) => ({ ...l, groupName: null as string | null })),
        ...groupLessons.map((l) => ({
          ...l,
          groupName: groupNameById.get(l.groupId!) ?? null,
        })),
      ].sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime());

      return {
        teacherId: link.teacherId,
        teacherDisplayName: teacher.displayName,
        lessons,
      };
    }),
  );
}
