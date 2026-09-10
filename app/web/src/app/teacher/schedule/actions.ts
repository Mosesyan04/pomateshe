"use server";

import { redirect } from "next/navigation";
import { requireRole } from "../../../lib/auth/current-user";
import { createLessonForStudent, updateLessonStatus, setLessonPaid } from "../../../server/lessons";
import type { LessonStatus } from "../../../../generated/prisma/client";

const VALID_STATUSES: LessonStatus[] = ["scheduled", "completed", "cancelled", "no_show"];

export async function createLessonAction(formData: FormData): Promise<void> {
  const user = await requireRole("teacher");

  const studentLinkId = String(formData.get("studentLinkId") ?? "");
  const scheduledAtRaw = String(formData.get("scheduledAt") ?? "");
  const durationMinutes = Number(formData.get("durationMinutes"));
  // Form collects rubles (whole units, what a person actually types), storage is cents
  // (docs/DATABASE.md §1: money is Decimal-equivalent integer cents, never float rubles).
  const priceRubles = Number(formData.get("priceRubles"));
  const notes = String(formData.get("notes") ?? "").trim();

  if (!studentLinkId || !scheduledAtRaw || !durationMinutes || !priceRubles) {
    redirect("/teacher/schedule?error=missing_fields");
  }

  const scheduledAt = new Date(scheduledAtRaw);
  if (Number.isNaN(scheduledAt.getTime())) {
    redirect("/teacher/schedule?error=invalid_date");
  }

  try {
    await createLessonForStudent({
      teacherId: user.teacherId!,
      studentLinkId,
      scheduledAt,
      durationMinutes,
      priceCents: Math.round(priceRubles * 100),
      notes: notes || undefined,
    });
  } catch {
    redirect("/teacher/schedule?error=create_failed");
  }

  redirect("/teacher/schedule?created=1");
}

export async function updateLessonStatusAction(formData: FormData): Promise<void> {
  const user = await requireRole("teacher");
  const lessonId = String(formData.get("lessonId") ?? "");
  const status = String(formData.get("status") ?? "") as LessonStatus;

  if (!lessonId || !VALID_STATUSES.includes(status)) {
    redirect("/teacher/schedule?error=invalid_status");
  }

  try {
    await updateLessonStatus(user.teacherId!, lessonId, status);
  } catch {
    redirect("/teacher/schedule?error=update_failed");
  }

  redirect("/teacher/schedule?updated=1");
}

export async function toggleLessonPaidAction(formData: FormData): Promise<void> {
  const user = await requireRole("teacher");
  const lessonId = String(formData.get("lessonId") ?? "");
  const paid = formData.get("paid") === "true";

  try {
    await setLessonPaid(user.teacherId!, lessonId, paid);
  } catch {
    redirect("/teacher/schedule?error=update_failed");
  }

  redirect("/teacher/schedule?updated=1");
}
