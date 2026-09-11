"use server";

import { redirect } from "next/navigation";
import { requireRole, assertEmailVerified } from "../../../../lib/auth/current-user";
import { updateStudentLink } from "../../../../server/teachers";

export async function updateStudentLinkAction(formData: FormData): Promise<void> {
  const user = await requireRole("teacher");
  const studentLinkId = String(formData.get("studentLinkId") ?? "");
  assertEmailVerified(user, studentLinkId ? `/teacher/students/${studentLinkId}` : "/teacher/students");

  const displayName = String(formData.get("displayName") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const gradeLevel = String(formData.get("gradeLevel") ?? "").trim();
  const contactPhone = String(formData.get("contactPhone") ?? "").trim();
  const contactTelegram = String(formData.get("contactTelegram") ?? "").trim();
  const priceRubles = String(formData.get("priceRubles") ?? "").trim();
  const durationMinutes = String(formData.get("durationMinutes") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!studentLinkId) {
    redirect("/teacher/students?error=update_failed");
  }

  try {
    await updateStudentLink({
      teacherId: user.teacherId!,
      studentLinkId,
      displayName: displayName || undefined,
      subject: subject || undefined,
      gradeLevel: gradeLevel || undefined,
      contactPhone: contactPhone || undefined,
      contactTelegram: contactTelegram || undefined,
      defaultPriceCents: priceRubles ? Math.round(Number(priceRubles) * 100) : undefined,
      defaultDurationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
      notes: notes || undefined,
    });
  } catch {
    redirect(`/teacher/students/${studentLinkId}?error=update_failed`);
  }

  redirect(`/teacher/students/${studentLinkId}?saved=1`);
}
