"use server";

import { redirect } from "next/navigation";
import { requireRole } from "../../../lib/auth/current-user";
import {
  createPersonalEvent,
  reschedulePersonalEvent,
  deletePersonalEvent,
} from "../../../server/personal-events";

export async function reschedulePersonalEventFromCalendarAction(
  eventId: string,
  newScheduledAtIso: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireRole("student");
  try {
    await reschedulePersonalEvent(user.userId, eventId, new Date(newScheduledAtIso));
    return { ok: true };
  } catch {
    return { ok: false, error: "Не удалось перенести событие." };
  }
}

/**
 * A student never reschedules a lesson — only the teacher who created it can (the product
 * rule this whole feature was built around: whoever scheduled it edits it). The grid never
 * offers a drag handle on a lesson item here (editable: false, set in page.tsx), so this only
 * runs if someone calls the action directly, bypassing the UI — still enforced server-side,
 * never trusting that the client honored the flag.
 */
export async function rescheduleLessonForbiddenAction(
  ...[]: [lessonId: string, newScheduledAtIso: string]
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("student");
  return { ok: false, error: "Ученик не может переносить уроки." };
}

export async function createPersonalEventAction(formData: FormData): Promise<void> {
  const user = await requireRole("student");
  const title = String(formData.get("title") ?? "").trim();
  const scheduledAtRaw = String(formData.get("scheduledAt") ?? "");
  const durationMinutes = Number(formData.get("durationMinutes"));

  if (!title || !scheduledAtRaw || !durationMinutes) {
    redirect("/student/calendar?error=missing_fields");
  }
  const scheduledAt = new Date(scheduledAtRaw);
  if (Number.isNaN(scheduledAt.getTime())) {
    redirect("/student/calendar?error=invalid_date");
  }

  await createPersonalEvent({ ownerUserId: user.userId, title, scheduledAt, durationMinutes });
  redirect("/student/calendar?created=1");
}

export async function deletePersonalEventAction(formData: FormData): Promise<void> {
  const user = await requireRole("student");
  const eventId = String(formData.get("eventId") ?? "");
  if (eventId) {
    await deletePersonalEvent(user.userId, eventId).catch(() => {});
  }
  redirect("/student/calendar?deleted=1");
}
