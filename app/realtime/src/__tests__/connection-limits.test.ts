import { describe, it, expect } from "vitest";
import { isOversized, createMessageRateLimiter, MAX_MESSAGE_BYTES } from "../connection-limits.js";

describe("isOversized", () => {
  it("accepts a message right at the cap", () => {
    expect(isOversized(MAX_MESSAGE_BYTES)).toBe(false);
  });

  it("rejects a message one byte over the cap", () => {
    expect(isOversized(MAX_MESSAGE_BYTES + 1)).toBe(true);
  });
});

describe("createMessageRateLimiter", () => {
  it("allows messages within budget for the current window", () => {
    const allow = createMessageRateLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 100; i++) {
      expect(allow(now)).toBe(true);
    }
  });

  it("drops messages once the window's budget is exceeded", () => {
    const allow = createMessageRateLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 100; i++) allow(now);
    expect(allow(now)).toBe(false);
    expect(allow(now)).toBe(false);
  });

  it("resets the budget once a new window starts", () => {
    const allow = createMessageRateLimiter();
    const windowStart = 1_000_000;
    for (let i = 0; i < 100; i++) allow(windowStart);
    expect(allow(windowStart)).toBe(false);

    expect(allow(windowStart + 1000)).toBe(true); // a full second later — fresh window
  });
});
