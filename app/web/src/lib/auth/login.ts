import { prisma } from "../../server/db";
import { verifyPassword } from "./password";
import { createSession, type CreatedSession } from "./session";

export type LoginResult =
  | { ok: true; session: CreatedSession; role: "admin" | "teacher" | "student" }
  | { ok: false };

/**
 * Deliberately returns the same shape for "no such email" and "wrong password" — see
 * docs/AUTH.md §6 (the same principle applies to login as to password reset: don't let the
 * response distinguish the two, or the endpoint becomes a user-enumeration oracle). Actual
 * rate limiting (docs/SECURITY.md §4) is not implemented yet in Phase 1 — tracked as
 * follow-up work, not silently skipped: see the note in src/app/(public)/login/actions.ts.
 */
export async function login(email: string, password: string): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });

  if (!user || user.disabledAt) {
    return { ok: false };
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    return { ok: false };
  }

  const session = await createSession(user.id);
  return { ok: true, session, role: user.role };
}
