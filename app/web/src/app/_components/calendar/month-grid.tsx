"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CalendarItem } from "./types";

export interface MonthDayCell {
  /** YYYY-MM-DD, UTC. */
  dateIso: string;
  dayOfMonth: number;
  /** Days padded in from the adjacent month (rendered muted, still show their items but
   *  aren't draggable-into targets in a way that would confuse which month owns them —
   *  dragging still works, it's a purely visual distinction). */
  inCurrentMonth: boolean;
  items: CalendarItem[];
}

interface DragState {
  itemId: string;
  pointerId: number;
  originDayIso: string;
  currentDayIso: string;
  /** Raw viewport coordinates, updated every pointermove — used ONLY to visually follow the
   *  pointer via `position: fixed`. The dragged item's DOM node stays mounted in its ORIGIN
   *  day cell for the whole gesture; see the identical comment in time-grid.tsx for why —
   *  conditionally moving it into whichever cell `currentDayIso` points at unmounts the
   *  element `setPointerCapture` was called on the instant the drag crosses into another
   *  day cell, silently killing all further pointermove/up events for that gesture. */
  lastClientX: number;
  lastClientY: number;
}

/**
 * Month view — day-level drag only (no time-of-day axis at this zoom level): moving an item
 * to a different day cell keeps its original time-of-day, only the date changes. Same
 * Pointer-Events approach as time-grid.tsx, simpler geometry (1D day picking via
 * elementFromPoint instead of 2D pixel math).
 */
export function MonthGrid({
  weeks,
  onRescheduleLesson,
  onReschedulePersonalEvent,
}: {
  weeks: MonthDayCell[][];
  onRescheduleLesson: (lessonId: string, newScheduledAtIso: string) => Promise<{ ok: boolean; error?: string }>;
  onReschedulePersonalEvent: (
    eventId: string,
    newScheduledAtIso: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [drag, setDrag] = useState<DragState | null>(null);

  const allDays = weeks.flat();

  function findItem(itemId: string): CalendarItem | null {
    for (const day of allDays) {
      const item = day.items.find((it) => it.id === itemId);
      if (item) return item;
    }
    return null;
  }

  function handlePointerDown(e: React.PointerEvent, item: CalendarItem, dayIso: string) {
    if (!item.editable) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({
      itemId: item.id,
      pointerId: e.pointerId,
      originDayIso: dayIso,
      currentDayIso: dayIso,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
    });
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-day-iso]");
    const dayIso = under?.dataset.dayIso ?? drag.currentDayIso;
    setDrag({ ...drag, currentDayIso: dayIso, lastClientX: e.clientX, lastClientY: e.clientY });
  }

  async function handlePointerUp(e: React.PointerEvent) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

    const item = findItem(drag.itemId);
    const targetDayIso = drag.currentDayIso;
    const originDayIso = drag.originDayIso;
    setDrag(null);
    if (!item || targetDayIso === originDayIso) return;

    const time = new Date(item.scheduledAtIso);
    const hh = String(time.getUTCHours()).padStart(2, "0");
    const mm = String(time.getUTCMinutes()).padStart(2, "0");
    const newScheduledAtIso = `${targetDayIso}T${hh}:${mm}:00.000Z`;

    const action = item.kind === "lesson" ? onRescheduleLesson : onReschedulePersonalEvent;
    try {
      const result = await action(item.id, newScheduledAtIso);
      if (!result.ok) alert(result.error ?? "Не удалось перенести.");
    } catch {
      alert("Не удалось перенести.");
    }
    router.refresh();
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, overflowX: "auto" }}>
      {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((label) => (
        <div key={label} style={{ textAlign: "center", fontWeight: 600, fontSize: "0.85rem" }}>
          {label}
        </div>
      ))}
      {weeks.flat().map((day) => (
        <div
          key={day.dateIso}
          data-day-iso={day.dateIso}
          style={{
            minHeight: 90,
            border: "1px solid #eee",
            padding: "0.25rem",
            opacity: day.inCurrentMonth ? 1 : 0.4,
          }}
        >
          <div style={{ fontSize: "0.75rem", color: "#666" }}>{day.dayOfMonth}</div>
          {/* Always rendered here, in the item's ORIGIN cell, for the entire drag — see the
              DragState.lastClientX comment for why this must never move to a different cell's
              child list mid-drag. */}
          {day.items.map((item) => {
            const isDragging = drag?.itemId === item.id;
            const style: React.CSSProperties = isDragging
              ? {
                  position: "fixed",
                  left: drag.lastClientX - 60,
                  top: drag.lastClientY - 9,
                  width: 120,
                  zIndex: 1000,
                  pointerEvents: "none",
                }
              : {};
            return (
              <div
                key={item.id}
                onPointerDown={(e) => handlePointerDown(e, item, day.dateIso)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                style={{
                  ...style,
                  fontSize: "0.7rem",
                  color: "#fff",
                  background: item.kind === "lesson" ? "#4f46e5" : "#0a7d2c",
                  borderRadius: 3,
                  padding: "1px 4px",
                  marginTop: 2,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                  cursor: item.editable ? "grab" : "default",
                  touchAction: item.editable ? "none" : undefined,
                  opacity: isDragging ? 0.85 : 1,
                }}
              >
                {item.title}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
