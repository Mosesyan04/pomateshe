import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "./lib/auth/current-user";

/**
 * Next.js 16 renamed `middleware.ts` to `proxy.ts` (same runtime, different name) — this
 * project targets that version, see AGENTS.md's own warning about relying on training data
 * for this framework's conventions.
 *
 * This is an OPTIMISTIC check only — docs/ARCHITECTURE.md §5: "Middleware проверяет сессию и
 * роль только для UX ... все реальные проверки доступа дублируются на сервере". It looks at
 * cookie PRESENCE, nothing more. It cannot query Postgres to validate the token or look up a
 * role (Next's own guidance: proxy "should not be used as a full session management or
 * authorization solution", and it runs before the request reaches a Server Component where a
 * real DB-backed check happens anyway). The actual enforcement — is this token valid, does
 * this user's role match this route — lives in getCurrentUser()/requireRole()
 * (src/lib/auth/current-user.ts), called from every protected layout. A forged or stale
 * cookie that passes this presence check gets rejected there, on the very next hop.
 */
export function proxy(request: NextRequest) {
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);
  const { pathname } = request.nextUrl;

  const isProtected = pathname.startsWith("/teacher") || pathname.startsWith("/student");

  if (isProtected && !hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/teacher/:path*", "/student/:path*"],
};
