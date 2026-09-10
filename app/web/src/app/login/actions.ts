"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { login } from "../../lib/auth/login";
import { SESSION_COOKIE_NAME } from "../../lib/auth/current-user";

/**
 * No rate limiting yet (docs/SECURITY.md §4 calls for 5 attempts / 15 min per IP+email) —
 * that needs shared state (in-memory limiter or Redis) that doesn't exist yet in Phase 1.
 * Tracked as a gap, not silently dropped: must land before this goes anywhere near real
 * users, see docs/ROADMAP.md Phase 1 checklist.
 */
export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  if (!email || !password) {
    redirect(`/login?error=missing_fields${next ? `&next=${encodeURIComponent(next)}` : ""}`);
  }

  const result = await login(email, password);
  if (!result.ok) {
    redirect(`/login?error=invalid_credentials${next ? `&next=${encodeURIComponent(next)}` : ""}`);
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
