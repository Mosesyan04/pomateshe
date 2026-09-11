import { prisma } from "../../server/db";
import { generateOpaqueToken, hashOpaqueToken } from "./tokens";
import { hashPassword } from "./password";
import { revokeAllSessionsForUser } from "./session";

/**
 * docs/AUTH.md §6 — PasswordResetToken is not tenant-scoped (docs/DATABASE.md §2, same
 * category as Session/StudentInvite: an unguessable token hash IS the authorization, RLS
 * would only get in the way of a lookup with no tenant context to set yet), so this talks to
 * `prisma` directly, same convention as session.ts and invites.ts.
 */

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // ~1 hour, docs/AUTH.md §6

export interface CreatedPasswordResetToken {
  /** Raw token — embed as /reset-password/{token}. Never stored; only its hash is. */
  token: string;
  expiresAt: Date;
}

export async function createPasswordResetToken(userId: string): Promise<CreatedPasswordResetToken> {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await prisma.passwordResetToken.create({
    data: { userId, tokenHash: hashOpaqueToken(token), expiresAt },
  });
  return { token, expiresAt };
}

export type ResetPasswordResult = { ok: true } | { ok: false; reason: "invalid_or_expired" };

/**
 * Single-use: `usedAt` is checked on lookup and set atomically alongside the password change,
 * so a token can't be replayed to reset the password a second time (e.g. from a link sitting
 * in an old, already-actioned email). Invalidates every existing Session for the user
 * afterward (docs/AUTH.md §6) — a stolen session token found before the legitimate owner
 * resets their password must not survive the reset.
 */
export async function resetPasswordWithToken(token: string, newPassword: string): Promise<ResetPasswordResult> {
  const tokenHash = hashOpaqueToken(token);
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    return { ok: false, reason: "invalid_or_expired" };
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: resetToken.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } }),
  ]);

  await revokeAllSessionsForUser(resetToken.userId);

  return { ok: true };
}
