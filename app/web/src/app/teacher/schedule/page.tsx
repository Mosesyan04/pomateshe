import Link from "next/link";
import { requireRole } from "../../../lib/auth/current-user";
import { getStudentsForTeacher } from "../../../server/teachers";
import { getGroupsForTeacher } from "../../../server/groups";
import { getLessonsForTeacher } from "../../../server/lessons";
import { ZoomJoinLink } from "../../_components/zoom-join-link";
import {
  createLessonAction,
  createGroupLessonAction,
  updateLessonStatusAction,
  toggleLessonPaidAction,
} from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Заполните все поля.",
  invalid_date: "Некорректная дата/время.",
  create_failed: "Не удалось создать занятие — проверьте, что ученик привязан к вам.",
  create_group_failed: "Не удалось создать занятие — проверьте, что группа не архивирована.",
  invalid_status: "Некорректный статус.",
  update_failed: "Не удалось обновить занятие.",
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "запланировано",
  completed: "проведено",
  cancelled: "отменено",
  no_show: "неявка",
};

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("ru-RU", { minimumFractionDigits: 0 }) + " ₽";
}

function formatDateTime(d: Date): string {
  return new Date(d).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string; updated?: string }>;
}) {
  const user = await requireRole("teacher");
  const { error } = await searchParams;

  const [students, groups, lessons] = await Promise.all([
    getStudentsForTeacher(user.teacherId!),
    getGroupsForTeacher(user.teacherId!),
    getLessonsForTeacher(user.teacherId!),
  ]);

  return (
    <div>
      <h1>Расписание</h1>

      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {ERROR_MESSAGES[error] ?? "Не удалось выполнить действие."}
        </p>
      )}

      <section>
        <h2>Новое занятие</h2>
        {students.length === 0 ? (
          <p style={{ color: "#666" }}>
            Сначала <Link href="/teacher/students">пригласите ученика</Link> — занятие можно создать
            только для ученика, принявшего приглашение.
          </p>
        ) : (
          <form action={createLessonAction} style={{ display: "grid", gap: "0.5rem", maxWidth: 420 }}>
            <label>
              Ученик
              <select name="studentLinkId" required>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName ?? s.studentUser.email}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Дата и время
              <input name="scheduledAt" type="datetime-local" required />
            </label>
            <label>
              Длительность (мин)
              <input name="durationMinutes" type="number" min={5} step={5} defaultValue={60} required />
            </label>
            <label>
              Стоимость (₽)
              <input name="priceRubles" type="number" min={0} step={50} required />
            </label>
            <label>
              Заметка (необязательно)
              <input name="notes" type="text" maxLength={500} />
            </label>
            <button type="submit">Создать занятие</button>
          </form>
        )}
      </section>

      <section>
        <h2>Новое групповое занятие</h2>
        {groups.length === 0 ? (
          <p style={{ color: "#666" }}>
            Сначала <Link href="/teacher/groups">создайте группу</Link> и добавьте в неё учеников.
          </p>
        ) : (
          <form action={createGroupLessonAction} style={{ display: "grid", gap: "0.5rem", maxWidth: 420 }}>
            <label>
              Группа
              <select name="groupId" required>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.members.length})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Дата и время
              <input name="scheduledAt" type="datetime-local" required />
            </label>
            <label>
              Длительность (мин)
              <input name="durationMinutes" type="number" min={5} step={5} defaultValue={60} required />
            </label>
            <label>
              Стоимость занятия, ₽ (за всю группу)
              <input name="priceRubles" type="number" min={0} step={50} required />
            </label>
            <label>
              Заметка (необязательно)
              <input name="notes" type="text" maxLength={500} />
            </label>
            <button type="submit">Создать групповое занятие</button>
          </form>
        )}
      </section>

      <section>
        <h2>Занятия ({lessons.length})</h2>
        {lessons.length === 0 ? (
          <p style={{ color: "#666" }}>Занятий пока нет.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th>Когда</th>
                <th>Ученик / группа</th>
                <th>Статус</th>
                <th>Оплата</th>
                <th>Zoom</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {lessons.map((lesson) => (
                <tr key={lesson.id} style={{ borderTop: "1px solid #ddd" }}>
                  <td>{formatDateTime(lesson.scheduledAt)}</td>
                  <td>
                    {lesson.group
                      ? `Группа: ${lesson.group.name}`
                      : lesson.studentLink?.displayName ?? lesson.studentLink?.studentUser.email ?? "—"}
                  </td>
                  <td>{STATUS_LABELS[lesson.status] ?? lesson.status}</td>
                  <td>
                    {formatMoney(lesson.priceCents)} — {lesson.paidAt ? "оплачено" : "не оплачено"}
                  </td>
                  <td>
                    <ZoomJoinLink url={lesson.zoomLinkSnapshot} />
                  </td>
                  <td style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                    {lesson.status === "scheduled" && (
                      <>
                        <form action={updateLessonStatusAction}>
                          <input type="hidden" name="lessonId" value={lesson.id} />
                          <input type="hidden" name="status" value="completed" />
                          <button type="submit">Провёл</button>
                        </form>
                        <form action={updateLessonStatusAction}>
                          <input type="hidden" name="lessonId" value={lesson.id} />
                          <input type="hidden" name="status" value="cancelled" />
                          <button type="submit">Отменить</button>
                        </form>
                        <form action={updateLessonStatusAction}>
                          <input type="hidden" name="lessonId" value={lesson.id} />
                          <input type="hidden" name="status" value="no_show" />
                          <button type="submit">Неявка</button>
                        </form>
                      </>
                    )}
                    <form action={toggleLessonPaidAction}>
                      <input type="hidden" name="lessonId" value={lesson.id} />
                      <input type="hidden" name="paid" value={lesson.paidAt ? "false" : "true"} />
                      <button type="submit">{lesson.paidAt ? "Отметить неоплаченным" : "Отметить оплаченным"}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
