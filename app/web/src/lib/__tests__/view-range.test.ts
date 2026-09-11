import { describe, it, expect } from "vitest";
import {
  parseViewRange,
  shiftAnchor,
  toDateInput,
  daysInRange,
  monthGridDays,
  startOfWeekUtc,
} from "../calendar/view-range";

describe("startOfWeekUtc", () => {
  it("returns the same Monday for every day in that week", () => {
    // 2026-10-05 is a Monday.
    const monday = startOfWeekUtc(new Date("2026-10-05T15:00:00Z"));
    expect(toDateInput(monday)).toBe("2026-10-05");
    expect(toDateInput(startOfWeekUtc(new Date("2026-10-07T00:00:00Z")))).toBe("2026-10-05");
    expect(toDateInput(startOfWeekUtc(new Date("2026-10-11T23:59:00Z")))).toBe("2026-10-05");
  });

  it("handles a Sunday correctly (belongs to the PREVIOUS Monday's week)", () => {
    expect(toDateInput(startOfWeekUtc(new Date("2026-10-11T12:00:00Z")))).toBe("2026-10-05");
  });
});

describe("parseViewRange", () => {
  it("defaults to week view anchored on today when nothing is given", () => {
    const range = parseViewRange(undefined, undefined);
    expect(range.view).toBe("week");
    const spanDays = (range.toExclusive.getTime() - range.from.getTime()) / (24 * 60 * 60 * 1000);
    expect(spanDays).toBe(7);
  });

  it("day view spans exactly one day", () => {
    const range = parseViewRange("day", "2026-10-05");
    expect(toDateInput(range.from)).toBe("2026-10-05");
    expect(toDateInput(range.toExclusive)).toBe("2026-10-06");
  });

  it("week view spans Monday through the following Monday (exclusive)", () => {
    const range = parseViewRange("week", "2026-10-07"); // a Wednesday
    expect(toDateInput(range.from)).toBe("2026-10-05"); // Monday
    expect(toDateInput(range.toExclusive)).toBe("2026-10-12"); // next Monday
  });

  it("month view spans the 1st through the 1st of next month, regardless of month length", () => {
    const feb = parseViewRange("month", "2026-02-15");
    expect(toDateInput(feb.from)).toBe("2026-02-01");
    expect(toDateInput(feb.toExclusive)).toBe("2026-03-01");
  });

  it("falls back to week view on an unrecognized view string", () => {
    const range = parseViewRange("year", "2026-10-05");
    expect(range.view).toBe("week");
  });

  it("falls back to today's anchor on an invalid date", () => {
    const range = parseViewRange("day", "not-a-date");
    expect(toDateInput(range.anchor)).toBe(toDateInput(new Date()));
  });
});

describe("shiftAnchor", () => {
  it("shifts by one day in day view", () => {
    const range = parseViewRange("day", "2026-10-05");
    expect(toDateInput(shiftAnchor(range, 1))).toBe("2026-10-06");
    expect(toDateInput(shiftAnchor(range, -1))).toBe("2026-10-04");
  });

  it("shifts by seven days in week view", () => {
    const range = parseViewRange("week", "2026-10-05");
    expect(toDateInput(shiftAnchor(range, 1))).toBe("2026-10-12");
    expect(toDateInput(shiftAnchor(range, -1))).toBe("2026-09-28");
  });

  it("shifts by a calendar month in month view, handling different month lengths", () => {
    const jan31 = parseViewRange("month", "2026-01-31");
    // Anchor for month view is normalized to the 1st internally via `from`, but shiftAnchor
    // operates on `range.anchor` (the raw parsed date) — verify it still lands in the right month.
    expect(toDateInput(shiftAnchor(jan31, 1)).slice(0, 7)).toBe("2026-02");
    expect(toDateInput(shiftAnchor(jan31, -1)).slice(0, 7)).toBe("2025-12");
  });
});

describe("daysInRange", () => {
  it("returns one Date per day, from inclusive to exclusive", () => {
    const days = daysInRange(new Date("2026-10-05T00:00:00Z"), new Date("2026-10-08T00:00:00Z"));
    expect(days.map(toDateInput)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
  });
});

describe("monthGridDays", () => {
  it("pads to full Monday-start weeks covering the whole month", () => {
    // October 2026: 1st is a Thursday, 31st is a Saturday.
    const days = monthGridDays(new Date("2026-10-01T00:00:00Z"), new Date("2026-11-01T00:00:00Z"));
    expect(days.length % 7).toBe(0);
    // The grid must start on a Monday on/before Oct 1, and end on/after Oct 31.
    expect(toDateInput(days[0])).toBe("2026-09-28");
    expect(toDateInput(days[days.length - 1])).toBe("2026-11-01");
    expect(days.map(toDateInput)).toContain("2026-10-01");
    expect(days.map(toDateInput)).toContain("2026-10-31");
  });
});
