export interface CalendarItem {
  id: string;
  kind: "lesson" | "personal";
  title: string;
  /** ISO string, not a Date — kept plain so this type is safe to pass from a Server
   *  Component straight into the "use client" grid without relying on RSC's Date
   *  serialization. */
  scheduledAtIso: string;
  durationMinutes: number;
  /** Whoever created it edits it (per the product decision this feature was built to) — a
   *  lesson is only ever editable by the teacher who scheduled it; a personal event only by
   *  its owner. The grid enforces this client-side for UX (no drag handle shown otherwise),
   *  the Server Action re-checks ownership regardless — never trust the client-side flag. */
  editable: boolean;
}
