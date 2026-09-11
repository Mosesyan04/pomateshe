import { prisma } from "./db";

/**
 * docs/DATABASE.md §7's retention table, the "hard delete plannovoй задачей" rows: Session,
 * PasswordResetToken, EmailVerificationToken, StudentInvite. All four are the "not
 * tenant-scoped, no RLS" category (docs/DATABASE.md §2) — an unguessable token hash or a
 * server-issued session IS the authorization, so this talks to `prisma` directly, same
 * convention as session.ts/invites.ts. It's also one of the few legitimately cross-tenant
 * operations in the whole app: a cleanup run has to reach every teacher's expired invites at
 * once, not one teacher's — exactly why these tables have no RLS to begin with.
 */

export interface AuthCleanupSummary {
  sessionsDeleted: number;
  passwordResetTokensDeleted: number;
  emailVerificationTokensDeleted: number;
  studentInvitesDeleted: number;
}

export async function cleanupExpiredAuthRecords(): Promise<AuthCleanupSummary> {
  const now = new Date();

  const [sessions, passwordResetTokens, emailVerificationTokens, studentInvites] = await Promise.all([
    prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    // A used token is just as done as an expired one — no reason to wait out its TTL once
    // it's already been consumed (docs/AUTH.md §6/§3's single-use tokens).
    prisma.passwordResetToken.deleteMany({
      where: { OR: [{ usedAt: { not: null } }, { expiresAt: { lt: now } }] },
    }),
    prisma.emailVerificationToken.deleteMany({
      where: { OR: [{ usedAt: { not: null } }, { expiresAt: { lt: now } }] },
    }),
    // Explicitly-revoked invites, or ones that simply timed out while still "pending" — an
    // "accepted" invite is a historical record of how a TeacherStudentLink came to exist and
    // is deliberately left alone (docs/DATABASE.md §7 only names "истёкшие/отменённые").
    prisma.studentInvite.deleteMany({
      where: { OR: [{ status: "revoked" }, { status: "pending", expiresAt: { lt: now } }] },
    }),
  ]);

  return {
    sessionsDeleted: sessions.count,
    passwordResetTokensDeleted: passwordResetTokens.count,
    emailVerificationTokensDeleted: emailVerificationTokens.count,
    studentInvitesDeleted: studentInvites.count,
  };
}
