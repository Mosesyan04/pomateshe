import type { CalendarItem } from "../../app/_components/calendar/types";
import type { DayColumn } from "../../app/_components/calendar/time-grid";
import type { MonthDayCell } from "../../app/_components/calendar/month-grid";
import { daysInRange, monthGridDays, toDateInput } from "./view-range";

/** Shared by /teacher/calendar and /student/calendar so both pages compose the same grid
 *  shapes from their (differently-sourced) items the same way. */

function dayIsoOf(item: CalendarItem): string {
  return item.scheduledAtIso.slice(0, 10);
}

export function buildDayColumns(from: Date, toExclusive: Date, items: CalendarItem[]): DayColumn[] {
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const key = dayIsoOf(item);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(item);
  }

  return daysInRange(from, toExclusive).map((d) => {
    const dateIso = toDateInput(d);
    return {
      dateIso,
      label: d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" }),
      items: byDay.get(dateIso) ?? [],
    };
  });
}

export function buildMonthWeeks(
  monthStart: Date,
  monthEndExclusive: Date,
  items: CalendarItem[],
): MonthDayCell[][] {
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const key = dayIsoOf(item);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(item);
  }

  const gridDays = monthGridDays(monthStart, monthEndExclusive);
  const cells: MonthDayCell[] = gridDays.map((d) => {
    const dateIso = toDateInput(d);
    return {
      dateIso,
      dayOfMonth: d.getUTCDate(),
      inCurrentMonth: d >= monthStart && d < monthEndExclusive,
      items: byDay.get(dateIso) ?? [],
    };
  });

  const weeks: MonthDayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}
