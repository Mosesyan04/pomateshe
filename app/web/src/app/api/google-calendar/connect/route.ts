import { getCurrentUser } from "../../../../lib/auth/current-user";
import { signOauthState } from "../../../../lib/google-calendar/oauth-state";
import { buildGoogleAuthorizeUrl } from "../../../../lib/google-calendar/client";
import { googleCalendarRedirectUri } from "../../../../lib/google-calendar/redirect-uri";

/**
 * The "Подключить Google Calendar" link on /teacher/profile points straight here — a plain
 * GET navigation (no form, no client JS), matching how every other cross-origin hop in this
 * app works. Teacher-only, initiated from account settings, never from the login screen
 * (docs/CALENDAR.md §2).
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "teacher" || !user.teacherId) {
    return Response.redirect(new URL("/login", request.url));
  }

  const state = signOauthState(user.teacherId);

  try {
    const authorizeUrl = buildGoogleAuthorizeUrl(googleCalendarRedirectUri(), state);
    return Response.redirect(authorizeUrl);
  } catch (err) {
    // GOOGLE_CLIENT_ID / NEXT_PUBLIC_APP_URL missing — a deployment/config problem, not
    // something the teacher can fix by retrying. Fail loudly on /teacher/profile rather than
    // bouncing them to a broken accounts.google.com URL.
    console.error("[google-calendar] cannot start OAuth flow", err);
    return Response.redirect(new URL("/teacher/profile?calendarError=not_configured", request.url));
  }
}
