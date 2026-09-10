import { getCurrentUser } from "../../../../../lib/auth/current-user";
import { getMaterialFileForAccess } from "../../../../../server/homework";
import { readStoredFile } from "../../../../../lib/files/local-disk-storage";

/**
 * The only way a homework photo is ever served — same-origin, session-cookie auth (not a
 * signed URL: this app has no CDN/cross-origin need for these files, see the plan discussed
 * before building homework). Ownership is re-checked on every request via
 * getMaterialFileForAccess, not cached — a revoked session or a link that's since been
 * archived must lose access on the very next request, same principle as getCurrentUser.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ teacherId: string; materialFileId: string }> },
) {
  const { teacherId, materialFileId } = await ctx.params;

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

  const access = await getMaterialFileForAccess(materialFileId, teacherId, requester);
  if (!access.allowed) {
    // 404, not 403 — do not confirm to a caller they've merely correctly guessed an id that
    // belongs to someone else (docs/THREAT_MODEL.md's information-disclosure guidance).
    return new Response("Not found", { status: 404 });
  }

  const data = await readStoredFile(access.storageKey);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": access.mimeType,
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="${encodeURIComponent(access.originalFileName)}"`,
    },
  });
}
