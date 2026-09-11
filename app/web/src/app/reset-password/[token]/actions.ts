"use server";

import { redirect } from "next/navigation";
import { resetPasswordWithToken } from "../../../lib/auth/password-reset";

export async function resetPasswordAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("passwordConfirm") ?? "");

  if (!token) {
    redirect("/forgot-password?error=missing_fields");
  }
  if (!password) {
    redirect(`/reset-password/${token}?error=missing_fields`);
  }
  if (password.length < 10) {
    // Same placeholder minimum as registration (src/app/register/actions.ts) — not a claimed
    // final password policy, just kept consistent between the two places a password is set.
    redirect(`/reset-password/${token}?error=weak_password`);
  }
  if (password !== passwordConfirm) {
    redirect(`/reset-password/${token}?error=mismatch`);
  }

  const result = await resetPasswordWithToken(token, password);
  if (!result.ok) {
    redirect(`/reset-password/${token}?error=invalid_or_expired`);
  }

  redirect("/login?reset=1");
}
