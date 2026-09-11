import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildGoogleAuthorizeUrl,
  exchangeCodeForTokens,
  refreshGoogleAccessToken,
  createGoogleCalendarEvent,
  updateGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
} from "../client";
import { GoogleTokenRefreshError } from "../errors";

// No real Google OAuth credentials exist yet (docs/CALENDAR.md) — every network call here is
// against a mocked global fetch, never a live Google endpoint.

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
}

describe("Google Calendar client (fetch-based, mocked network)", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it("builds an authorize URL with the required OAuth params", () => {
    const url = new URL(buildGoogleAuthorizeUrl("https://example.com/callback", "signed-state"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://example.com/callback");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar.events");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("signed-state");
  });

  it("exchanges a code for tokens", async () => {
    global.fetch = mockFetchOnce(200, { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 });
    const tokens = await exchangeCodeForTokens("auth-code", "https://example.com/callback");
    expect(tokens.accessToken).toBe("at-1");
    expect(tokens.refreshToken).toBe("rt-1");
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("throws when the code exchange fails", async () => {
    global.fetch = mockFetchOnce(400, "invalid_grant");
    await expect(exchangeCodeForTokens("bad-code", "https://example.com/callback")).rejects.toThrow(/failed/);
  });

  it("refreshes an access token", async () => {
    global.fetch = mockFetchOnce(200, { access_token: "at-2", expires_in: 3600 });
    const result = await refreshGoogleAccessToken("rt-1");
    expect(result.accessToken).toBe("at-2");
  });

  it("marks a refresh failure as invalidGrant when Google says invalid_grant", async () => {
    global.fetch = mockFetchOnce(400, JSON.stringify({ error: "invalid_grant" }));
    const err = await refreshGoogleAccessToken("revoked-token").catch((e) => e);
    expect(err).toBeInstanceOf(GoogleTokenRefreshError);
    expect((err as InstanceType<typeof GoogleTokenRefreshError>).invalidGrant).toBe(true);
  });

  it("does NOT mark a transient failure as invalidGrant", async () => {
    global.fetch = mockFetchOnce(503, "Service Unavailable");
    const err = await refreshGoogleAccessToken("some-token").catch((e) => e);
    expect(err).toBeInstanceOf(GoogleTokenRefreshError);
    expect((err as InstanceType<typeof GoogleTokenRefreshError>).invalidGrant).toBe(false);
  });

  it("creates a calendar event with the lesson id in extendedProperties", async () => {
    const fetchMock = mockFetchOnce(200, { id: "google-event-1" });
    global.fetch = fetchMock;
    const id = await createGoogleCalendarEvent("access-token", "primary", {
      summary: "Занятие",
      startIso: "2026-10-06T10:00:00.000Z",
      endIso: "2026-10-06T11:00:00.000Z",
      pomatesheLessonId: "lesson-1",
    });
    expect(id).toBe("google-event-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.extendedProperties.private.pomatesheLessonId).toBe("lesson-1");
  });

  it("updates a calendar event by id", async () => {
    const fetchMock = mockFetchOnce(200, {});
    global.fetch = fetchMock;
    await updateGoogleCalendarEvent("access-token", "primary", "google-event-1", {
      summary: "Занятие (перенесено)",
      startIso: "2026-10-07T10:00:00.000Z",
      endIso: "2026-10-07T11:00:00.000Z",
      pomatesheLessonId: "lesson-1",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events/google-event-1");
    expect(init.method).toBe("PATCH");
  });

  it("deletes a calendar event by id", async () => {
    const fetchMock = mockFetchOnce(204, "");
    global.fetch = fetchMock;
    await expect(deleteGoogleCalendarEvent("access-token", "primary", "google-event-1")).resolves.toBeUndefined();
  });

  it("treats a 404 on delete as success (already gone)", async () => {
    global.fetch = mockFetchOnce(404, "Not Found");
    await expect(deleteGoogleCalendarEvent("access-token", "primary", "already-deleted")).resolves.toBeUndefined();
  });

  it("throws on an unexpected delete failure", async () => {
    global.fetch = mockFetchOnce(500, "Internal Server Error");
    await expect(deleteGoogleCalendarEvent("access-token", "primary", "some-event")).rejects.toThrow(/failed/);
  });
});
