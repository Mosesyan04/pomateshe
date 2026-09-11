"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CalendarItem } from "./types";

const DISPLAY_START_HOUR = 7;
const DISPLAY_END_HOUR = 23;
const HOUR_HEIGHT_PX = 48;
const SNAP_MINUTES = 15;
const GRID_HEIGHT_PX = (DISPLAY_END_HOUR - DISPLAY_START_HOUR) * HOUR_HEIGHT_PX;
const BLOCK_WIDTH_PX = 140; // fixed px while dragging — see the DragState comment below

function minutesSinceMidnight(iso: string): number {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

interface DragState {
  itemId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  originDayIndex: number;
  originStartMinutes: number;
  currentDayIndex: number;
  currentStartMinutes: number;
  /** Raw viewport coordinates, updated every pointermove — used ONLY to visually follow the
   *  pointer via `position: fixed` (see the render below). Keeping the dragged block's DOM
   *  node mounted in ONE place for the whole drag (its origin column) and just repositioning
   *  it with `fixed` is what pointer capture requires: the first version of this component
   *  conditionally re-rendered the item into whichever day column `currentDayIndex` pointed
   *  at, which unmounted the very element `setPointerCapture` was called on the instant the
   *  drag crossed into a different day — silently killing all further pointermove/up events
   *  for that gesture. A real browser run (not a type-check, not a unit test) is what caught
   *  this: dragging straight down worked, dragging sideways into another day silently did
   *  nothing past the first column boundary. */
  lastClientX: number;
  lastClientY: number;
}

export interface DayColumn {
  /** YYYY-MM-DD, UTC — the day this column represents. */
  dateIso: string;
  label: string;
  items: CalendarItem[];
}

/**
 * Week/day view — a time-axis grid, one column per visible day. Drag-and-drop is hand-rolled
 * on the Pointer Events API (not native HTML5 drag-and-drop, which has no touch support at
 * all) — this is the only reason this component needs to be a client island; the rest of the
 * app has none of this beyond the cookie banner.
 *
 * Known limitation: there is no keyboard-operable alternative to dragging yet (arrow-key
 * reschedule, say) — the ask was specifically pointer/touch drag, and this doesn't invent
 * that fallback on its own. Recorded here rather than silently left out.
 */
export function TimeGrid({
  days,
  onRescheduleLesson,
  onReschedulePersonalEvent,
}: {
  days: DayColumn[];
  onRescheduleLesson: (lessonId: string, newScheduledAtIso: string) => Promise<{ ok: boolean; error?: string }>;
  onReschedulePersonalEvent: (
    eventId: string,
    newScheduledAtIso: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  // Measures ONE day column's actual rendered width for the horizontal drag math below.
  // Deliberately not a ref on a `display: contents` wrapper around the day columns — an
  // element with `display: contents` generates no box of its own, so its clientWidth is
  // always 0 (found the same way as the bug documented on DragState above: a real browser
  // run, not a type-check).
  const firstColumnRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const hours = Array.from({ length: DISPLAY_END_HOUR - DISPLAY_START_HOUR }, (_, i) => DISPLAY_START_HOUR + i);

  function findItem(itemId: string): { item: CalendarItem; dayIndex: number } | null {
    for (let i = 0; i < days.length; i++) {
      const item = days[i].items.find((it) => it.id === itemId);
      if (item) return { item, dayIndex: i };
    }
    return null;
  }

  function handlePointerDown(e: React.PointerEvent, item: CalendarItem, dayIndex: number) {
    if (!item.editable) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const originStartMinutes = minutesSinceMidnight(item.scheduledAtIso);
    setDrag({
      itemId: item.id,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originDayIndex: dayIndex,
      originStartMinutes,
      currentDayIndex: dayIndex,
      currentStartMinutes: originStartMinutes,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
    });
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!drag || drag.pointerId !== e.pointerId || !firstColumnRef.current) return;
    const columnWidth = firstColumnRef.current.getBoundingClientRect().width;
    const deltaX = e.clientX - drag.startClientX;
    const deltaY = e.clientY - drag.startClientY;

    const dayDelta = Math.round(deltaX / columnWidth);
    const rawMinutesDelta = (deltaY / HOUR_HEIGHT_PX) * 60;
    const minutesDelta = Math.round(rawMinutesDelta / SNAP_MINUTES) * SNAP_MINUTES;

    setDrag({
      ...drag,
      currentDayIndex: clamp(drag.originDayIndex + dayDelta, 0, days.length - 1),
      currentStartMinutes: clamp(drag.originStartMinutes + minutesDelta, 0, 24 * 60 - SNAP_MINUTES),
      lastClientX: e.clientX,
      lastClientY: e.clientY,
    });
  }

  async function handlePointerUp(e: React.PointerEvent) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

    const found = findItem(drag.itemId);
    setDrag(null);
    if (!found) return;

    const moved = drag.currentDayIndex !== drag.originDayIndex || drag.currentStartMinutes !== drag.originStartMinutes;
    if (!moved) return;

    const targetDay = days[drag.currentDayIndex].dateIso;
    const hh = String(Math.floor(drag.currentStartMinutes / 60)).padStart(2, "0");
    const mm = String(drag.currentStartMinutes % 60).padStart(2, "0");
    const newScheduledAtIso = `${targetDay}T${hh}:${mm}:00.000Z`;

    const action = found.item.kind === "lesson" ? onRescheduleLesson : onReschedulePersonalEvent;
    try {
      const result = await action(found.item.id, newScheduledAtIso);
      if (!result.ok) {
        alert(result.error ?? "Не удалось перенести.");
      }
    } catch {
      alert("Не удалось перенести.");
    }
    router.refresh();
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: `48px repeat(${days.length}, minmax(120px, 1fr))` }}>
        <div />
        {days.map((day) => (
          <div key={day.dateIso} style={{ textAlign: "center", fontWeight: 600, padding: "0.25rem" }}>
            {day.label}
          </div>
        ))}

        <div style={{ position: "relative", height: GRID_HEIGHT_PX }}>
          {hours.map((h) => (
            <div
              key={h}
              style={{
                position: "absolute",
                top: (h - DISPLAY_START_HOUR) * HOUR_HEIGHT_PX,
                right: 4,
                fontSize: "0.75rem",
                color: "#666",
              }}
            >
              {h}:00
            </div>
          ))}
        </div>

        <div style={{ display: "contents" }}>
          {days.map((day, dayIndex) => (
            <div
              key={day.dateIso}
              ref={dayIndex === 0 ? firstColumnRef : undefined}
              data-day-index={dayIndex}
              style={{
                position: "relative",
                height: GRID_HEIGHT_PX,
                borderLeft: "1px solid #eee",
                background: "repeating-linear-gradient(to bottom, transparent, transparent 47px, #f0f0f0 48px)",
              }}
            >
              {/* Always rendered here, in the item's ORIGIN column, for the entire drag —
                  see the DragState.lastClientX comment for why this must never move to a
                  different column's child list mid-drag. */}
              {day.items.map((item) => {
                const isDragging = drag?.itemId === item.id;
                const storedStartMinutes = minutesSinceMidnight(item.scheduledAtIso);
                const top = ((storedStartMinutes - DISPLAY_START_HOUR * 60) / 60) * HOUR_HEIGHT_PX;
                const height = Math.max(18, (item.durationMinutes / 60) * HOUR_HEIGHT_PX);

                const style: React.CSSProperties = isDragging
                  ? {
                      position: "fixed",
                      left: drag.lastClientX - BLOCK_WIDTH_PX / 2,
                      top: drag.lastClientY - height / 2,
                      width: BLOCK_WIDTH_PX,
                      height,
                      zIndex: 1000,
                    }
                  : { position: "absolute", top, height, left: 2, right: 2 };

                return (
                  <div
                    key={item.id}
                    onPointerDown={(e) => handlePointerDown(e, item, dayIndex)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    style={{
                      ...style,
                      overflow: "hidden",
                      borderRadius: 4,
                      padding: "2px 4px",
                      fontSize: "0.75rem",
                      color: "#fff",
                      background: item.kind === "lesson" ? "#4f46e5" : "#0a7d2c",
                      opacity: isDragging ? 0.85 : 1,
                      cursor: item.editable ? "grab" : "default",
                      touchAction: item.editable ? "none" : undefined,
                      pointerEvents: isDragging ? "none" : "auto",
                    }}
                  >
                    {item.title}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
