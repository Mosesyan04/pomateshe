"use server";

import { redirect } from "next/navigation";
import { requireRole, assertEmailVerified } from "../../../lib/auth/current-user";
import { setLessonPaid } from "../../../server/lessons";
import { createEmailVerificationToken } from "../../../lib/auth/email-verification";
import { sendEmail } from "../../../lib/email/send-email";
import { checkAndRecord } from "../../../lib/rate-limit";
import { prisma } from "../../../server/db";

/**
 * Same underlying setLessonPaid as src/app/teacher/schedule/actions.ts's
 * toggleLessonPaidAction, but redirects back to /teacher/dashboard — reusing that action
 * directly would have bounced a teacher marking a lesson paid from here over to
 * /teacher/schedule instead, since its redirect target is hardcoded to that page.
 */
export async function markLessonPaidFromDashboardAction(formData: FormData): Promise<void> {
  const user = await requireRole("teacher");
  assertEmailVerified(user, "/teacher/dashboard");
  const lessonId = String(formData.get("lessonId") ?? "");

  try {
    await setLessonPaid(user.teacherId!, lessonId, true);
  } catch {
    redirect("/teacher/dashboard?error=update_failed");
  }

  redirect("/teacher/dashboard?updated=1");
}

const RESEND_VERIFICATION_LIMIT = 3;
const RESEND_VERIFICATION_WINDOW_MS = 60 * 60 * 1000; // 3 / hour per user — a legitimate
// teacher rarely needs more than one or two resends; this just caps accidental button-mashing.

/**
 * Deliberately NOT gated by assertEmailVerified — that would make it impossible for the one
 * teacher who actually needs this button (an unverified one) to ever click it.
 */
export async function resendVerificationEmailAction(): Promise<void> {
  const user = await requireRole("teacher");
  if (user.emailVerified) {
    redirect("/teacher/dashboard");
  }

  const { limited, retryAfterSeconds } = checkAndRecord(
    `resend-verification:${user.userId}`,
    RESEND_VERIFICATION_LIMIT,
    RESEND_VERIFICATION_WINDOW_MS,
  );
  if (limited) {
    redirect(`/teacher/dashboard?error=rate_limited&retryAfter=${retryAfterSeconds}`);
  }

  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });

  const { token } = await createEmailVerificationToken(user.userId);
  const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/verify-email/${token}`;
  await sendEmail({
    to: dbUser.email,
    subject: "Подтвердите email — Pomateshe",
    text: `Подтвердите свой email, перейдя по ссылке (действует 24 часа):\n${verifyUrl}`,
  });

  redirect("/teacher/dashboard?resent=1");
}
