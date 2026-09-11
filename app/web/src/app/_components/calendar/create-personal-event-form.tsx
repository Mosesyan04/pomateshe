/**
 * Creating a personal event is a plain form (matching every other creation flow in this app),
 * not part of the drag surface — the grid is for MOVING existing items, not for click-to-create.
 * Deleting one happens from this same list via its own tiny form, right below the create form.
 */
export function CreatePersonalEventForm({
  action,
  events,
  deleteAction,
}: {
  action: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
  events: Array<{ id: string; title: string; scheduledAt: Date; durationMinutes: number }>;
}) {
  function formatDateTime(d: Date): string {
    return new Date(d).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
  }

  return (
    <details style={{ marginBottom: "1rem" }}>
      <summary style={{ cursor: "pointer" }}>Личные события ({events.length})</summary>
      <form action={action} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "0.75rem 0" }}>
        <input name="title" type="text" placeholder="Название" required maxLength={200} />
        <input name="scheduledAt" type="datetime-local" required />
        <input name="durationMinutes" type="number" min={5} step={5} defaultValue={60} required />
        <button type="submit">Добавить</button>
      </form>
      {events.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {events.map((ev) => (
            <li key={ev.id} style={{ fontSize: "0.85rem", color: "#666" }}>
              {formatDateTime(ev.scheduledAt)} — {ev.title} ({ev.durationMinutes} мин)
              <form action={deleteAction} style={{ display: "inline", marginLeft: "0.5rem" }}>
                <input type="hidden" name="eventId" value={ev.id} />
                <button type="submit">Удалить</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
