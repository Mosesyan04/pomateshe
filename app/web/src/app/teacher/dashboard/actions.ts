"use server";

import { redirect } from "next/navigation";
import { requireRole } from "../../../lib/auth/current-user";
import { setLessonPaid } from "../../../server/lessons";

/**
 * Same underlying setLessonPaid as src/app/teacher/schedule/actions.ts's
 * toggleLessonPaidAction, but redirects back to /teacher/dashboard — reusing that action
 * directly would have bounced a teacher marking a lesson paid from here over to
 * /teacher/schedule instead, since its redirect target is hardcoded to that page.
 */
export async function markLessonPaidFromDashboardAction(formData: FormData): Promise<void> {
  const user = await requireRole("teacher");
  const lessonId = String(formData.get("lessonId") ?? "");

  try {
    await setLessonPaid(user.teacherId!, lessonId, true);
  } catch {
    redirect("/teacher/dashboard?error=update_failed");
  }

  redirect("/teacher/dashboard?updated=1");
}
