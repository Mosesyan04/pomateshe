import Link from "next/link";
import { requireRole } from "../../../lib/auth/current-user";
import { getStudentsForTeacher } from "../../../server/teachers";
import { getLessonsForTeacher } from "../../../server/lessons";
import { getHomeworkForTeacher } from "../../../server/homework";
import { createHomeworkAction } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Заполните ученика и заголовок задания.",
  invalid_date: "Некорректный срок сдачи.",
  create_failed: "Не удалось создать задание — проверьте файл (jpeg/png/webp, до 10 МБ) и ученика.",
};

function formatDateTime(d: Date): string {
  return new Date(d).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
}

export default async function HomeworkPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string; studentLinkId?: string }>;
}) {
  const user = await requireRole("teacher");
  const { error, studentLinkId: filterStudentLinkId } = await searchParams;

  const [students, lessons, homework] = await Promise.all([
    getStudentsForTeacher(user.teacherId!),
    getLessonsForTeacher(user.teacherId!),
    getHomeworkForTeacher(user.teacherId!, filterStudentLinkId || undefined),
  ]);

  return (
    <div>
      <h1>Домашние задания</h1>

      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {ERROR_MESSAGES[error] ?? "Не удалось выполнить действие."}
        </p>
      )}

      <section>
        <h2>Новое задание</h2>
        {students.length === 0 ? (
          <p style={{ color: "#666" }}>
            Сначала <Link href="/teacher/students">пригласите ученика</Link>.
          </p>
        ) : (
          <form
            action={createHomeworkAction}
            encType="multipart/form-data"
            style={{ display: "grid", gap: "0.5rem", maxWidth: 480 }}
          >
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
              Заголовок
              <input name="title" type="text" maxLength={200} required />
            </label>
            <label>
              Описание (необязательно)
              <textarea name="description" maxLength={2000} />
            </label>
            <label>
              Срок сдачи (необязательно)
              <input name="dueAt" type="datetime-local" />
            </label>
            {lessons.length > 0 && (
              <label>
                Связанное занятие (необязательно)
                <select name="lessonId" defaultValue="">
                  <option value="">— не связано —</option>
                  {lessons.map((l) => (
                    <option key={l.id} value={l.id}>
                      {formatDateTime(l.scheduledAt)} —{" "}
                      {l.studentLink?.displayName ?? l.studentLink?.studentUser.email ?? "—"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Фото (необязательно, JPEG/PNG/WebP, до 10 МБ)
              <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" />
            </label>
            <button type="submit">Создать задание</button>
          </form>
        )}
      </section>

      <section>
        <h2>Выданные задания ({homework.length})</h2>
        {students.length > 0 && (
          <form method="get" style={{ marginBottom: "1rem" }}>
            <label>
              Фильтр по ученику{" "}
              <select name="studentLinkId" defaultValue={filterStudentLinkId ?? ""}>
                <option value="">— все ученики —</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName ?? s.studentUser.email}
                  </option>
                ))}
              </select>
            </label>{" "}
            <button type="submit">Показать</button>
          </form>
        )}

        {homework.length === 0 ? (
          <p style={{ color: "#666" }}>Заданий пока нет.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {homework.map((hw) => (
              <li key={hw.id} style={{ borderTop: "1px solid #ddd", padding: "0.75rem 0" }}>
                <strong>{hw.title}</strong> —{" "}
                {hw.studentLink?.displayName ?? hw.studentLink?.studentUser.email ?? "—"}
                {hw.dueAt && <> · срок: {formatDateTime(hw.dueAt)}</>}
                {hw.description && <p>{hw.description}</p>}
                {hw.materialFiles.map((f) => (
                  <div key={f.id}>
                    <img
                      src={`/api/files/${user.teacherId}/${f.id}`}
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
    </div>
  );
}
