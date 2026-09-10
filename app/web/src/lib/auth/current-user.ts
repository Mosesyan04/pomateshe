import { cache } from "react";
import { cookies } from "next/headers";
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
    return { userId: session.userId, role: "teacher", teacherId: session.teacherProfileId };
  }

  return { userId: session.userId, role: session.role };
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
