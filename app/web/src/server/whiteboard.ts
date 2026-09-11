import { withTenantContext } from "./tenant-context";
import type { Prisma } from "../../generated/prisma/client";

/**
 * docs/WHITEBOARD.md §3, §9 (review-3): a board belongs to a (teacher, student) or
 * (teacher, group) pair, not to a single Lesson — it continues across that pair's whole
 * lesson series. This module resolves "may this user open the whiteboard for this specific
 * lesson right now" and finds-or-creates the underlying series board — it does NOT talk to
 * the realtime service or issue room tokens (that's the next layer, built on top of this).
 */

/** Product constant, not an architectural one (docs/WHITEBOARD.md §3) — how long before/after
 *  a lesson's scheduled window a whiteboard token can be issued. */
export const ACCESS_BUFFER_MINUTES = 15;

/** Product constant (docs/WHITEBOARD.md §5) — a board with no activity for this long is
 *  eligible for hard deletion by the retention cron. */
export const RETENTION_DAYS = 30;

function accessWindow(scheduledAt: Date, durationMinutes: number): { from: Date; to: Date } {
  const bufferMs = ACCESS_BUFFER_MINUTES * 60_000;
  return {
    from: new Date(scheduledAt.getTime() - bufferMs),
    to: new Date(scheduledAt.getTime() + durationMinutes * 60_000 + bufferMs),
  };
}

export type WhiteboardAccessResult =
  /** `accessWindowEnd` — when THIS lesson's window closes, for the token-issuing route to cap
   *  a room token's TTL at (never hand out a token that outlives the window it was granted
   *  under). */
  | { ok: true; whiteboardId: string; teacherId: string; accessWindowEnd: Date }
  | { ok: false; reason: "not_found" }
  /** `availableFrom` is when the access window for THIS lesson opens — not a promise the
   *  board is reachable forever after that; it closes again once the window ends. */
  | { ok: false; reason: "outside_window"; availableFrom: Date };

interface LessonTarget {
  studentLinkId: string | null;
  groupId: string | null;
}

/**
 * Upsert keyed on whichever of studentLinkId/groupId the lesson actually has (exactly one,
 * enforced by the DB CHECK constraint) — Whiteboard's two composite unique indexes
 * (teacherId+studentLinkId, teacherId+groupId) exist for exactly this, see schema.prisma.
 * Bumps lastActivityAt/expiresAt on every call, including token-renewal calls during an
 * already-open session (docs/WHITEBOARD.md §5: "expiresAt... обновляется при каждой
 * активности") — the realtime service itself never touches Postgres (docs/WHITEBOARD.md §2),
 * so this resolve step, called repeatedly via the client's keep-alive re-validation, is the
 * only place activity actually gets recorded.
 */
async function findOrCreateWhiteboard(
  tx: Prisma.TransactionClient,
  teacherId: string,
  target: LessonTarget,
) {
  const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const activity = { lastActivityAt: new Date(), expiresAt };

  if (target.studentLinkId) {
    return tx.whiteboard.upsert({
      where: { teacherId_studentLinkId: { teacherId, studentLinkId: target.studentLinkId } },
      update: activity,
      create: { teacherId, studentLinkId: target.studentLinkId, ...activity },
    });
  }
  return tx.whiteboard.upsert({
    where: { teacherId_groupId: { teacherId, groupId: target.groupId! } },
    update: activity,
    create: { teacherId, groupId: target.groupId!, ...activity },
  });
}

/** Teacher-facing resolve — the teacher already owns the lesson, no ambiguity about which
 *  tenant context to open. */
export async function resolveWhiteboardForTeacher(
  teacherId: string,
  lessonId: string,
  now: Date = new Date(),
): Promise<WhiteboardAccessResult> {
  return withTenantContext({ teacherId }, async (tx) => {
    const lesson = await tx.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson || lesson.teacherId !== teacherId) {
      return { ok: false, reason: "not_found" };
    }
    const window = accessWindow(lesson.scheduledAt, lesson.durationMinutes);
    if (now < window.from || now > window.to) {
      return { ok: false, reason: "outside_window", availableFrom: window.from };
    }
    const whiteboard = await findOrCreateWhiteboard(tx, teacherId, lesson);
    return { ok: true, whiteboardId: whiteboard.id, teacherId, accessWindowEnd: window.to };
  });
}

/**
 * Student-facing resolve. A student has no legitimate teacherId context to open a priori —
 * `lessonId` alone can't say which teacher it belongs to under RLS (querying Lesson requires
 * `app.current_teacher_id` already set; there's no denormalized lessonId->teacherId lookup,
 * same class of chicken-and-egg problem as docs/MULTI_TENANCY.md §4.2, "дан userId, найди
 * teacherId"). The fix is the same pattern already used by getMyLessonsAsStudent
 * (src/server/lessons.ts): first find every teacher this student is legitimately, actively
 * linked to (safe — TeacherStudentLink is queryable under studentUserId context), then check
 * each one in turn for a lesson that's both theirs and this student's. Never trusts a
 * client-supplied teacherId — every teacherId considered here came from the student's own
 * RLS-scoped link rows, not from the request.
 */
export async function resolveWhiteboardForStudent(
  studentUserId: string,
  lessonId: string,
  now: Date = new Date(),
): Promise<WhiteboardAccessResult> {
  const links = await withTenantContext({ studentUserId }, (tx) =>
    tx.teacherStudentLink.findMany({ where: { studentUserId, status: "active" } }),
  );

  for (const link of links) {
    const result = await withTenantContext({ teacherId: link.teacherId }, async (tx): Promise<WhiteboardAccessResult | null> => {
      const lesson = await tx.lesson.findUnique({ where: { id: lessonId } });
      if (!lesson || lesson.teacherId !== link.teacherId) return null;

      if (lesson.studentLinkId) {
        if (lesson.studentLinkId !== link.id) return null; // another student's individual lesson
      } else if (lesson.groupId) {
        const membership = await tx.groupMember.findFirst({
          where: { groupId: lesson.groupId, studentLinkId: link.id, leftAt: null },
        });
        if (!membership) return null; // not (or no longer) a member of this group
      } else {
        return null; // unreachable given the DB CHECK constraint, kept for exhaustiveness
      }

      const window = accessWindow(lesson.scheduledAt, lesson.durationMinutes);
      if (now < window.from || now > window.to) {
        return { ok: false, reason: "outside_window", availableFrom: window.from };
      }
      const whiteboard = await findOrCreateWhiteboard(tx, link.teacherId, lesson);
      return { ok: true, whiteboardId: whiteboard.id, teacherId: link.teacherId, accessWindowEnd: window.to };
    });
    if (result) return result;
  }

  return { ok: false, reason: "not_found" };
}
