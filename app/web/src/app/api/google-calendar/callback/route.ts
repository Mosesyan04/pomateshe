import { after } from "next/server";
import { getCurrentUser } from "../../../../lib/auth/current-user";
import { verifyOauthState } from "../../../../lib/google-calendar/oauth-state";
import { exchangeCodeForTokens } from "../../../../lib/google-calendar/client";
import { googleCalendarRedirectUri } from "../../../../lib/google-calendar/redirect-uri";
import { saveCalendarIntegration } from "../../../../server/calendar-integration";
import { backfillFutureLessonsToGoogleCalendar } from "../../../../server/calendar-sync";

/**
 * Google's redirect target — see docs/CALENDAR.md §2. THIS IS THE EXACT redirect_uri TO
 * REGISTER IN GOOGLE CLOUD CONSOLE: `${NEXT_PUBLIC_APP_URL}/api/google-calendar/callback`
 * (e.g. `https://pomateshe.example/api/google-calendar/callback` in production,
 * `http://localhost:3100/api/google-calendar/callback` for local dev) — must match
 * NEXT_PUBLIC_APP_URL byte-for-byte, no trailing slash (see .env.example).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirectToProfile = (query: string) =>
    Response.redirect(new URL(`/teacher/profile${query}`, request.url));

  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    // User clicked "Cancel" on Google's consent screen, or Google itself errored — not a bug.
    return redirectToProfile("?calendarError=denied");
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return redirectToProfile("?calendarError=invalid_request");
  }

  const verified = verifyOauthState(state);
  if (!verified) {
    // Expired (>10 min since the redirect to Google), tampered, or signed with a stale
    // secret — docs/THREAT_MODEL.md §5's CSRF guard. Never proceed on an unverifiable state.
    return redirectToProfile("?calendarError=invalid_state");
  }

  const user = await getCurrentUser();
  if (!user || user.role !== "teacher" || user.teacherId !== verified.teacherId) {
    // The browser that lands back here isn't logged in as the same teacher who started the
    // flow (session expired, logged out and back in as someone else mid-flow, or state was
    // stolen and replayed from a different browser). Reject rather than attach the tokens to
    // whoever happens to be logged in right now.
    return Response.redirect(new URL("/login", request.url));
  }

  try {
    const tokens = await exchangeCodeForTokens(code, googleCalendarRedirectUri());
    if (!tokens.refreshToken) {
      // buildGoogleAuthorizeUrl always sends prompt=consent, so Google should always include
      // one — a response without it means something is misconfigured (wrong OAuth client
      // type, or Google's behavior changed), not a normal path. Refuse to store an
      // integration that can never refresh itself past the first access token's ~1 hour.
      return redirectToProfile("?calendarError=no_refresh_token");
    }
    await saveCalendarIntegration(user.teacherId!, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });
  } catch (err) {
    console.error("[google-calendar] OAuth callback failed", err);
    return redirectToProfile("?calendarError=exchange_failed");
  }

  // Backfill (future scheduled lessons only, docs/CALENDAR.md's agreed scope) runs after the
  // response is sent — the teacher shouldn't wait on however many lessons they have just to
  // see "Connected" (docs/CALENDAR.md §4: sync is always best-effort, never on the request path).
  after(() => backfillFutureLessonsToGoogleCalendar(user.teacherId!));

  return redirectToProfile("?calendarConnected=1");
}
