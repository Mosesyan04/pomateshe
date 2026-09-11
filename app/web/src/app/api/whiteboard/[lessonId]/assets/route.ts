import { getCurrentUser } from "../../../../../lib/auth/current-user";
import { uploadWhiteboardAsset } from "../../../../../server/whiteboard-assets";

/**
 * Image insertion for the whiteboard (docs/WHITEBOARD.md §2, §9) — called by tldraw's
 * TLAssetStore.upload hook (src/lib/whiteboard/asset-store.ts), body is a plain multipart
 * upload, not JSON — same as the Server-Action-FormData path homework uses, just as a real
 * endpoint since tldraw's asset store interface calls fetch() directly from the browser.
 */
export async function POST(request: Request, ctx: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await ctx.params;

  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const requester =
    user.role === "teacher" && user.teacherId
      ? ({ role: "teacher", teacherId: user.teacherId } as const)
      : user.role === "student"
        ? ({ role: "student", studentUserId: user.userId } as const)
        : null;
  if (!requester) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: "no_file" }, { status: 400 });
  }
  const data = Buffer.from(await file.arrayBuffer());

  const result = await uploadWhiteboardAsset(requester, lessonId, data);
  if (!result.ok) {
    // 404, not 403, for "not_found" — same information-disclosure guidance as the token route.
    const status = result.error === "not_found" ? 404 : result.error === "outside_window" ? 403 : 400;
    return Response.json(result, { status });
  }
  return Response.json(result);
}
