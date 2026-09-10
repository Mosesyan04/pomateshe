"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { acceptInviteAsNewUser, acceptInviteForExistingUser } from "../../../server/invites";
import { recordConsent } from "../../../server/consents";
import { getCurrentUser, SESSION_COOKIE_NAME } from "../../../lib/auth/current-user";
import { getClientIp } from "../../../lib/http/client-ip";
import { POLICY_VERSION } from "../../../lib/legal/policy-version";

export async function acceptInviteAsNewUserAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  // Same principle as registerTeacherAction — the `required` checkbox is UX, not the gate.
  const consentGiven = formData.get("consent") === "on";

  if (!token || password.length < 10) {
    redirect(`/invite/${token}?error=weak_password`);
  }
  if (!consentGiven) {
    redirect(`/invite/${token}?error=missing_consent`);
  }

  let sessionToken: string;
  let sessionExpiresAt: Date;
  let userId: string;
  try {
    const result = await acceptInviteAsNewUser(token, password);
    sessionToken = result.session.token;
    sessionExpiresAt = result.session.expiresAt;
    userId = result.userId;
  } catch {
    redirect(`/invite/${token}?error=accept_failed`);
  }

  const ip = await getClientIp();
  const userAgent = (await headers()).get("user-agent");
  await recordConsent({
    userId,
    // No "offer" here — docs/CONSENTS.md §2's table requires it for teachers only.
    types: ["privacy_policy", "pdn_processing"],
    policyVersion: POLICY_VERSION,
    ip,
    userAgent,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: sessionExpiresAt,
    path: "/",
  });

  redirect("/student/dashboard?welcome=1");
}

/** For an already-registered student who logged in first, then confirms linking to the new teacher. */
export async function confirmInviteForExistingUserAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/login?next=/invite/${token}`);
  }

  try {
    await acceptInviteForExistingUser(token, user.userId);
  } catch {
    redirect(`/invite/${token}?error=accept_failed`);
  }

  redirect("/student/dashboard?linked=1");
}
