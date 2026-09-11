import { timingSafeEqual } from "node:crypto";
import { cleanupExpiredAuthRecords } from "../../../../../server/auth-cleanup";

/**
 * docs/API.md §5's pattern (`POST /api/internal/cron/whiteboard-retention` — "внутренний cron,
 * секретный заголовок"), applied here to Session/PasswordResetToken/EmailVerificationToken/
 * StudentInvite (docs/DATABASE.md §7). Wired to the system cron via a plain `curl`, e.g.
 * (daily, off-peak — the exact schedule is an ops/deployment choice, not fixed here):
 *
 *   curl -X POST -H "Authorization: Bearer $INTERNAL_CRON_SECRET" \
 *     https://<host>/api/internal/cron/auth-cleanup
 *
 * No queue/scheduler dependency (node-cron, BullMQ, ...) — docs/ARCHITECTURE.md's own table
 * lists "системный cron, дёргающий защищённый internal endpoint" as the not-overbuilt option
 * for this app's scale, the same reasoning as everywhere else in this project that skips a
 * dependency it doesn't need yet (Правило 10 ТЗ).
 */
function isAuthorized(request: Request): boolean {
  const secret = process.env.INTERNAL_CRON_SECRET;
  if (!secret) return false; // Fail closed — never run "open" just because the env var is unset.

  const provided = request.headers.get("authorization");
  const expected = `Bearer ${secret}`;
  const providedBuf = Buffer.from(provided ?? "");
  const expectedBuf = Buffer.from(expected);
  // Length check first — timingSafeEqual throws (not "returns false") on mismatched lengths,
  // same guard as src/lib/google-calendar/oauth-state.ts's signature check.
  return providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const summary = await cleanupExpiredAuthRecords();
  return Response.json({ ok: true, ...summary });
}
