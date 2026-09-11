import { requireRole } from "../../../lib/auth/current-user";
import { getLessonsForTeacherInRange } from "../../../server/lessons";
import { getPersonalEventsForUser } from "../../../server/personal-events";
import { labelForLesson } from "../../../server/lesson-label";
import { parseViewRange } from "../../../lib/calendar/view-range";
import { buildDayColumns, buildMonthWeeks } from "../../../lib/calendar/build-grid-data";
import { CalendarNav } from "../../_components/calendar/calendar-nav";
import { TimeGrid } from "../../_components/calendar/time-grid";
import { MonthGrid } from "../../_components/calendar/month-grid";
import { CreatePersonalEventForm } from "../../_components/calendar/create-personal-event-form";
import type { CalendarItem } from "../../_components/calendar/types";
import {
  rescheduleLessonFromCalendarAction,
  reschedulePersonalEventFromCalendarAction,
  createPersonalEventAction,
  deletePersonalEventAction,
} from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Заполните название, время и длительность.",
  invalid_date: "Некорректная дата/время.",
};

export default async function TeacherCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; error?: string }>;
}) {
  const user = await requireRole("teacher");
  const { view: viewRaw, date: dateRaw, error } = await searchParams;
  const range = parseViewRange(viewRaw, dateRaw);

  const [lessons, personalEvents] = await Promise.all([
    getLessonsForTeacherInRange(user.teacherId!, range),
    getPersonalEventsForUser(user.userId, range),
  ]);

  const items: CalendarItem[] = [
    ...lessons.map((l) => ({
      id: l.id,
      kind: "lesson" as const,
      title: labelForLesson(l),
      scheduledAtIso: l.scheduledAt.toISOString(),
      durationMinutes: l.durationMinutes,
      editable: true, // the teacher always owns their own lessons
    })),
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

      <CalendarNav basePath="/teacher/calendar" range={range} />

      {range.view === "month" ? (
        <MonthGrid
          weeks={buildMonthWeeks(range.from, range.toExclusive, items)}
          onRescheduleLesson={rescheduleLessonFromCalendarAction}
          onReschedulePersonalEvent={reschedulePersonalEventFromCalendarAction}
        />
      ) : (
        <TimeGrid
          days={buildDayColumns(range.from, range.toExclusive, items)}
          onRescheduleLesson={rescheduleLessonFromCalendarAction}
          onReschedulePersonalEvent={reschedulePersonalEventFromCalendarAction}
        />
      )}
    </div>
  );
}
