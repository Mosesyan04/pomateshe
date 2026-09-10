import { requireRole } from "../../../lib/auth/current-user";
import { listInvitesForTeacher } from "../../../server/invites";
import { getStudentsForTeacher } from "../../../server/teachers";
import { createInviteAction, revokeInviteAction } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_email: "Введите корректный email.",
};

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string; token?: string; revoked?: string }>;
}) {
  const user = await requireRole("teacher");
  const { error, created, token } = await searchParams;

  const [students, invites] = await Promise.all([
    getStudentsForTeacher(user.teacherId!),
    listInvitesForTeacher(user.teacherId!),
  ]);

  const inviteUrl = token ? `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invite/${token}` : null;

  return (
    <div>
      <h1>Ученики</h1>

      {created && inviteUrl && (
        <div role="alert" style={{ background: "#eef", padding: "1rem", marginBottom: "1rem" }}>
          <p>
            Приглашение создано. Отправьте эту ссылку ученику — <strong>она показывается только
            один раз</strong>, после перезагрузки страницы её нельзя будет посмотреть снова:
          </p>
          <code>{inviteUrl}</code>
        </div>
      )}

      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {ERROR_MESSAGES[error] ?? "Не удалось создать приглашение."}
        </p>
      )}

      <section>
        <h2>Пригласить ученика</h2>
        <form action={createInviteAction} style={{ display: "flex", gap: "0.5rem" }}>
          <input name="email" type="email" placeholder="email ученика" required />
          <button type="submit">Отправить приглашение</button>
        </form>
      </section>

      <section>
        <h2>Активные ученики ({students.length})</h2>
        {students.length === 0 ? (
          <p style={{ color: "#666" }}>Пока нет учеников.</p>
        ) : (
          <ul>
            {students.map((s) => (
              <li key={s.id}>{s.displayName ?? s.studentUser.email}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Приглашения</h2>
        {invites.length === 0 ? (
          <p style={{ color: "#666" }}>Приглашений пока нет.</p>
        ) : (
          <ul>
            {invites.map((inv) => (
              <li key={inv.id}>
                {inv.email} — {inv.status}
                {inv.status === "pending" && (
                  <form action={revokeInviteAction} style={{ display: "inline", marginLeft: "0.5rem" }}>
                    <input type="hidden" name="inviteId" value={inv.id} />
                    <button type="submit">Отменить</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
