import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validateSession } from "./session";

export const SESSION_COOKIE_NAME = "pomateshe_session";

/**
 * The real access check — docs/ARCHITECTURE.md §5: middleware only redirects for UX, this
 * is what actually decides who someone is, called from every protected layout/page/Server
 * Action, never trusted from client-supplied data. Role and teacherId/studentUserId are
 * re-read from the DB on every call, not cached in the cookie itself (docs/AUTH.md §7) — so
 * a role change or account disablement by an admin takes effect on the very next request,
 * not after the session happens to expire.
 */

export interface CurrentUser {
  userId: string;
  role: "admin" | "teacher" | "student";
  /** Present only for role === "teacher". */
  teacherId?: string;
  /** Always true for a student/admin (never sent a verification email in the first place —
   *  docs/AUTH.md §3 only verifies teacher email). Meaningful only for role === "teacher". */
  emailVerified: boolean;
}

/**
 * Wrapped in React's `cache()` — memoized per request only (not across requests/users, see
 * https://react.dev/reference/react/cache), so a layout and the pages it wraps share one
 * session lookup instead of hitting Postgres once per component on the same render pass.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await validateSession(token);
  if (!session) return null;

  if (session.role === "teacher") {
    // Read directly off the (non-RLS) User row via validateSession's join — NOT a fresh
    // teacherProfile.findUnique({ where: { userId } }) query. That query would hit
    // teacher_profiles' RLS with no context set yet (finding the context IS the point of
    // this lookup) and silently return zero rows every time — the actual Phase 1 bug this
    // fix replaced. See the User.teacherProfileId comment in schema.prisma.
    if (!session.teacherProfileId) return null;
    return {
      userId: session.userId,
      role: "teacher",
      teacherId: session.teacherProfileId,
      emailVerified: session.emailVerifiedAt != null,
    };
  }

  return { userId: session.userId, role: session.role, emailVerified: true };
});

/**
 * Throws (never silently returns a mismatched user) so a protected layout that forgets to
 * check the return value doesn't accidentally render for the wrong role. Callers in Server
 * Components should catch via Next's redirect() — see src/app/teacher/layout.tsx and
 * src/app/student/layout.tsx for the actual redirect behavior; this function intentionally
 * doesn't redirect itself so it stays usable from Server Actions too, where a thrown error
 * is the right shape.
 */
export async function requireRole(role: "teacher" | "student"): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user || user.role !== role) {
    throw new Error(`UNAUTHORIZED: expected role "${role}"`);
  }
  return user;
}

/**
 * docs/AUTH.md §3: "До подтверждения email — доступ read-only". Call this at the top of every
 * teacher Server Action that WRITES (not the pages/data-access that only read — those must
 * keep working, or a freshly-registered teacher couldn't even see their own dashboard to find
 * the "resend verification" button). Unlike requireRole, this redirects rather than throwing:
 * an unverified email is an expected, everyday state for a legitimate teacher who still has
 * working UI buttons in front of them, not a security violation worth crashing the request
 * over — every other validation failure in this app's actions already redirects with a
 * friendly message (missing fields, rate limits, etc.), this matches that convention instead
 * of requireRole's "throw and let the caller decide" contract, which exists for a different
 * reason (staying usable from contexts requireRole itself doesn't want to assume about).
 *
 * `redirectPath` is the calling action's own page (e.g. "/teacher/schedule") so the teacher
 * lands back where they were, with a clear reason, not on some unrelated screen.
 */
export function assertEmailVerified(user: CurrentUser, redirectPath: string): void {
  if (!user.emailVerified) {
    redirect(`${redirectPath}?error=email_not_verified`);
  }
}

/**
 * The one place that knows where each role lands after login/when it wanders into another
 * role's area — used by src/app/login/actions.ts and every role-scoped layout
 * (src/app/teacher/layout.tsx, src/app/student/layout.tsx, src/app/admin/layout.tsx). Factored
 * out after a real bug this fixed: those three layouts used to hardcode "the other" role's
 * dashboard as the redirect target (e.g. teacher/layout.tsx sending any non-teacher straight
 * to /student/dashboard), which was fine back when only two roles could ever reach a
 * protected layout — the moment an admin account existed, logging in bounced them
 * /student/dashboard -> (student layout: not a student) -> /teacher/dashboard -> (teacher
 * layout: not a teacher) -> /student/dashboard forever. Caught by an actual browser run while
 * verifying scripts/create-admin.ts, not by any unit test.
 */
export function dashboardPathForRole(role: "admin" | "teacher" | "student"): string {
  if (role === "teacher") return "/teacher/dashboard";
  if (role === "student") return "/student/dashboard";
  return "/admin/dashboard";
}
