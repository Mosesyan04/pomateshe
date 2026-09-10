"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { acceptInviteAsNewUser, acceptInviteForExistingUser } from "../../../server/invites";
import { getCurrentUser, SESSION_COOKIE_NAME } from "../../../lib/auth/current-user";

export async function acceptInviteAsNewUserAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!token || password.length < 10) {
    redirect(`/invite/${token}?error=weak_password`);
  }

  let sessionToken: string;
  let sessionExpiresAt: Date;
  try {
    const { session } = await acceptInviteAsNewUser(token, password);
    sessionToken = session.token;
    sessionExpiresAt = session.expiresAt;
  } catch {
    redirect(`/invite/${token}?error=accept_failed`);
  }

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
