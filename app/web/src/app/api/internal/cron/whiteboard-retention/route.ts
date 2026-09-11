import { timingSafeEqual } from "node:crypto";
import { cleanupExpiredWhiteboards } from "../../../../../server/whiteboard-retention";

/**
 * docs/API.md §5 / docs/WHITEBOARD.md §5 — same internal-cron, secret-header pattern as
 * `POST /api/internal/cron/auth-cleanup`, sharing the same `INTERNAL_CRON_SECRET` (see
 * .env.example). Wired to the system cron via a plain `curl`, e.g. daily, off-peak:
 *
 *   curl -X POST -H "Authorization: Bearer $INTERNAL_CRON_SECRET" \
 *     https://<host>/api/internal/cron/whiteboard-retention
 */
function isAuthorized(request: Request): boolean {
  const secret = process.env.INTERNAL_CRON_SECRET;
  if (!secret) return false; // Fail closed — never run "open" just because the env var is unset.

  const provided = request.headers.get("authorization");
  const expected = `Bearer ${secret}`;
  const providedBuf = Buffer.from(provided ?? "");
  const expectedBuf = Buffer.from(expected);
  return providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const summary = await cleanupExpiredWhiteboards();
  return Response.json({ ok: true, ...summary });
}
