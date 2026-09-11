import { requestPasswordResetAction } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Введите email.",
  rate_limited: "Слишком много попыток. Попробуйте позже.",
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string; retryAfter?: string }>;
}) {
  const { error, sent, retryAfter } = await searchParams;

  return (
    <main style={{ maxWidth: 420, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Восстановление пароля</h1>

      {sent && (
        <p role="status" style={{ color: "#0a7d2c" }}>
          Если этот email зарегистрирован в системе, на него отправлена ссылка для сброса
          пароля (действует 1 час).
        </p>
      )}

      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {ERROR_MESSAGES[error] ?? "Не удалось отправить ссылку."}
          {error === "rate_limited" && retryAfter && ` (~${Math.ceil(Number(retryAfter) / 60)} мин.)`}
        </p>
      )}

      {!sent && (
        <form action={requestPasswordResetAction} style={{ display: "grid", gap: "0.75rem" }}>
          <label>
            Email
            <input name="email" type="email" required autoComplete="email" />
          </label>
          <button type="submit">Отправить ссылку</button>
        </form>
      )}

      <p>
        <a href="/login">Вернуться ко входу</a>
      </p>
    </main>
  );
}
