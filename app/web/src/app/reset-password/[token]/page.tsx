import { resetPasswordAction } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Введите новый пароль.",
  weak_password: "Пароль слишком короткий (минимум 10 символов).",
  mismatch: "Пароли не совпадают.",
  invalid_or_expired: "Ссылка недействительна или уже использована. Запросите новую.",
};

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;

  return (
    <main style={{ maxWidth: 420, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Новый пароль</h1>

      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {ERROR_MESSAGES[error] ?? "Не удалось сохранить новый пароль."}
          {error === "invalid_or_expired" && (
            <>
              {" "}
              <a href="/forgot-password">Запросить новую ссылку</a>
            </>
          )}
        </p>
      )}

      <form action={resetPasswordAction} style={{ display: "grid", gap: "0.75rem" }}>
        <input type="hidden" name="token" value={token} />
        <label>
          Новый пароль
          <input name="password" type="password" required minLength={10} autoComplete="new-password" />
        </label>
        <label>
          Повторите пароль
          <input name="passwordConfirm" type="password" required minLength={10} autoComplete="new-password" />
        </label>
        <button type="submit">Сохранить новый пароль</button>
      </form>
    </main>
  );
}
