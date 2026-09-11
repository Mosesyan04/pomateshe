import { getCurrentUser } from "../../../../../lib/auth/current-user";
import { resolveWhiteboardForTeacher, resolveWhiteboardForStudent } from "../../../../../server/whiteboard";
import { signRoomToken } from "../../../../../lib/whiteboard/room-token";

/**
 * The one place a whiteboard room token is ever issued (docs/WHITEBOARD.md §3). Called both
 * to open a session AND to renew it every few minutes while connected (the client's
 * keep-alive) — every call re-runs the full ownership + access-window check, so an early
 * revocation (teacher removes a student mid-lesson) or a lesson that's just ended stops
 * granting new tokens on the very next renewal, not only on the next full reconnect.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await ctx.params;

  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const result =
    user.role === "teacher" && user.teacherId
      ? await resolveWhiteboardForTeacher(user.teacherId, lessonId)
      : user.role === "student"
        ? await resolveWhiteboardForStudent(user.userId, lessonId)
        : ({ ok: false, reason: "not_found" } as const);

  if (!result.ok) {
    if (result.reason === "outside_window") {
      return Response.json(
        { ok: false, error: "outside_window", availableFrom: result.availableFrom.toISOString() },
        { status: 403 },
      );
    }
    // 404, not 403 — do not confirm to a caller that a lessonId they don't have access to
    // even exists (docs/THREAT_MODEL.md's information-disclosure guidance, same as
    // GET /api/files/[teacherId]/[materialFileId]).
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  // Short-lived, renewed by the client well before it runs out (docs/WHITEBOARD.md §3,
  // review-2's "непрерывная ревалидация") — never outlives the lesson's own access window,
  // even if that window happens to end sooner than the default TTL.
  const DEFAULT_TOKEN_TTL_MS = 10 * 60 * 1000;
  const expiresAt = Math.min(Date.now() + DEFAULT_TOKEN_TTL_MS, result.accessWindowEnd.getTime());

  const token = signRoomToken({
    whiteboardId: result.whiteboardId,
    teacherId: result.teacherId,
    userId: user.userId,
    role: user.role === "teacher" ? "teacher" : "student",
    expiresAt,
  });

  return Response.json({
    ok: true,
    token,
    expiresAt,
    realtimeUrl: process.env.REALTIME_WS_URL ?? null,
  });
}
