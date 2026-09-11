import { prisma } from "../../server/db";
import { generateOpaqueToken, hashOpaqueToken } from "./tokens";

/**
 * docs/AUTH.md §3 — EmailVerificationToken is not tenant-scoped, same RLS-exclusion rationale
 * as PasswordResetToken/Session (docs/DATABASE.md §2): the token hash IS the authorization.
 * Only ever issued for role === "teacher" (see src/app/register/actions.ts) — a student's
 * email is already effectively vouched for by the inviting teacher, docs/AUTH.md doesn't ask
 * for a second verification loop on top of that.
 */

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — more lenient than the
// password-reset token's 1 hour (docs/AUTH.md §6): confirming an email is not a
// security-sensitive action window the same way proving control of an account to change its
// password is, so there's no reason to force a same-session click.

export interface CreatedEmailVerificationToken {
  /** Raw token — embed as /api/verify-email/{token}. Never stored; only its hash is. */
  token: string;
  expiresAt: Date;
}

export async function createEmailVerificationToken(userId: string): Promise<CreatedEmailVerificationToken> {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);
  await prisma.emailVerificationToken.create({
    data: { userId, tokenHash: hashOpaqueToken(token), expiresAt },
  });
  return { token, expiresAt };
}

export type VerifyEmailResult = { ok: true; userId: string } | { ok: false; reason: "invalid_or_expired" };

/** Single-use, same pattern as resetPasswordWithToken (src/lib/auth/password-reset.ts). */
export async function verifyEmailWithToken(token: string): Promise<VerifyEmailResult> {
  const tokenHash = hashOpaqueToken(token);
  const verificationToken = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });

  if (!verificationToken || verificationToken.usedAt || verificationToken.expiresAt < new Date()) {
    return { ok: false, reason: "invalid_or_expired" };
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: verificationToken.userId }, data: { emailVerifiedAt: new Date() } }),
    prisma.emailVerificationToken.update({ where: { id: verificationToken.id }, data: { usedAt: new Date() } }),
  ]);

  return { ok: true, userId: verificationToken.userId };
}
