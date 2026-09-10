import { describe, it, expect } from "vitest";
import { parseDateRange } from "../date-range";

describe("parseDateRange", () => {
  it("defaults to the last 30 days ending today when nothing is given", () => {
    const range = parseDateRange(undefined, undefined);
    const spanDays = Math.round((range.toExclusive.getTime() - range.from.getTime()) / (24 * 60 * 60 * 1000));
    expect(spanDays).toBe(30);
    const today = new Date().toISOString().slice(0, 10);
    expect(range.toInput).toBe(today);
  });

  it("parses explicit from/to and makes the upper bound exclusive (the day after 'to')", () => {
    const range = parseDateRange("2026-01-01", "2026-01-10");
    expect(range.fromInput).toBe("2026-01-01");
    expect(range.toInput).toBe("2026-01-10");
    // "to" is inclusive in the UI but the query boundary must be the day AFTER it.
    expect(range.toExclusive.toISOString().slice(0, 10)).toBe("2026-01-11");
  });

  it("falls back to the default range when 'to' is before 'from'", () => {
    const range = parseDateRange("2026-05-10", "2026-05-01");
    const spanDays = Math.round((range.toExclusive.getTime() - range.from.getTime()) / (24 * 60 * 60 * 1000));
    expect(spanDays).toBe(30);
  });

  it("falls back to the default range on garbage input", () => {
    const range = parseDateRange("not-a-date", "also-not-a-date");
    const spanDays = Math.round((range.toExclusive.getTime() - range.from.getTime()) / (24 * 60 * 60 * 1000));
    expect(spanDays).toBe(30);
  });

  it("clamps an overly large range to the maximum span instead of erroring", () => {
    const range = parseDateRange("2000-01-01", "2026-01-01");
    const spanDays = Math.round((range.toExclusive.getTime() - range.from.getTime()) / (24 * 60 * 60 * 1000));
    expect(spanDays).toBeLessThanOrEqual(366);
    // The clamp keeps the requested end date, moving "from" forward instead.
    expect(range.toInput).toBe("2026-01-01");
  });

  it("a single-day range (from === to) still produces a valid one-day span, not the fallback", () => {
    const range = parseDateRange("2026-03-15", "2026-03-15");
    const spanDays = Math.round((range.toExclusive.getTime() - range.from.getTime()) / (24 * 60 * 60 * 1000));
    expect(spanDays).toBe(1);
  });
});
