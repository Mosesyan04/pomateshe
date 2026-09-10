"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { login } from "../../lib/auth/login";
import { SESSION_COOKIE_NAME } from "../../lib/auth/current-user";
import { isRateLimited, recordAttempt } from "../../lib/rate-limit";
import { getClientIp } from "../../lib/http/client-ip";

const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // docs/SECURITY.md §4: 5 attempts / 15 min

export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");
  const nextParam = next ? `&next=${encodeURIComponent(next)}` : "";

  if (!email || !password) {
    redirect(`/login?error=missing_fields${nextParam}`);
  }

  // Keyed on (IP, email) per docs/AUTH.md §4 — not on email alone, so an attacker can't lock
  // a real user out just by repeatedly failing their email from many IPs, and not on IP
  // alone, so one IP failing many different emails doesn't block a shared-IP legitimate user.
  const ip = await getClientIp();
  const rateLimitKey = `login:${ip}:${email.toLowerCase()}`;

  const { limited, retryAfterSeconds } = isRateLimited(rateLimitKey, LOGIN_LIMIT);
  if (limited) {
    redirect(`/login?error=rate_limited&retryAfter=${retryAfterSeconds}${nextParam}`);
  }

  const result = await login(email, password);
  if (!result.ok) {
    // Only failed attempts consume the limit (docs/AUTH.md §4) — a correct password on the
    // Nth try must not have been blocked by the first N-1 mistakes.
    recordAttempt(rateLimitKey, LOGIN_WINDOW_MS);
    redirect(`/login?error=invalid_credentials${nextParam}`);
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, result.session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: result.session.expiresAt,
    path: "/",
  });

  if (next && (next.startsWith("/teacher") || next.startsWith("/student"))) {
    // Only ever redirect within the app's own protected areas — never to an
    // externally-supplied absolute URL (open-redirect guard, docs/SECURITY.md §5).
    redirect(next);
  }

  redirect(result.role === "teacher" ? "/teacher/dashboard" : "/student/dashboard");
}
