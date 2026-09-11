import { getCurrentUser } from "../../../../lib/auth/current-user";
import { verifyEmailWithToken } from "../../../../lib/auth/email-verification";

/**
 * The link sent by src/app/register/actions.ts. A plain GET (clicking the email link should
 * just work, no extra button/form) — same shape as the Google Calendar OAuth callback
 * (src/app/api/google-calendar/callback/route.ts): verify, then redirect somewhere sensible
 * with a query param the destination page renders a message for.
 */
export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const result = await verifyEmailWithToken(token);

  // The browser that clicks the link may or may not still be signed in as that teacher (a
  // different device, an expired session, or simply a different browser than the one they
  // registered in) — land them on login if not, dashboard if so, either way with the same
  // query param so the page can show the right message.
  const user = await getCurrentUser();
  const destination = user
    ? user.role === "teacher"
      ? "/teacher/dashboard"
      : "/student/dashboard"
    : "/login";
  const query = result.ok ? "emailVerified=1" : "error=invalid_or_expired";

  return Response.redirect(new URL(`${destination}?${query}`, request.url));
}
