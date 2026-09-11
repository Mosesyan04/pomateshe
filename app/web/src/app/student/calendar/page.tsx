import { requireRole } from "../../../lib/auth/current-user";
import { getMyLessonsAsStudent } from "../../../server/lessons";
import { getPersonalEventsForUser } from "../../../server/personal-events";
import { parseViewRange } from "../../../lib/calendar/view-range";
import { buildDayColumns, buildMonthWeeks } from "../../../lib/calendar/build-grid-data";
import { CalendarNav } from "../../_components/calendar/calendar-nav";
import { TimeGrid } from "../../_components/calendar/time-grid";
import { MonthGrid } from "../../_components/calendar/month-grid";
import { CreatePersonalEventForm } from "../../_components/calendar/create-personal-event-form";
import type { CalendarItem } from "../../_components/calendar/types";
import {
  reschedulePersonalEventFromCalendarAction,
  rescheduleLessonForbiddenAction,
  createPersonalEventAction,
  deletePersonalEventAction,
} from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Заполните название, время и длительность.",
  invalid_date: "Некорректная дата/время.",
};

export default async function StudentCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; error?: string }>;
}) {
  const user = await requireRole("student");
  const { view: viewRaw, date: dateRaw, error } = await searchParams;
  const range = parseViewRange(viewRaw, dateRaw);

  const [teacherGroups, personalEvents] = await Promise.all([
    getMyLessonsAsStudent(user.userId, range),
    getPersonalEventsForUser(user.userId, range),
  ]);

  const items: CalendarItem[] = [
    ...teacherGroups.flatMap((group) =>
      group.lessons.map((l) => ({
        id: l.id,
        kind: "lesson" as const,
        // Only the teacher who scheduled it can move it — read-only here regardless of what
        // the student taps, and the Server Action rejects it too either way.
        title: `${l.groupName ? `Группа: ${l.groupName}` : "Занятие"} — ${group.teacherDisplayName}`,
        scheduledAtIso: l.scheduledAt.toISOString(),
        durationMinutes: l.durationMinutes,
        editable: false,
      })),
    ),
    ...personalEvents.map((e) => ({
      id: e.id,
      kind: "personal" as const,
      title: e.title,
      scheduledAtIso: e.scheduledAt.toISOString(),
      durationMinutes: e.durationMinutes,
      editable: true,
    })),
  ];

  return (
    <div>
      <h1>Календарь</h1>

      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {ERROR_MESSAGES[error] ?? "Не удалось выполнить действие."}
        </p>
      )}

      <CreatePersonalEventForm
        action={createPersonalEventAction}
        deleteAction={deletePersonalEventAction}
        events={personalEvents}
      />

      <CalendarNav basePath="/student/calendar" range={range} />

      {range.view === "month" ? (
        <MonthGrid
          weeks={buildMonthWeeks(range.from, range.toExclusive, items)}
          onRescheduleLesson={rescheduleLessonForbiddenAction}
          onReschedulePersonalEvent={reschedulePersonalEventFromCalendarAction}
        />
      ) : (
        <TimeGrid
          days={buildDayColumns(range.from, range.toExclusive, items)}
          onRescheduleLesson={rescheduleLessonForbiddenAction}
          onReschedulePersonalEvent={reschedulePersonalEventFromCalendarAction}
        />
      )}
    </div>
  );
}
