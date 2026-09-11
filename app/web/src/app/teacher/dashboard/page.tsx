import Link from "next/link";
import { requireRole } from "../../../lib/auth/current-user";
import { getTeacherDashboardOverview } from "../../../server/dashboard";
import { markLessonPaidFromDashboardAction, resendVerificationEmailAction } from "./actions";
import { ZoomJoinLink } from "../../_components/zoom-join-link";

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("ru-RU", { minimumFractionDigits: 0 }) + " ₽";
}

function formatDateTime(d: Date): string {
  return new Date(d).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
}

const ERROR_MESSAGES: Record<string, string> = {
  update_failed: "Не удалось обновить занятие.",
  email_not_verified: "Подтвердите email, чтобы выполнить это действие.",
  rate_limited: "Слишком много запросов на повторную отправку. Попробуйте позже.",
};

export default async function TeacherDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; retryAfter?: string; resent?: string }>;
}) {
  const user = await requireRole("teacher");
  const { error, retryAfter, resent } = await searchParams;
  const overview = await getTeacherDashboardOverview(user.teacherId!);

  return (
    <div>
      <h1>Личный кабинет</h1>

      {!user.emailVerified && (
        <section style={{ background: "#fff3cd", border: "1px solid #ffe08a", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
          <p style={{ margin: 0 }}>
            Подтвердите email — до этого некоторые действия в кабинете недоступны (см. письмо,
            отправленное при регистрации).
          </p>
          {resent && (
            <p role="status" style={{ color: "#0a7d2c", margin: "0.5rem 0 0" }}>
              Письмо отправлено повторно.
            </p>
          )}
          <form action={resendVerificationEmailAction} style={{ marginTop: "0.5rem" }}>
            <button type="submit">Отправить письмо ещё раз</button>
          </form>
        </section>
      )}

      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {ERROR_MESSAGES[error] ?? "Не удалось выполнить действие."}
          {error === "rate_limited" && retryAfter && ` (~${Math.ceil(Number(retryAfter) / 60)} мин.)`}
        </p>
      )}

      <p>
        <Link href="/teacher/students">Ученики и приглашения</Link> ·{" "}
        <Link href="/teacher/groups">Группы</Link> ·{" "}
        <a href="/teacher/schedule">Расписание</a> ·{" "}
        <a href="/teacher/calendar">Календарь</a> ·{" "}
        <a href="/teacher/homework">Домашние задания</a> ·{" "}
        <a href="/teacher/income">Доходы</a> ·{" "}
        <a href="/teacher/profile">Публичная страница</a>
      </p>

      <section>
        <h2>Доходы за эту неделю</h2>
        <p style={{ fontSize: "1.5rem", fontWeight: 600 }}>{formatMoney(overview.weekIncomeCents)}</p>
        <p style={{ color: "#666", fontSize: "0.9rem" }}>Сумма занятий, отмеченных оплаченными на этой неделе.</p>
      </section>

      <section>
        <h2>Ближайшие занятия ({overview.upcomingLessons.length})</h2>
        {overview.upcomingLessons.length === 0 ? (
          <p style={{ color: "#666" }}>
            Запланированных занятий нет. <a href="/teacher/schedule">Создать занятие</a>
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th>Когда</th>
                <th>Ученик / группа</th>
                <th>Стоимость</th>
                <th>Zoom</th>
              </tr>
            </thead>
            <tbody>
              {overview.upcomingLessons.map((lesson) => (
                <tr key={lesson.id} style={{ borderTop: "1px solid #ddd" }}>
                  <td>{formatDateTime(lesson.scheduledAt)}</td>
                  <td>{lesson.studentLabel}</td>
                  <td>{formatMoney(lesson.priceCents)}</td>
                  <td>
                    <ZoomJoinLink url={lesson.zoomLinkSnapshot} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Неоплаченные занятия ({overview.unpaidLessons.length})</h2>
        {overview.unpaidLessons.length === 0 ? (
          <p style={{ color: "#666" }}>Должников нет.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th>Когда</th>
                <th>Ученик / группа</th>
                <th>Сумма</th>
                <th>Действие</th>
              </tr>
            </thead>
            <tbody>
              {overview.unpaidLessons.map((lesson) => (
                <tr key={lesson.id} style={{ borderTop: "1px solid #ddd" }}>
                  <td>{formatDateTime(lesson.scheduledAt)}</td>
                  <td>{lesson.studentLabel}</td>
                  <td>{formatMoney(lesson.priceCents)}</td>
                  <td>
                    <form action={markLessonPaidFromDashboardAction}>
                      <input type="hidden" name="lessonId" value={lesson.id} />
                      <button type="submit">Отметить оплаченным</button>
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
