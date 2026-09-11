import { getCurrentUser } from "../../../../../../lib/auth/current-user";
import { getWhiteboardAssetForAccess } from "../../../../../../server/whiteboard-assets";

/**
 * Serves a whiteboard image asset — same-origin, session-cookie auth, re-checked on every
 * request (same pattern as GET /api/files/[teacherId]/[materialFileId]), not a signed URL.
 * `lessonId` re-anchors the same access resolution the token route uses, since the canvas page
 * itself is only ever opened with a lessonId in its URL (docs/WHITEBOARD.md §3).
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ lessonId: string; assetId: string }> },
) {
  const { lessonId, assetId } = await ctx.params;

  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const requester =
    user.role === "teacher" && user.teacherId
      ? ({ role: "teacher", teacherId: user.teacherId } as const)
      : user.role === "student"
        ? ({ role: "student", studentUserId: user.userId } as const)
        : null;
  if (!requester) {
    return new Response("Forbidden", { status: 403 });
  }

  const access = await getWhiteboardAssetForAccess(requester, lessonId, assetId);
  if (!access.allowed) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(access.data), {
    headers: { "Content-Type": access.mimeType, "Cache-Control": "private, no-store" },
  });
}
