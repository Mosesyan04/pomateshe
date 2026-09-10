import { requireRole } from "../../../lib/auth/current-user";
import { getMyLessonsAsStudent } from "../../../server/lessons";

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

export default async function StudentSchedulePage() {
  const user = await requireRole("student");
  const groups = await getMyLessonsAsStudent(user.userId);

  if (groups.length === 0) {
    return <p style={{ color: "#666" }}>У вас пока нет преподавателей.</p>;
  }

  return (
    <div>
      <h1>Моё расписание</h1>
      {groups.map((group) => (
        <section key={group.teacherId}>
          <h2>{group.teacherDisplayName}</h2>
          {group.lessons.length === 0 ? (
            <p style={{ color: "#666" }}>Занятий пока нет.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th>Когда</th>
                  <th>Статус</th>
                  <th>Оплата</th>
                </tr>
              </thead>
              <tbody>
                {group.lessons.map((lesson) => (
                  <tr key={lesson.id} style={{ borderTop: "1px solid #ddd" }}>
                    <td>{formatDateTime(lesson.scheduledAt)}</td>
                    <td>{STATUS_LABELS[lesson.status] ?? lesson.status}</td>
                    <td>
                      {formatMoney(lesson.priceCents)} — {lesson.paidAt ? "оплачено" : "не оплачено"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}
