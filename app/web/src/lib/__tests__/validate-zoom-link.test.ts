import { describe, it, expect } from "vitest";
import { isValidZoomUrl } from "../zoom/validate-link";

describe("isValidZoomUrl", () => {
  it("accepts a standard Zoom meeting URL", () => {
    expect(isValidZoomUrl("https://us02web.zoom.us/j/1234567890?pwd=abc")).toBe(true);
  });

  it("accepts the bare zoom.us domain", () => {
    expect(isValidZoomUrl("https://zoom.us/my/someteacher")).toBe(true);
  });

  it("rejects http (not https)", () => {
    expect(isValidZoomUrl("http://zoom.us/j/1234567890")).toBe(false);
  });

  it("rejects a non-Zoom domain, even one that contains 'zoom'", () => {
    expect(isValidZoomUrl("https://notzoom.us.evil.example.com/j/123")).toBe(false);
  });

  it("rejects a domain that merely ends similarly but isn't a zoom.us subdomain", () => {
    expect(isValidZoomUrl("https://evilzoom.us/j/123")).toBe(false);
  });

  it("rejects garbage input", () => {
    expect(isValidZoomUrl("not a url at all")).toBe(false);
    expect(isValidZoomUrl("")).toBe(false);
  });
});
