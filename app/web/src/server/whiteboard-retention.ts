import { prisma } from "./db";
import { deleteWhiteboardSnapshot } from "../lib/files/whiteboard-snapshot-storage";

/**
 * docs/WHITEBOARD.md §5, §8. A daily cron, hard-deleting every `Whiteboard` whose `expiresAt`
 * has passed, across ALL teachers at once — genuinely cross-tenant, like auth-cleanup, but
 * `whiteboards` (unlike auth-cleanup's tables) IS protected by the ordinary per-teacher RLS
 * policy. This deliberately does NOT go through `withTenantContext` (there is no single tenant
 * to scope a "clean up every expired board" run to, and that function refuses a call with no
 * tenant set at all) — instead it relies on the narrow `retention_sweep_select`/
 * `retention_sweep_delete` policies added specifically for this (docs/MULTI_TENANCY.md §4.5):
 * with no `app.current_teacher_id` set, `tenant_isolation` contributes nothing, so the plain
 * `prisma.whiteboard` calls below can only ever see/delete rows that are already past their
 * own `expiresAt` — never an active board belonging to some other teacher.
 */
export interface WhiteboardRetentionSummary {
  deleted: number;
  failed: number;
}

export async function cleanupExpiredWhiteboards(): Promise<WhiteboardRetentionSummary> {
  const candidates = await prisma.whiteboard.findMany({
    where: { expiresAt: { lt: new Date() } },
    select: { id: true, teacherId: true },
  });

  let deleted = 0;
  let failed = 0;

  for (const board of candidates) {
    // Storage-then-DB ordering (docs/FILE_STORAGE.md §7): never leave a DB row pointing at an
    // already-deleted object, but a failed storage delete leaves the DB row intact for a retry
    // on the next run rather than silently orphaning the object.
    try {
      await deleteWhiteboardSnapshot(board.teacherId, board.id);
    } catch (err) {
      console.error(`[whiteboard-retention] failed to delete snapshot for whiteboard ${board.id}:`, err);
      failed += 1;
      continue;
    }

    // Re-check freshness at delete time, not just at select time (docs/WHITEBOARD.md §8): if
    // activity bumped this board's expiresAt back into the future between the query above and
    // now, the WHERE clause below simply won't match and count stays 0 — never a blind delete
    // off a possibly-stale candidate list.
    const result = await prisma.whiteboard.deleteMany({
      where: { id: board.id, expiresAt: { lt: new Date() } },
    });
    deleted += result.count;
  }

  return { deleted, failed };
}
