import { prisma } from "./db";
import { hashPassword } from "../lib/auth/password";

/**
 * docs/AUTH.md §3: "Admin: не самостоятельная регистрация — создаётся вручную (seed/CLI)."
 * No self-serve registration route exists for role=admin, on purpose — the only way an admin
 * account comes into being is scripts/create-admin.ts (a thin CLI wrapper around this
 * function) run directly against the database, never through an HTTP-reachable endpoint.
 *
 * User is not tenant-scoped (docs/DATABASE.md §2, no RLS) — same as every other User-table
 * operation in this codebase (session.ts, teachers.ts's own user lookups), talks to `prisma`
 * directly rather than through withTenantContext.
 */

export interface CreateOrPromoteAdminResult {
  userId: string;
  email: string;
  action: "created" | "promoted" | "already_admin";
}

export async function createOrPromoteAdmin(email: string, password: string): Promise<CreateOrPromoteAdminResult> {
  const normalizedEmail = email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (existing) {
    if (existing.role === "admin") {
      return { userId: existing.id, email: normalizedEmail, action: "already_admin" };
    }
    // Promoting rather than refusing lets an ops person turn an already-existing
    // teacher/student account into an admin (handy locally, and there's no reason to force a
    // second account for the same person in production either) — deliberate, not an
    // oversight. Revokes their existing sessions in the same transaction: docs/AUTH.md §5,
    // "Смена роли пользователя администратором инвалидирует все его сессии" applies to any
    // role change, this one included.
    await prisma.$transaction([
      prisma.user.update({ where: { id: existing.id }, data: { role: "admin" } }),
      prisma.session.deleteMany({ where: { userId: existing.id } }),
    ]);
    return { userId: existing.id, email: normalizedEmail, action: "promoted" };
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email: normalizedEmail, passwordHash, role: "admin", emailVerifiedAt: new Date() },
  });
  return { userId: user.id, email: user.email, action: "created" };
}
