"use server";

import { redirect } from "next/navigation";
import { prisma } from "../../server/db";
import { createPasswordResetToken } from "../../lib/auth/password-reset";
import { sendEmail } from "../../lib/email/send-email";
import { checkAndRecord } from "../../lib/rate-limit";
import { getClientIp } from "../../lib/http/client-ip";

const RESET_REQUEST_LIMIT = 3;
const RESET_REQUEST_WINDOW_MS = 60 * 60 * 1000; // 3 / hour per (IP, email) — generous for a
// legitimate user who mistypes their email once, still a real cap on abuse.

export async function requestPasswordResetAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email) {
    redirect("/forgot-password?error=missing_fields");
  }

  const ip = await getClientIp();
  const { limited, retryAfterSeconds } = checkAndRecord(
    `password-reset:${ip}:${email}`,
    RESET_REQUEST_LIMIT,
    RESET_REQUEST_WINDOW_MS,
  );
  if (limited) {
    redirect(`/forgot-password?error=rate_limited&retryAfter=${retryAfterSeconds}`);
  }

  // docs/AUTH.md §6: "Ответ API не раскрывает, существует ли email в системе" — the redirect
  // below is identical whether or not a matching, non-disabled user is found. Everything that
  // differs (looking the user up, creating a token, sending the email) happens before it,
  // never after, so there's no timing signal from a redirect that fires earlier for one case.
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && !user.disabledAt) {
    const { token } = await createPasswordResetToken(user.id);
    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/reset-password/${token}`;
    await sendEmail({
      to: user.email,
      subject: "Восстановление пароля — Pomateshe",
      text:
        `Чтобы задать новый пароль, перейдите по ссылке (действует 1 час):\n${resetUrl}\n\n` +
        `Если вы не запрашивали восстановление пароля, просто игнорируйте это письмо.`,
    });
  }

  redirect("/forgot-password?sent=1");
}
