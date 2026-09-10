import { prisma } from "./db";
import type { Prisma } from "../../generated/prisma/client";

/**
 * The ONLY way to talk to tenant-scoped tables. See docs/MULTI_TENANCY.md §2.1 for the full
 * rationale — summarized:
 *
 * - `set_config(..., true)` (the `true` = is_local) is equivalent to `SET LOCAL`: it only
 *   lives for the current transaction and is automatically cleared on commit/rollback. This
 *   MUST happen inside the same `$transaction` as every query that follows, on the same
 *   pooled connection — setting it outside a transaction (or with plain `SET`, not
 *   `SET LOCAL`) would leak the value onto a connection Prisma later hands to an unrelated
 *   request once it's returned to the pool.
 * - Postgres RLS then does the real enforcement (docs/MULTI_TENANCY.md §2.2-2.3) — this
 *   function does not itself filter anything; it only tells Postgres which tenant the
 *   current transaction is allowed to see.
 * - `set_config` is called through Prisma's tagged-template `$executeRaw`, which
 *   parameterizes the value — never string-concatenate a teacherId/studentUserId into SQL
 *   here, even though both values come from server-trusted session data, not client input
 *   (defense-in-depth, docs/SECURITY.md §5).
 *
 * Route handlers and Server Actions must never call `prisma.<model>.*` directly for a
 * tenant-scoped model — always go through a data-access function that itself calls
 * `withTenantContext`. This is enforced by code review, not by the type system.
 */

export interface TenantContext {
  /** Set for requests acting as a teacher (their own data). */
  teacherId?: string;
  /** Set for requests acting as a student (their own TeacherStudentLink rows only — see
   *  docs/MULTI_TENANCY.md §3.2). Never combine with teacherId in the same call. */
  studentUserId?: string;
}

export async function withTenantContext<T>(
  ctx: TenantContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!ctx.teacherId && !ctx.studentUserId) {
    throw new Error(
      "withTenantContext called with no teacherId or studentUserId — this is almost " +
        "certainly a bug at the call site, not a legitimate 'no tenant' request. Postgres " +
        "RLS would fail-closed (return zero rows) rather than leak data, but a query that " +
        "can never succeed should fail loudly here instead of silently returning nothing.",
    );
  }
  if (ctx.teacherId && ctx.studentUserId) {
    throw new Error(
      "withTenantContext called with both teacherId and studentUserId set — these are " +
        "mutually exclusive per call (docs/MULTI_TENANCY.md §3.2). Split into two calls if " +
        "a single request genuinely needs both perspectives.",
    );
  }

  return prisma.$transaction(async (tx) => {
    if (ctx.teacherId) {
      await tx.$executeRaw`SELECT set_config('app.current_teacher_id', ${ctx.teacherId}, true)`;
    }
    if (ctx.studentUserId) {
      await tx.$executeRaw`SELECT set_config('app.current_student_user_id', ${ctx.studentUserId}, true)`;
    }
    return fn(tx);
  });
}
