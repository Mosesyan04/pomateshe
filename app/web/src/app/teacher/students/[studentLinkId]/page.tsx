import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "../../../../lib/auth/current-user";
import { getStudentLinkForTeacher } from "../../../../server/teachers";
import { updateStudentLinkAction } from "./actions";

export default async function StudentCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentLinkId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const user = await requireRole("teacher");
  const { studentLinkId } = await params;
  const { error, saved } = await searchParams;

  const link = await getStudentLinkForTeacher(user.teacherId!, studentLinkId);
  if (!link) notFound();

  return (
    <div>
      <p>
        <Link href="/teacher/students">&larr; К списку учеников</Link>
      </p>
      <h1>{link.displayName ?? link.studentUser.email}</h1>
      <p style={{ color: "#666" }}>{link.studentUser.email}</p>

      {saved && <p role="status" style={{ color: "#0a7d2c" }}>Сохранено.</p>}
      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {error === "email_not_verified" ? "Подтвердите email, чтобы изменить карточку ученика." : "Не удалось сохранить."}
        </p>
      )}

      <form
        action={updateStudentLinkAction}
        style={{ display: "grid", gap: "0.75rem", maxWidth: 420 }}
      >
        <input type="hidden" name="studentLinkId" value={link.id} />
        <label>
          ФИО
          <input name="displayName" type="text" maxLength={200} defaultValue={link.displayName ?? ""} />
        </label>
        <label>
          Предмет
          <input name="subject" type="text" maxLength={100} defaultValue={link.subject ?? ""} />
        </label>
        <label>
          Класс / уровень
          <input name="gradeLevel" type="text" maxLength={50} defaultValue={link.gradeLevel ?? ""} />
        </label>
        <label>
          Телефон
          <input name="contactPhone" type="tel" maxLength={30} defaultValue={link.contactPhone ?? ""} />
        </label>
        <label>
          Telegram
          <input name="contactTelegram" type="text" maxLength={100} defaultValue={link.contactTelegram ?? ""} />
        </label>
        <label>
          Обычная стоимость занятия, ₽
          <input
            name="priceRubles"
            type="number"
            min={0}
            step={50}
            defaultValue={link.defaultPriceCents != null ? link.defaultPriceCents / 100 : ""}
          />
        </label>
        <label>
          Обычная длительность, мин
          <input
            name="durationMinutes"
            type="number"
            min={5}
            step={5}
            defaultValue={link.defaultDurationMinutes ?? ""}
          />
        </label>
        <label>
          Заметки
          <textarea name="notes" maxLength={2000} rows={4} defaultValue={link.notes ?? ""} />
        </label>
        <button type="submit">Сохранить</button>
      </form>
    </div>
  );
}
