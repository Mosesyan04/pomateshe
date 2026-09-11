"use server";

import { redirect } from "next/navigation";
import { requireRole, assertEmailVerified } from "../../../lib/auth/current-user";
import { createHomework } from "../../../server/homework";

export async function createHomeworkAction(formData: FormData): Promise<void> {
  const user = await requireRole("teacher");
  assertEmailVerified(user, "/teacher/homework");

  const studentLinkId = String(formData.get("studentLinkId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const dueAtRaw = String(formData.get("dueAt") ?? "");
  const lessonId = String(formData.get("lessonId") ?? "").trim();
  const photo = formData.get("photo");

  if (!studentLinkId || !title) {
    redirect("/teacher/homework?error=missing_fields");
  }

  let dueAt: Date | undefined;
  if (dueAtRaw) {
    dueAt = new Date(dueAtRaw);
    if (Number.isNaN(dueAt.getTime())) {
      redirect("/teacher/homework?error=invalid_date");
    }
  }

  // An empty <input type="file"> still arrives as a zero-size File, never as null/undefined.
  const hasPhoto = photo instanceof File && photo.size > 0;

  try {
    await createHomework({
      teacherId: user.teacherId!,
      studentLinkId,
      title,
      description: description || undefined,
      dueAt,
      lessonId: lessonId || undefined,
      uploaderUserId: user.userId,
      photo: hasPhoto
        ? { originalFileName: (photo as File).name, data: Buffer.from(await (photo as File).arrayBuffer()) }
        : null,
    });
  } catch {
    redirect("/teacher/homework?error=create_failed");
  }

  redirect("/teacher/homework?created=1");
}
