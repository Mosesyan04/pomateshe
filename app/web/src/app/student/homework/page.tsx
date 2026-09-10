import { requireRole } from "../../../lib/auth/current-user";
import { getMyHomeworkAsStudent } from "../../../server/homework";

function formatDateTime(d: Date): string {
  return new Date(d).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
}

export default async function StudentHomeworkPage() {
  const user = await requireRole("student");
  const groups = await getMyHomeworkAsStudent(user.userId);

  if (groups.length === 0) {
    return <p style={{ color: "#666" }}>У вас пока нет преподавателей.</p>;
  }

  return (
    <div>
      <h1>Домашние задания</h1>
      {groups.map((group) => (
        <section key={group.teacherId}>
          <h2>{group.teacherDisplayName}</h2>
          {group.homework.length === 0 ? (
            <p style={{ color: "#666" }}>Заданий пока нет.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {group.homework.map((hw) => (
                <li key={hw.id} style={{ borderTop: "1px solid #ddd", padding: "0.75rem 0" }}>
                  <strong>{hw.title}</strong>
                  {hw.dueAt && <> · срок: {formatDateTime(hw.dueAt)}</>}
                  {hw.description && <p>{hw.description}</p>}
                  {hw.materialFiles.map((f) => (
                    <div key={f.id}>
                      <img
                        src={`/api/files/${group.teacherId}/${f.id}`}
                        alt={f.originalFileName}
                        style={{ maxWidth: 320, display: "block", marginTop: "0.5rem" }}
                      />
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
