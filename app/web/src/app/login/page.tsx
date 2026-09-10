import { loginAction } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Введите email и пароль.",
  invalid_credentials: "Неверный email или пароль.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;

  return (
    <main style={{ maxWidth: 420, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Вход</h1>

      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {ERROR_MESSAGES[error] ?? "Не удалось войти."}
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
        Ещё нет аккаунта? <a href="/register">Зарегистрироваться как преподаватель</a>
      </p>
    </main>
  );
}
