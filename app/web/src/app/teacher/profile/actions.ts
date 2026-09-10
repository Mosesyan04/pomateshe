"use server";

import { redirect } from "next/navigation";
import { requireRole } from "../../../lib/auth/current-user";
import { updateTeacherProfile } from "../../../server/teacher-profile";
import { Prisma } from "../../../../generated/prisma/client";

export async function updateTeacherProfileAction(formData: FormData): Promise<void> {
  const user = await requireRole("teacher");

  const displayName = String(formData.get("displayName") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim();
  const contactInfo = String(formData.get("contactInfo") ?? "").trim();
  const priceRubles = String(formData.get("priceRubles") ?? "").trim();
  const subjectsRaw = String(formData.get("subjects") ?? "").trim();
  const avatar = formData.get("avatar");

  if (!displayName || !slug) {
    redirect("/teacher/profile?error=missing_fields");
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    redirect("/teacher/profile?error=invalid_slug");
  }

  const subjects = subjectsRaw
    ? subjectsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const hasAvatar = avatar instanceof File && avatar.size > 0;

  try {
    await updateTeacherProfile({
      teacherId: user.teacherId!,
      displayName,
      slug,
      bio: bio || undefined,
      subjects,
      contactInfo: contactInfo || undefined,
      defaultLessonPriceCents: priceRubles ? Math.round(Number(priceRubles) * 100) : undefined,
      avatar: hasAvatar
        ? { data: Buffer.from(await (avatar as File).arrayBuffer()) }
        : null,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      redirect("/teacher/profile?error=slug_taken");
    }
    if (err instanceof Error && /Файл/.test(err.message)) {
      redirect("/teacher/profile?error=bad_avatar");
    }
    throw err;
  }

  redirect("/teacher/profile?saved=1");
}
