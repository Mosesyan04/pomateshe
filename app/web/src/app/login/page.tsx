import { loginAction } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Введите email и пароль.",
  invalid_credentials: "Неверный email или пароль.",
  rate_limited: "Слишком много попыток входа. Попробуйте позже.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; retryAfter?: string; reset?: string }>;
}) {
  const { error, next, retryAfter, reset } = await searchParams;

  return (
    <main style={{ maxWidth: 420, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Вход</h1>

      {reset && (
        <p role="status" style={{ color: "#0a7d2c" }}>
          Пароль изменён. Войдите с новым паролем.
        </p>
      )}

      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {ERROR_MESSAGES[error] ?? "Не удалось войти."}
          {error === "rate_limited" && retryAfter && ` (~${Math.ceil(Number(retryAfter) / 60)} мин.)`}
        </p>
      )}

      <form action={loginAction} style={{ display: "grid", gap: "0.75rem" }}>
        {next && <input type="hidden" name="next" value={next} />}
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Пароль
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        <button type="submit">Войти</button>
      </form>

      <p>
        <a href="/forgot-password">Забыли пароль?</a>
      </p>
      <p>
        Ещё нет аккаунта? <a href="/register">Зарегистрироваться как преподаватель</a>
      </p>
    </main>
  );
}
