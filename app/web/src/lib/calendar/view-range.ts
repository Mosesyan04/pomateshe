export type CalendarView = "day" | "week" | "month";

export interface ViewRange {
  view: CalendarView;
  /** The anchor date this range was computed for (UTC day boundary). */
  anchor: Date;
  from: Date;
  toExclusive: Date;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Monday 00:00 UTC of the week containing `date` — same convention as
 *  src/server/dashboard.ts's startOfWeek, factored out here since the calendar needs it for
 *  three views, not just the dashboard's one weekly figure. */
export function startOfWeekUtc(date: Date): Date {
  const d = startOfUtcDay(date);
  const day = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d;
}

function startOfMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * Parses ?view=&date= into a concrete query range. Invalid/missing input falls back to
 * "week view, anchored on today" rather than erroring — same philosophy as
 * src/lib/date-range.ts's parseDateRange for the income page.
 */
export function parseViewRange(viewRaw: string | undefined, dateRaw: string | undefined): ViewRange {
  const view: CalendarView = viewRaw === "day" || viewRaw === "month" ? viewRaw : "week";

  const parsedDate = dateRaw ? new Date(dateRaw) : null;
  const anchor =
    parsedDate && !Number.isNaN(parsedDate.getTime()) ? startOfUtcDay(parsedDate) : startOfUtcDay(new Date());

  if (view === "day") {
    return { view, anchor, from: anchor, toExclusive: new Date(anchor.getTime() + DAY_MS) };
  }
  if (view === "month") {
    const from = startOfMonthUtc(anchor);
    const toExclusive = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    return { view, anchor, from, toExclusive };
  }
  const from = startOfWeekUtc(anchor);
  const toExclusive = new Date(from.getTime() + 7 * DAY_MS);
  return { view, anchor, from, toExclusive };
}

/** The anchor date to jump to for the prev/next nav links — one unit of the current view. */
export function shiftAnchor(range: ViewRange, direction: -1 | 1): Date {
  if (range.view === "day") {
    return new Date(range.anchor.getTime() + direction * DAY_MS);
  }
  if (range.view === "week") {
    return new Date(range.anchor.getTime() + direction * 7 * DAY_MS);
  }
  // month: step by calendar months, not a fixed day count (months vary in length).
  return new Date(Date.UTC(range.anchor.getUTCFullYear(), range.anchor.getUTCMonth() + direction, 1));
}

/** YYYY-MM-DD for building nav links / date inputs. */
export function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Every calendar day in [from, toExclusive) — the day columns for week view, the cells for
 *  month view (month view additionally pads to full weeks, see monthGridDays). */
export function daysInRange(from: Date, toExclusive: Date): Date[] {
  const days: Date[] = [];
  for (const cursor = new Date(from); cursor < toExclusive; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    days.push(new Date(cursor));
  }
  return days;
}

/** Month view pads out to full weeks (Monday-start) so the grid has no ragged first/last
 *  row — the extra leading/trailing days belong to the adjacent month and are rendered
 *  visually muted, not fetched as part of the query range (only the actual month's days are). */
export function monthGridDays(monthStart: Date, monthEndExclusive: Date): Date[] {
  const gridStart = startOfWeekUtc(monthStart);
  const lastDay = new Date(monthEndExclusive.getTime() - DAY_MS);
  const gridEndExclusive = new Date(startOfWeekUtc(lastDay).getTime() + 7 * DAY_MS);
  return daysInRange(gridStart, gridEndExclusive);
}
