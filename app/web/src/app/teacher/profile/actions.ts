"use server";

import { redirect } from "next/navigation";
import { requireRole, assertEmailVerified } from "../../../lib/auth/current-user";
import { updateTeacherProfile } from "../../../server/teacher-profile";
import { disconnectCalendarIntegration } from "../../../server/calendar-integration";
import { Prisma } from "../../../../generated/prisma/client";

export async function updateTeacherProfileAction(formData: FormData): Promise<void> {
  const user = await requireRole("teacher");
  assertEmailVerified(user, "/teacher/profile");

  const displayName = String(formData.get("displayName") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim();
  const contactInfo = String(formData.get("contactInfo") ?? "").trim();
  const priceRubles = String(formData.get("priceRubles") ?? "").trim();
  const subjectsRaw = String(formData.get("subjects") ?? "").trim();
  const zoomPersonalLink = String(formData.get("zoomPersonalLink") ?? "").trim();
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
      // Unlike the other optional fields above, this one distinguishes "leave unchanged"
      // (field omitted) from "clear it" (empty string here becomes explicit null) — a teacher
      // clearing the box and saving should actually remove the link, not silently no-op.
      zoomPersonalLink: zoomPersonalLink || null,
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
    if (err instanceof Error && /Zoom/.test(err.message)) {
      redirect("/teacher/profile?error=bad_zoom_link");
    }
    throw err;
  }

  redirect("/teacher/profile?saved=1");
}

export async function disconnectGoogleCalendarAction(): Promise<void> {
  const user = await requireRole("teacher");
  assertEmailVerified(user, "/teacher/profile");
  await disconnectCalendarIntegration(user.teacherId!);
  redirect("/teacher/profile?calendarDisconnected=1");
}
