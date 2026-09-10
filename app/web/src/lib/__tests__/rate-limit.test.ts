import { describe, it, expect, beforeEach, vi } from "vitest";
import { isRateLimited, recordAttempt, checkAndRecord, _resetRateLimitsForTests } from "../rate-limit";

beforeEach(() => {
  _resetRateLimitsForTests();
  vi.useRealTimers();
});

describe("rate-limit", () => {
  it("isRateLimited never blocks on its own — it only reads, never consumes an attempt", () => {
    const key = "peek-only";
    for (let i = 0; i < 50; i++) {
      expect(isRateLimited(key, 5).limited).toBe(false);
    }
  });

  it("recordAttempt + isRateLimited: blocks once the limit is reached within the window", () => {
    const key = "login:1.2.3.4:someone@example.com";
    const limit = 5;
    const windowMs = 15 * 60 * 1000;

    for (let i = 0; i < limit; i++) {
      expect(isRateLimited(key, limit).limited).toBe(false);
      recordAttempt(key, windowMs);
    }

    // The 6th check, after 5 recorded attempts, must now be blocked.
    const result = isRateLimited(key, limit);
    expect(result.limited).toBe(true);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("a successful login (no recordAttempt call) never pushes the counter toward the limit", () => {
    const key = "login:1.2.3.4:real-user@example.com";
    const limit = 5;
    const windowMs = 15 * 60 * 1000;

    // Simulate 4 failed attempts, then a success (no recordAttempt), then more failures.
    for (let i = 0; i < 4; i++) recordAttempt(key, windowMs);
    expect(isRateLimited(key, limit).limited).toBe(false); // still under the limit

    // "successful login" = no recordAttempt call here, by design.

    recordAttempt(key, windowMs); // 5th failure
    expect(isRateLimited(key, limit).limited).toBe(true); // now blocked
  });

  it("checkAndRecord blocks on the (limit+1)th call within the window, regardless of outcome", () => {
    const key = "register:5.6.7.8";
    const limit = 3;
    const windowMs = 60 * 60 * 1000;

    expect(checkAndRecord(key, limit, windowMs).limited).toBe(false);
    expect(checkAndRecord(key, limit, windowMs).limited).toBe(false);
    expect(checkAndRecord(key, limit, windowMs).limited).toBe(false);
    const fourth = checkAndRecord(key, limit, windowMs);
    expect(fourth.limited).toBe(true);
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("different keys (different IP/email pairs) never interfere with each other", () => {
    const limit = 2;
    const windowMs = 1000;

    recordAttempt("login:1.1.1.1:a@example.com", windowMs);
    recordAttempt("login:1.1.1.1:a@example.com", windowMs);
    expect(isRateLimited("login:1.1.1.1:a@example.com", limit).limited).toBe(true);

    // Same IP, different email — must not be blocked by a's attempts.
    expect(isRateLimited("login:1.1.1.1:b@example.com", limit).limited).toBe(false);
    // Different IP, same email — must not be blocked either.
    expect(isRateLimited("login:2.2.2.2:a@example.com", limit).limited).toBe(false);
  });

  it("resets after the window expires", () => {
    vi.useFakeTimers();
    const key = "login:9.9.9.9:expiring@example.com";
    const limit = 2;
    const windowMs = 1000;

    recordAttempt(key, windowMs);
    recordAttempt(key, windowMs);
    expect(isRateLimited(key, limit).limited).toBe(true);

    vi.advanceTimersByTime(windowMs + 1);

    expect(isRateLimited(key, limit).limited).toBe(false);
    vi.useRealTimers();
  });
});
