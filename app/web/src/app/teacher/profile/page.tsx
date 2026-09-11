import { requireRole } from "../../../lib/auth/current-user";
import { getTeacherProfileForEditing } from "../../../server/teacher-profile";
import { getCalendarIntegrationStatus } from "../../../server/calendar-integration";
import { updateTeacherProfileAction, disconnectGoogleCalendarAction } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Заполните имя и адрес страницы.",
  invalid_slug: "Адрес страницы может содержать только латинские буквы, цифры и дефис.",
  slug_taken: "Этот адрес страницы уже занят другим преподавателем.",
  bad_avatar: "Не удалось загрузить фото — проверьте формат (JPEG/PNG/WebP) и размер (до 5 МБ).",
  bad_zoom_link: "Ссылка не похожа на Zoom (ожидается https://...zoom.us/...).",
};

const CALENDAR_ERROR_MESSAGES: Record<string, string> = {
  denied: "Подключение отменено.",
  invalid_request: "Не удалось подключить календарь — некорректный ответ от Google.",
  invalid_state: "Сессия подключения истекла или недействительна. Попробуйте ещё раз.",
  no_refresh_token: "Google не предоставил постоянный доступ. Попробуйте подключить снова.",
  exchange_failed: "Не удалось завершить подключение к Google Calendar.",
  not_configured: "Подключение Google Calendar пока не настроено на сервере.",
};

export default async function TeacherProfilePage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    saved?: string;
    calendarError?: string;
    calendarConnected?: string;
    calendarDisconnected?: string;
  }>;
}) {
  const user = await requireRole("teacher");
  const { error, saved, calendarError, calendarConnected, calendarDisconnected } = await searchParams;
  const profile = await getTeacherProfileForEditing(user.teacherId!);
  const calendarStatus = await getCalendarIntegrationStatus(user.teacherId!);

  const publicUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/t/${profile.slug}`;

  return (
    <div>
      <h1>Публичная страница</h1>
      <p style={{ color: "#666" }}>
        Эта страница видна всем без входа в систему — <a href={`/t/${profile.slug}`} target="_blank">{publicUrl}</a>
      </p>

      {saved && <p role="status" style={{ color: "#0a7d2c" }}>Сохранено.</p>}
      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {ERROR_MESSAGES[error] ?? "Не удалось сохранить."}
        </p>
      )}

      <form
        action={updateTeacherProfileAction}
        encType="multipart/form-data"
        style={{ display: "grid", gap: "0.75rem", maxWidth: 480 }}
      >
        <label>
          Имя, отображаемое ученикам
          <input name="displayName" type="text" required maxLength={100} defaultValue={profile.displayName} />
        </label>
        <label>
          Адрес страницы (только латиница, цифры, дефис)
          <input name="slug" type="text" required maxLength={60} defaultValue={profile.slug} />
        </label>
        <label>
          О себе
          <textarea name="bio" maxLength={2000} rows={5} defaultValue={profile.bio ?? ""} />
        </label>
        <label>
          Предметы (через запятую)
          <input name="subjects" type="text" defaultValue={profile.subjects.join(", ")} />
        </label>
        <label>
          Стоимость занятия, ₽ (необязательно)
          <input
            name="priceRubles"
            type="number"
            min={0}
            step={50}
            defaultValue={profile.defaultLessonPriceCents != null ? profile.defaultLessonPriceCents / 100 : ""}
          />
        </label>
        <label>
          Как с вами связаться (телефон, Telegram, email — что покажется на странице)
          <input name="contactInfo" type="text" maxLength={200} defaultValue={profile.contactInfo ?? ""} />
        </label>
        <label>
          Фото (необязательно, JPEG/PNG/WebP, до 5 МБ)
          <input name="avatar" type="file" accept="image/jpeg,image/png,image/webp" />
        </label>
        <label>
          Постоянная ссылка на Zoom (необязательно) — добавляется к каждому новому занятию,
          видна и вам, и ученику
          <input
            name="zoomPersonalLink"
            type="url"
            placeholder="https://us02web.zoom.us/j/..."
            defaultValue={profile.zoomPersonalLink ?? ""}
          />
        </label>
        <button type="submit">Сохранить</button>
      </form>

      <section style={{ marginTop: "2rem", maxWidth: 480 }}>
        <h2>Google Calendar</h2>

        {calendarConnected && <p role="status" style={{ color: "#0a7d2c" }}>Календарь подключён.</p>}
        {calendarDisconnected && <p role="status" style={{ color: "#666" }}>Календарь отключён.</p>}
        {calendarError && (
          <p role="alert" style={{ color: "#b00020" }}>
            {CALENDAR_ERROR_MESSAGES[calendarError] ?? "Не удалось выполнить действие."}
          </p>
        )}

        {calendarStatus.disabled && (
          <p role="alert" style={{ color: "#b00020" }}>
            Доступ к Google Calendar был отозван (например, в настройках вашего Google-
            аккаунта). Занятия больше не синхронизируются — подключите календарь заново.
          </p>
        )}

        {calendarStatus.connected ? (
          <>
            <p style={{ color: "#666" }}>
              Подключено{calendarStatus.googleAccountEmail ? `: ${calendarStatus.googleAccountEmail}` : ""}.
              Новые и перенесённые занятия автоматически появляются в вашем календаре Google.
            </p>
            <form action={disconnectGoogleCalendarAction}>
              <button type="submit">Отключить</button>
            </form>
          </>
        ) : (
          <>
            <p style={{ color: "#666" }}>
              Подключите свой Google Calendar, чтобы запланированные занятия автоматически
              появлялись в нём и сдвигались вместе с расписанием в Pomateshe.
            </p>
            <a href="/api/google-calendar/connect">Подключить Google Calendar</a>
          </>
        )}
      </section>
    </div>
  );
}
