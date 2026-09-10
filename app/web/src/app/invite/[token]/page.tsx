import { lookupInvite } from "../../../server/invites";
import { getCurrentUser } from "../../../lib/auth/current-user";
import { acceptInviteAsNewUserAction, confirmInviteForExistingUserAction } from "./actions";

const INVALID_MESSAGES: Record<string, string> = {
  not_found: "Приглашение не найдено.",
  expired: "Срок действия приглашения истёк — попросите преподавателя отправить новое.",
  already_used: "Это приглашение уже использовано или отменено.",
};

const ERROR_MESSAGES: Record<string, string> = {
  weak_password: "Пароль должен быть не короче 10 символов.",
  accept_failed: "Не удалось принять приглашение. Возможно, оно устарело — обновите страницу.",
};

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;

  const invite = await lookupInvite(token);

  if (!invite.valid) {
    return (
      <main style={{ maxWidth: 420, margin: "4rem auto", padding: "0 1rem" }}>
        <h1>Приглашение недействительно</h1>
        <p>{INVALID_MESSAGES[invite.reason]}</p>
      </main>
    );
  }

  const currentUser = await getCurrentUser();

  return (
    <main style={{ maxWidth: 420, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Приглашение от {invite.teacherDisplayName}</h1>
      <p>
        Приглашение отправлено на <strong>{invite.email}</strong>.
      </p>

      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {ERROR_MESSAGES[error] ?? "Не удалось принять приглашение."}
        </p>
      )}

      {currentUser ? (
        <form action={confirmInviteForExistingUserAction}>
          <input type="hidden" name="token" value={token} />
          <p>Вы вошли в систему. Подтвердите привязку к этому преподавателю.</p>
          <button type="submit">Принять приглашение</button>
        </form>
      ) : invite.existingAccount ? (
        <p>
          У вас уже есть аккаунт с этим email —{" "}
          <a href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>войдите</a>, чтобы
          принять приглашение.
        </p>
      ) : (
        <form action={acceptInviteAsNewUserAction} style={{ display: "grid", gap: "0.75rem" }}>
          <input type="hidden" name="token" value={token} />
          <label>
            Придумайте пароль
            <input name="password" type="password" required minLength={10} autoComplete="new-password" />
          </label>
          <button type="submit">Создать аккаунт и принять приглашение</button>
        </form>
      )}
    </main>
  );
}
