import { getTeacherAvatarForServing } from "../../../../../server/teacher-profile";
import { readStoredFile } from "../../../../../lib/files/local-disk-storage";

/**
 * Deliberately no auth check — this is the public avatar shown on /t/[slug], meant to be
 * viewable by anyone, unlike src/app/api/files/[teacherId]/[materialFileId]/route.ts (which
 * gates homework photos to the teacher and the specific assigned student). Cacheable, unlike
 * that private route's `no-store`.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ teacherId: string }> },
) {
  const { teacherId } = await ctx.params;

  const avatar = await getTeacherAvatarForServing(teacherId);
  if (!avatar) {
    return new Response("Not found", { status: 404 });
  }

  const data = await readStoredFile(avatar.storageKey);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": avatar.mimeType,
      "Cache-Control": "public, max-age=300",
    },
  });
}
