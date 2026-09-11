import { requireRole } from "../../../lib/auth/current-user";
import { getGroupsForTeacher } from "../../../server/groups";
import { getStudentsForTeacher } from "../../../server/teachers";
import {
  createGroupAction,
  addStudentToGroupAction,
  removeStudentFromGroupAction,
  archiveGroupAction,
} from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_name: "Введите название группы.",
  missing_fields: "Выберите ученика.",
  add_failed: "Не удалось добавить ученика в группу.",
  remove_failed: "Не удалось убрать ученика из группы.",
  archive_failed: "Не удалось архивировать группу.",
  email_not_verified: "Подтвердите email, чтобы управлять группами.",
};

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireRole("teacher");
  const { error } = await searchParams;

  const [groups, students] = await Promise.all([
    getGroupsForTeacher(user.teacherId!),
    getStudentsForTeacher(user.teacherId!),
  ]);

  return (
    <div>
      <h1>Группы</h1>
      <p style={{ color: "#666" }}>
        Группы объединяют учеников — групповые занятия (создание/расписание) пока не
        реализованы, это только управление составом групп.
      </p>

      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {ERROR_MESSAGES[error] ?? "Не удалось выполнить действие."}
        </p>
      )}

      <section>
        <h2>Новая группа</h2>
        <form action={createGroupAction} style={{ display: "flex", gap: "0.5rem" }}>
          <input name="name" type="text" placeholder="название группы" required maxLength={100} />
          <button type="submit">Создать</button>
        </form>
      </section>

      <section>
        <h2>Группы ({groups.length})</h2>
        {groups.length === 0 ? (
          <p style={{ color: "#666" }}>Групп пока нет.</p>
        ) : (
          groups.map((group) => {
            const memberIds = new Set(group.members.map((m) => m.studentLinkId));
            const availableStudents = students.filter((s) => !memberIds.has(s.id));

            return (
              <div key={group.id} style={{ border: "1px solid #ddd", borderRadius: 4, padding: "1rem", marginBottom: "1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                  <h3 style={{ margin: 0 }}>{group.name}</h3>
                  <form action={archiveGroupAction}>
                    <input type="hidden" name="groupId" value={group.id} />
                    <button type="submit">Архивировать</button>
                  </form>
                </div>

                {group.members.length === 0 ? (
                  <p style={{ color: "#666" }}>В группе пока нет учеников.</p>
                ) : (
                  <ul>
                    {group.members.map((member) => (
                      <li key={member.id}>
                        {member.studentLink.displayName ?? member.studentLink.studentUser.email}
                        <form
                          action={removeStudentFromGroupAction}
                          style={{ display: "inline", marginLeft: "0.5rem" }}
                        >
                          <input type="hidden" name="groupId" value={group.id} />
                          <input type="hidden" name="studentLinkId" value={member.studentLinkId} />
                          <button type="submit">Убрать</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}

                {availableStudents.length > 0 && (
                  <form action={addStudentToGroupAction} style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                    <input type="hidden" name="groupId" value={group.id} />
                    <select name="studentLinkId" required>
                      {availableStudents.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.displayName ?? s.studentUser.email}
                        </option>
                      ))}
                    </select>
                    <button type="submit">Добавить в группу</button>
                  </form>
                )}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
