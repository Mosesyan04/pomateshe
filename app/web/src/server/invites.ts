import { prisma } from "./db";
import { withTenantContext } from "./tenant-context";
import { generateOpaqueToken, hashOpaqueToken } from "../lib/auth/tokens";
import { hashPassword } from "../lib/auth/password";
import { createSession, type CreatedSession } from "../lib/auth/session";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — a product constant, not architecture

/**
 * Invite-only student registration — docs/AUTH.md §3: a student account is only ever created
 * (or linked to an existing account) in response to a teacher-issued invite, which is what
 * ties every student to a specific teacherId before they ever have a password. This closes
 * the "ownerless student" gap that a self-serve student signup would otherwise create.
 */

export interface CreatedInvite {
  id: string;
  /** Raw token — embed as /invite/{token} in the link sent to the prospective student.
   *  Never stored anywhere; only its hash is (docs/AUTH.md §2). */
  token: string;
  expiresAt: Date;
}

export async function createInvite(teacherId: string, email: string): Promise<CreatedInvite> {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const invite = await prisma.studentInvite.create({
    data: {
      teacherId,
      email: email.toLowerCase().trim(),
      tokenHash: hashOpaqueToken(token),
      expiresAt,
    },
  });

  return { id: invite.id, token, expiresAt };
}

export async function listInvitesForTeacher(teacherId: string) {
  return prisma.studentInvite.findMany({
    where: { teacherId },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeInvite(teacherId: string, inviteId: string): Promise<void> {
  // Filtered by teacherId explicitly here (not RLS) — see the model comment in
  // schema.prisma for why StudentInvite has no RLS policy. updateMany (not update) so a
  // mismatched teacherId silently matches zero rows instead of throwing a not-found on
  // another teacher's invite id, which would otherwise leak "yes, that id exists".
  await prisma.studentInvite.updateMany({
    where: { id: inviteId, teacherId },
    data: { status: "revoked" },
  });
}

export type InviteLookup =
  | { valid: true; email: string; teacherDisplayName: string; existingAccount: boolean }
  | { valid: false; reason: "not_found" | "expired" | "already_used" };

/** For the public /invite/[token] page — no auth required, the token itself is the credential. */
export async function lookupInvite(rawToken: string): Promise<InviteLookup> {
  // Deliberately NOT `include: { teacher: true }` — student_invites has no RLS, but
  // teacher_profiles does (docs/MULTI_TENANCY.md §2.3), and this runs with no tenant context
  // set (the visitor isn't authenticated as anyone yet). A plain Prisma `include` join would
  // silently come back null rather than erroring, which crashed this exact function the
  // first time (caught by src/server/__tests__/invites.test.ts). The fix is the same pattern
  // Phase 2's public teacher page will need too: once you already know a specific teacherId
  // through a legitimate, non-tenant-gated lookup (here: the invite token; there: the public
  // slug), it's safe to set context to exactly that one teacherId to read that one profile —
  // RLS still only ever reveals that single already-known row, not a range.
  const invite = await prisma.studentInvite.findUnique({
    where: { tokenHash: hashOpaqueToken(rawToken) },
  });

  if (!invite) return { valid: false, reason: "not_found" };
  if (invite.status !== "pending") return { valid: false, reason: "already_used" };
  if (invite.expiresAt < new Date()) return { valid: false, reason: "expired" };

  const [teacher, existingUser] = await Promise.all([
    withTenantContext({ teacherId: invite.teacherId }, (tx) =>
      tx.teacherProfile.findUniqueOrThrow({
        where: { id: invite.teacherId },
        select: { displayName: true },
      }),
    ),
    prisma.user.findUnique({ where: { email: invite.email } }),
  ]);

  return {
    valid: true,
    email: invite.email,
    teacherDisplayName: teacher.displayName,
    existingAccount: existingUser !== null,
  };
}

export interface AcceptInviteResult {
  session: CreatedSession;
  userId: string;
}

/**
 * Branch 1 of docs/AUTH.md §3: the invited email has no existing account — create the User
 * and the TeacherStudentLink together, then log them in immediately.
 */
export async function acceptInviteAsNewUser(
  rawToken: string,
  password: string,
): Promise<AcceptInviteResult> {
  const tokenHash = hashOpaqueToken(rawToken);
  const invite = await prisma.studentInvite.findUnique({ where: { tokenHash } });

  if (!invite || invite.status !== "pending" || invite.expiresAt < new Date()) {
    throw new Error("Invite is not valid or has expired.");
  }

  const existing = await prisma.user.findUnique({ where: { email: invite.email } });
  if (existing) {
    throw new Error(
      "An account with this email already exists — log in first, then accept the invite.",
    );
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email: invite.email, passwordHash, role: "student" },
  });

  await withTenantContext({ teacherId: invite.teacherId }, (tx) =>
    tx.teacherStudentLink.create({
      data: {
        teacherId: invite.teacherId,
        studentUserId: user.id,
        joinedAt: new Date(),
      },
    }),
  );

  await prisma.studentInvite.update({
    where: { id: invite.id },
    data: { status: "accepted", acceptedAt: new Date() },
  });

  const session = await createSession(user.id);
  return { session, userId: user.id };
}

/**
 * Branch 2 of docs/AUTH.md §3: the invited email already has an account (student of another
 * teacher already) — no new User, just a new TeacherStudentLink for their existing account.
 * Requires an authenticated session belonging to that same user (checked by the caller — see
 * the /invite/[token] Server Action) so a stranger can't link someone else's account to a
 * teacher just by knowing their email.
 */
export async function acceptInviteForExistingUser(
  rawToken: string,
  authenticatedUserId: string,
): Promise<void> {
  const tokenHash = hashOpaqueToken(rawToken);
  const invite = await prisma.studentInvite.findUnique({ where: { tokenHash } });

  if (!invite || invite.status !== "pending" || invite.expiresAt < new Date()) {
    throw new Error("Invite is not valid or has expired.");
  }

  const authenticatedUser = await prisma.user.findUnique({
    where: { id: authenticatedUserId },
  });
  if (!authenticatedUser || authenticatedUser.email !== invite.email) {
    throw new Error(
      "This invite was sent to a different email than the account you're logged in as.",
    );
  }

  await withTenantContext({ teacherId: invite.teacherId }, (tx) =>
    tx.teacherStudentLink.upsert({
      where: {
        teacherId_studentUserId: { teacherId: invite.teacherId, studentUserId: authenticatedUser.id },
      },
      create: {
        teacherId: invite.teacherId,
        studentUserId: authenticatedUser.id,
        joinedAt: new Date(),
      },
      update: { status: "active" },
    }),
  );

  await prisma.studentInvite.update({
    where: { id: invite.id },
    data: { status: "accepted", acceptedAt: new Date() },
  });
}
