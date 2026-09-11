import { GoogleTokenRefreshError } from "./errors";

/**
 * Plain `fetch`-based Google OAuth + Calendar API client — deliberately not the `googleapis`
 * npm package (Правило 10 ТЗ: avoid a heavy dependency for what's plain REST/JSON over a
 * handful of endpoints). No real Google credentials exist yet (see docs/CALENDAR.md), so
 * every function here is exercised in tests via a mocked global `fetch`, not a live call.
 */

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

function eventsUrl(calendarId: string, eventId?: string): string {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
}

function requireEnv(name: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — required for Google Calendar OAuth. See .env.example.`);
  }
  return value;
}

export function buildGoogleAuthorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPE,
    access_type: "offline",
    // Forces Google to hand back a refresh_token even if this teacher connected before and
    // is reconnecting — without it, a refresh_token is only ever issued on the very first
    // consent for that Google account+app pair, which would silently leave a reconnect
    // unable to refresh later (docs/CALENDAR.md §4 depends on always having one).
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}

export interface GoogleTokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
}

interface GoogleTokenApiResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<GoogleTokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google OAuth code exchange failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as GoogleTokenApiResponse;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    // Google's documented shape for a dead refresh token (revoked/expired) is
    // {"error": "invalid_grant", ...} — docs/CALENDAR.md §4 wants exactly this case treated
    // as "the teacher must reconnect", distinct from a transient 5xx/rate-limit response.
    const invalidGrant = body.includes("invalid_grant");
    throw new GoogleTokenRefreshError(res.status, body, invalidGrant);
  }
  const data = (await res.json()) as GoogleTokenApiResponse;
  return { accessToken: data.access_token, expiresAt: new Date(Date.now() + data.expires_in * 1000) };
}

export interface GoogleEventInput {
  summary: string;
  startIso: string;
  endIso: string;
  /** Written to extendedProperties.private.pomatesheLessonId — docs/CALENDAR.md §3's matching
   *  key, so a lesson's Google event can be found/identified independent of our own foreign
   *  key (which we also keep, in Lesson.calendarEventId, as the primary lookup path). */
  pomatesheLessonId: string;
}

function toGoogleEventBody(input: GoogleEventInput) {
  return {
    summary: input.summary,
    start: { dateTime: input.startIso },
    end: { dateTime: input.endIso },
    extendedProperties: { private: { pomatesheLessonId: input.pomatesheLessonId } },
  };
}

export async function createGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  input: GoogleEventInput,
): Promise<string> {
  const res = await fetch(eventsUrl(calendarId), {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(toGoogleEventBody(input)),
  });
  if (!res.ok) {
    throw new Error(`Google Calendar event create failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function updateGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  googleEventId: string,
  input: GoogleEventInput,
): Promise<void> {
  const res = await fetch(eventsUrl(calendarId, googleEventId), {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(toGoogleEventBody(input)),
  });
  if (!res.ok) {
    throw new Error(`Google Calendar event update failed (${res.status}): ${await res.text()}`);
  }
}

export async function deleteGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  googleEventId: string,
): Promise<void> {
  const res = await fetch(eventsUrl(calendarId, googleEventId), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // 404/410 — the event is already gone (deleted directly in Google Calendar, or never
  // existed) — that's the outcome we wanted anyway, not a failure to surface.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Google Calendar event delete failed (${res.status}): ${await res.text()}`);
  }
}
