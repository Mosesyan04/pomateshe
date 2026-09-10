import { registerTeacherAction } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Заполните все обязательные поля.",
  weak_password: "Пароль должен быть не короче 10 символов.",
  email_taken: "Аккаунт с этим email уже существует.",
  rate_limited: "Слишком много попыток регистрации с вашего адреса. Попробуйте позже.",
  missing_consent: "Нужно согласиться с условиями и политикой, чтобы зарегистрироваться.",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; retryAfter?: string }>;
}) {
  const { error, retryAfter } = await searchParams;

  return (
    <main style={{ maxWidth: 420, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Регистрация преподавателя</h1>
      <p style={{ color: "#666" }}>
        Ученики регистрируются только по приглашению преподавателя — см. личный кабинет после входа.
      </p>

      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {ERROR_MESSAGES[error] ?? "Не удалось зарегистрироваться."}
          {error === "rate_limited" && retryAfter && ` (~${Math.ceil(Number(retryAfter) / 60)} мин.)`}
        </p>
      )}

      <form action={registerTeacherAction} style={{ display: "grid", gap: "0.75rem" }}>
        <label>
          Имя, отображаемое ученикам
          <input name="displayName" type="text" required maxLength={100} />
        </label>
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Пароль
          <input name="password" type="password" required minLength={10} autoComplete="new-password" />
        </label>
        <label>
          Часовой пояс
          <input name="timezone" type="text" defaultValue="Europe/Moscow" required />
        </label>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "start" }}>
          <input name="consent" type="checkbox" required style={{ marginTop: "0.2rem" }} />
          <span>
            Я принимаю <a href="/legal/offer" target="_blank">Пользовательское соглашение</a> и
            даю согласие на обработку персональных данных в соответствии с{" "}
            <a href="/legal/privacy" target="_blank">Политикой обработки персональных данных</a>.
          </span>
        </label>
        <button type="submit">Зарегистрироваться</button>
      </form>

      <p>
        Уже есть аккаунт? <a href="/login">Войти</a>
      </p>
    </main>
  );
}
