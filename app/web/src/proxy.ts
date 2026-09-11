import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "./lib/auth/current-user";

/**
 * Next.js 16 renamed `middleware.ts` to `proxy.ts` (same runtime, different name) — this
 * project targets that version, see AGENTS.md's own warning about relying on training data
 * for this framework's conventions.
 *
 * Two independent jobs live here, both cheap enough to run on every request:
 *
 * 1. Optimistic auth redirect for /teacher, /student, and /admin — docs/ARCHITECTURE.md §5:
 *    "Middleware проверяет сессию и роль только для UX ... все реальные проверки доступа
 *    дублируются на сервере". Looks at cookie PRESENCE only, nothing more — it cannot query
 *    Postgres here (Next's own guidance: proxy "should not be used as a full session
 *    management or authorization solution"). Real enforcement is
 *    getCurrentUser()/requireRole() (src/lib/auth/current-user.ts), called from every
 *    protected layout — a forged or stale cookie that passes this presence check gets
 *    rejected there, on the very next hop.
 * 2. Security response headers — docs/SECURITY.md §6.
 */

const isDev = process.env.NODE_ENV === "development";

export function proxy(request: NextRequest) {
  // --- CSP nonce (per request, per docs/SECURITY.md §6: "строгий, без unsafe-inline для
  // скриптов") — generated here because it must be unique per response; a static value in
  // next.config.ts couldn't do this. Forces every matched route to render dynamically (Next's
  // own documented tradeoff for nonce-based CSP) — acceptable here since every route this
  // proxy matches already reads cookies()/searchParams and was dynamic already (confirmed via
  // `next build` output); none of Phase 1's pages lost static optimization because of this.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  // style-src deliberately does NOT use the nonce, unlike script-src — this is not an
  // oversight. CSP's nonce-source only ever applies to <script>/<style> ELEMENTS, never to
  // the inline `style="..."` HTML ATTRIBUTE that our pages currently render via React's
  // `style={{...}}` JSX prop (docs/ROADMAP.md Phase 2 / docs/DESIGN_SYSTEM.md should move
  // these to CSS Modules, at which point style-src can drop 'unsafe-inline' too). Worse: per
  // the CSP3 spec, when a nonce-source IS present in a directive, browsers ignore
  // 'unsafe-inline' in that SAME directive entirely — so combining `'nonce-x' 'unsafe-inline'`
  // in style-src wouldn't relax anything, it would silently break both Next's own nonce'd
  // <style> tags and our inline attributes at once. Keeping style-src nonce-free and
  // unsafe-inline-only avoids that trap; script-src has no such attribute-vs-element
  // distinction to worry about and stays strict.
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""};
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob: data:;
    font-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `;
  const contentSecurityPolicyHeaderValue = cspHeader.replace(/\s{2,}/g, " ").trim();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicyHeaderValue);

  // --- Route protection (unchanged logic, now living alongside the headers above) ---
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);
  const { pathname } = request.nextUrl;
  const isProtected =
    pathname.startsWith("/teacher") || pathname.startsWith("/student") || pathname.startsWith("/admin");

  let response: NextResponse;
  if (isProtected && !hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    response = NextResponse.redirect(loginUrl);
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  response.headers.set("Content-Security-Policy", contentSecurityPolicyHeaderValue);
  // HSTS is a no-op over plain HTTP (browsers only honor it on a response received over
  // HTTPS) — safe to always send; it starts mattering the moment TLS is in front in
  // production (docs/DEPLOYMENT.md §2), no environment check needed here.
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // No feature here needs camera/microphone/geolocation/etc. — docs/SECURITY.md §6 says to
  // disable what's unused; nothing is used yet, including on the future whiteboard (Phase 3,
  // docs/WHITEBOARD.md), which doesn't touch device media APIs either.
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  );
  // Not in docs/SECURITY.md §6's explicit list, but directly implied by §5's clickjacking
  // entry ("X-Frame-Options: DENY / frame-ancestors 'none' в CSP") — belt-and-suspenders for
  // browsers that predate frame-ancestors support; frame-ancestors above is the modern,
  // authoritative one.
  response.headers.set("X-Frame-Options", "DENY");

  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
