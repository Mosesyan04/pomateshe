import Link from "next/link";
import type { ViewRange } from "../../../lib/calendar/view-range";
import { shiftAnchor, toDateInput } from "../../../lib/calendar/view-range";

/**
 * Plain links with query params — no client JS needed for navigation itself, only the drag
 * inside the grid needs a client component. Each link fully re-renders the page server-side,
 * which is fine at this scale (a personal/small-business calendar, not a high-frequency app).
 */
export function CalendarNav({ basePath, range }: { basePath: string; range: ViewRange }) {
  const prev = toDateInput(shiftAnchor(range, -1));
  const next = toDateInput(shiftAnchor(range, 1));
  const today = toDateInput(new Date());

  function viewLink(view: "day" | "week" | "month") {
    return `${basePath}?view=${view}&date=${toDateInput(range.anchor)}`;
  }

  return (
    <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
      <div style={{ display: "flex", gap: "0.25rem" }}>
        <Link href={`${basePath}?view=${range.view}&date=${prev}`}>&larr;</Link>
        <Link href={`${basePath}?view=${range.view}&date=${today}`}>Сегодня</Link>
        <Link href={`${basePath}?view=${range.view}&date=${next}`}>&rarr;</Link>
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        {(["day", "week", "month"] as const).map((v) => (
          <Link
            key={v}
            href={viewLink(v)}
            style={{
              fontWeight: range.view === v ? 700 : 400,
              textDecoration: range.view === v ? "underline" : "none",
            }}
          >
            {v === "day" ? "День" : v === "week" ? "Неделя" : "Месяц"}
          </Link>
        ))}
      </div>
    </div>
  );
}
