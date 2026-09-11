/**
 * The Google OAuth `redirect_uri` — fixed, not derived from the incoming request's Host
 * header (docs/CALENDAR.md §2: "redirect_uri — фиксированный, из allowlist в Google Console
 * и на сервере"; docs/THREAT_MODEL.md §5: open-redirect via a spoofed redirect_uri). Reuses
 * NEXT_PUBLIC_APP_URL, already the app's one source of truth for its own absolute origin
 * (src/app/teacher/profile/page.tsx's public-profile link, invite links).
 */
export function googleCalendarRedirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not set — required to build a fixed Google OAuth redirect_uri. " +
        "See .env.example.",
    );
  }
  return `${base.replace(/\/$/, "")}/api/google-calendar/callback`;
}
