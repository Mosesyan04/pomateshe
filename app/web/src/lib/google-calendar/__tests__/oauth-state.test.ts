import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signOauthState, verifyOauthState } from "../oauth-state";

describe("oauth-state (signed, TTL-bound Google OAuth `state` param)", () => {
  const originalSecret = process.env.AUTH_SECRET;

  beforeAll(() => {
    process.env.AUTH_SECRET = "test-auth-secret-do-not-use-in-prod";
  });

  afterAll(() => {
    process.env.AUTH_SECRET = originalSecret;
    vi.useRealTimers();
  });

  it("round-trips a valid, freshly-signed state back to its teacherId", () => {
    const state = signOauthState("teacher-abc123");
    expect(verifyOauthState(state)).toEqual({ teacherId: "teacher-abc123" });
  });

  it("rejects a state whose TTL has expired", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const state = signOauthState("teacher-ttl");
    vi.setSystemTime(new Date("2026-01-01T00:11:00Z")); // 11 min later, TTL is 10
    expect(verifyOauthState(state)).toBeNull();
    vi.useRealTimers();
  });

  it("accepts a state right up to (but not past) its TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const state = signOauthState("teacher-edge");
    vi.setSystemTime(new Date("2026-01-01T00:09:59Z")); // just under 10 min
    expect(verifyOauthState(state)).toEqual({ teacherId: "teacher-edge" });
    vi.useRealTimers();
  });

  it("rejects a state signed with a different secret (tampered or replayed across a secret rotation)", () => {
    const state = signOauthState("teacher-xyz");
    process.env.AUTH_SECRET = "a-different-secret";
    expect(verifyOauthState(state)).toBeNull();
    process.env.AUTH_SECRET = "test-auth-secret-do-not-use-in-prod";
  });

  it("rejects a state with a tampered teacherId (signature no longer matches)", () => {
    const state = signOauthState("teacher-real");
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const [, expiresAt, signature] = decoded.split(".");
    const forged = Buffer.from(`teacher-attacker.${expiresAt}.${signature}`, "utf8").toString("base64url");
    expect(verifyOauthState(forged)).toBeNull();
  });

  it("rejects garbage input instead of throwing", () => {
    expect(verifyOauthState("not-valid-base64url-!!!")).toBeNull();
    expect(verifyOauthState("")).toBeNull();
    expect(verifyOauthState(Buffer.from("only.two", "utf8").toString("base64url"))).toBeNull();
  });
});
