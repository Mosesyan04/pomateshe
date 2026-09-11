import Link from "next/link";
import { requireRole } from "../../../lib/auth/current-user";
import { listInvitesForTeacher } from "../../../server/invites";
import { getStudentsForTeacher } from "../../../server/teachers";
import { createInviteAction, revokeInviteAction } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_email: "Введите корректный email.",
  email_not_verified: "Подтвердите email, чтобы приглашать учеников.",
};

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("ru-RU", { minimumFractionDigits: 0 }) + " ₽";
}

interface StudentsSearchParams {
  error?: string;
  created?: string;
  token?: string;
  revoked?: string;
  search?: string;
  subject?: string;
  gradeLevel?: string;
  priceMin?: string;
  priceMax?: string;
  durationMin?: string;
  durationMax?: string;
}

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<StudentsSearchParams>;
}) {
  const user = await requireRole("teacher");
  const sp = await searchParams;
  const { error, created, token } = sp;

  const [students, allStudents, invites] = await Promise.all([
    getStudentsForTeacher(user.teacherId!, {
      search: sp.search || undefined,
      subject: sp.subject || undefined,
      gradeLevel: sp.gradeLevel || undefined,
      priceMinCents: sp.priceMin ? Math.round(Number(sp.priceMin) * 100) : undefined,
      priceMaxCents: sp.priceMax ? Math.round(Number(sp.priceMax) * 100) : undefined,
      durationMinMinutes: sp.durationMin ? Number(sp.durationMin) : undefined,
      durationMaxMinutes: sp.durationMax ? Number(sp.durationMax) : undefined,
    }),
    // Unfiltered, just for the subject/grade dropdown option lists below.
    getStudentsForTeacher(user.teacherId!),
    listInvitesForTeacher(user.teacherId!),
  ]);

  const subjectOptions = [...new Set(allStudents.map((s) => s.subject).filter(Boolean))] as string[];
  const gradeOptions = [...new Set(allStudents.map((s) => s.gradeLevel).filter(Boolean))] as string[];
  const hasActiveFilters = Boolean(
    sp.search || sp.subject || sp.gradeLevel || sp.priceMin || sp.priceMax || sp.durationMin || sp.durationMax,
  );

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

        {allStudents.length > 0 && (
          <form
            method="get"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "0.5rem",
              marginBottom: "1rem",
              alignItems: "end",
            }}
          >
            <label>
              Поиск (ФИО, телефон, Telegram)
              <input name="search" type="text" defaultValue={sp.search ?? ""} />
            </label>
            <label>
              Предмет
              <select name="subject" defaultValue={sp.subject ?? ""}>
                <option value="">— любой —</option>
                {subjectOptions.map((subj) => (
                  <option key={subj} value={subj}>
                    {subj}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Класс
              <select name="gradeLevel" defaultValue={sp.gradeLevel ?? ""}>
                <option value="">— любой —</option>
                {gradeOptions.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Цена от, ₽
              <input name="priceMin" type="number" min={0} step={50} defaultValue={sp.priceMin ?? ""} />
            </label>
            <label>
              Цена до, ₽
              <input name="priceMax" type="number" min={0} step={50} defaultValue={sp.priceMax ?? ""} />
            </label>
            <label>
              Длительность от, мин
              <input name="durationMin" type="number" min={0} step={5} defaultValue={sp.durationMin ?? ""} />
            </label>
            <label>
              Длительность до, мин
              <input name="durationMax" type="number" min={0} step={5} defaultValue={sp.durationMax ?? ""} />
            </label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="submit">Применить</button>
              {hasActiveFilters && <Link href="/teacher/students">Сбросить</Link>}
            </div>
          </form>
        )}

        {students.length === 0 ? (
          <p style={{ color: "#666" }}>
            {hasActiveFilters ? "Ничего не найдено по этим фильтрам." : "Пока нет учеников."}
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {students.map((s) => (
              <li
                key={s.id}
                style={{
                  borderTop: "1px solid #ddd",
                  padding: "0.75rem 0",
                  display: "flex",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                }}
              >
                <div>
                  <Link href={`/teacher/students/${s.id}`} style={{ fontWeight: 600 }}>
                    {s.displayName ?? s.studentUser.email}
                  </Link>
                  <div style={{ color: "#666", fontSize: "0.9rem" }}>
                    {[s.subject, s.gradeLevel].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                <div style={{ textAlign: "right", fontSize: "0.9rem", color: "#666" }}>
                  {s.defaultPriceCents != null && <div>{formatMoney(s.defaultPriceCents)}</div>}
                  {s.defaultDurationMinutes != null && <div>{s.defaultDurationMinutes} мин</div>}
                  {(s.contactPhone || s.contactTelegram) && (
                    <div>{[s.contactPhone, s.contactTelegram].filter(Boolean).join(" · ")}</div>
                  )}
                </div>
              </li>
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
