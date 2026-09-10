import { registerTeacherAction } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Заполните все обязательные поля.",
  weak_password: "Пароль должен быть не короче 10 символов.",
  email_taken: "Аккаунт с этим email уже существует.",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main style={{ maxWidth: 420, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Регистрация преподавателя</h1>
      <p style={{ color: "#666" }}>
        Ученики регистрируются только по приглашению преподавателя — см. личный кабинет после входа.
      </p>

      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {ERROR_MESSAGES[error] ?? "Не удалось зарегистрироваться."}
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
        <button type="submit">Зарегистрироваться</button>
      </form>

      <p>
        Уже есть аккаунт? <a href="/login">Войти</a>
      </p>
    </main>
  );
}
