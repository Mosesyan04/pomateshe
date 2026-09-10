import { withTenantContext } from "./tenant-context";

export { createGroup } from "./teachers";

/**
 * Group lessons themselves are still deferred (docs/ROADMAP.md — Lesson.groupId works at the
 * schema/RLS level, no scheduling UI yet). This file is just group *membership* management:
 * create a group, add/remove students, list groups with their current members.
 */

export async function getGroupsForTeacher(teacherId: string) {
  return withTenantContext({ teacherId }, (tx) =>
    tx.group.findMany({
      where: { teacherId, archivedAt: null },
      include: {
        members: {
          // Only current members — a removed student's row survives (leftAt set, not
          // deleted, docs/DATABASE.md §1's general soft-history preference for membership
          // records) but shouldn't show up in the active roster.
          where: { leftAt: null },
          include: {
            studentLink: {
              select: { id: true, displayName: true, studentUser: { select: { email: true } } },
            },
          },
          orderBy: { joinedAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  );
}

export async function addStudentToGroup(teacherId: string, groupId: string, studentLinkId: string) {
  return withTenantContext({ teacherId }, async (tx) => {
    // Ownership checks mirror lessons.ts/homework.ts's established pattern: RLS already makes
    // a mismatched id invisible, this turns that into a clear error instead of a confusing
    // foreign-key failure on the insert below.
    const group = await tx.group.findFirst({ where: { id: groupId, teacherId, archivedAt: null } });
    if (!group) throw new Error("Группа не найдена.");

    const link = await tx.teacherStudentLink.findFirst({
      where: { id: studentLinkId, teacherId, status: "active" },
    });
    if (!link) throw new Error("Этот ученик не привязан к вам или приглашение ещё не принято.");

    // Upsert, not create — re-adding a student who previously left the group (leftAt set)
    // must revive that same row (the @@unique([groupId, studentLinkId]) constraint would
    // otherwise reject a second insert), not create a duplicate membership history.
    return tx.groupMember.upsert({
      where: { groupId_studentLinkId: { groupId, studentLinkId } },
      create: { teacherId, groupId, studentLinkId },
      update: { leftAt: null, joinedAt: new Date() },
    });
  });
}

export async function removeStudentFromGroup(
  teacherId: string,
  groupId: string,
  studentLinkId: string,
): Promise<void> {
  return withTenantContext({ teacherId }, async (tx) => {
    const result = await tx.groupMember.updateMany({
      where: { groupId, studentLinkId, teacherId, leftAt: null },
      data: { leftAt: new Date() },
    });
    if (result.count === 0) {
      throw new Error("Участник группы не найден.");
    }
  });
}

export async function archiveGroup(teacherId: string, groupId: string): Promise<void> {
  return withTenantContext({ teacherId }, async (tx) => {
    const result = await tx.group.updateMany({
      where: { id: groupId, teacherId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (result.count === 0) {
      throw new Error("Группа не найдена.");
    }
  });
}
