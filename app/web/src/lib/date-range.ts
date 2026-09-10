const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 366; // keeps the chart from rendering an unbounded number of bars

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export interface ParsedDateRange {
  /** Inclusive, UTC day boundary. */
  from: Date;
  /** EXCLUSIVE, UTC day boundary — from + 1 day past the human-picked "to" date. */
  toExclusive: Date;
  /** What to put back in the date-range form's inputs, YYYY-MM-DD. */
  fromInput: string;
  toInput: string;
}

/**
 * Parses the ?from=&to= query params from /teacher/income into a query-ready range.
 * Invalid or missing input falls back to "last 30 days ending today" rather than erroring —
 * a bad date in the URL shouldn't break the page, just reset the filter.
 */
export function parseDateRange(fromRaw: string | undefined, toRaw: string | undefined): ParsedDateRange {
  const today = startOfUtcDay(new Date());
  const defaultFrom = new Date(today.getTime() - (DEFAULT_RANGE_DAYS - 1) * DAY_MS);
  const defaultToExclusive = new Date(today.getTime() + DAY_MS);

  const parsedFrom = fromRaw ? new Date(fromRaw) : null;
  const parsedTo = toRaw ? new Date(toRaw) : null;

  let from = parsedFrom && !Number.isNaN(parsedFrom.getTime()) ? startOfUtcDay(parsedFrom) : defaultFrom;
  let toExclusive =
    parsedTo && !Number.isNaN(parsedTo.getTime())
      ? new Date(startOfUtcDay(parsedTo).getTime() + DAY_MS)
      : defaultToExclusive;

  if (toExclusive <= from) {
    // A "to" before "from" is a nonsensical range, not a range with zero days — reset to the
    // default rather than silently returning an empty result the user didn't ask for.
    from = defaultFrom;
    toExclusive = defaultToExclusive;
  }

  const maxSpanMs = MAX_RANGE_DAYS * DAY_MS;
  if (toExclusive.getTime() - from.getTime() > maxSpanMs) {
    from = new Date(toExclusive.getTime() - maxSpanMs);
  }

  return {
    from,
    toExclusive,
    fromInput: from.toISOString().slice(0, 10),
    toInput: new Date(toExclusive.getTime() - DAY_MS).toISOString().slice(0, 10),
  };
}
