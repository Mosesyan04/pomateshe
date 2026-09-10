import { Pool } from "pg";
import { prisma } from "../db";

/**
 * Raw pg pool as the pomateshe_app runtime role, for tests that need to prove something at
 * the SQL level rather than through the Prisma-based withTenantContext wrapper (e.g. the
 * fail-closed test, which must show that RLS itself — not just our application code — is
 * what's blocking access).
 */
export const rawAppPool = new Pool({ connectionString: process.env.APP_DATABASE_URL });

export async function cleanupTestData(userIds: string[]) {
  // Deleting users cascades to everything they own (onDelete: Cascade throughout the
  // schema, docs/DATABASE.md §2) — no tenant context needs to be set for this to reach
  // RLS-protected tables, because Postgres FK cascade actions (ON DELETE CASCADE) run
  // without applying RLS on the cascaded-to table, by documented Postgres design (RLS only
  // gates the DML statement issued directly against a table, not FK-triggered actions on
  // its children). Verified empirically against this schema, not just asserted from docs —
  // deleting a User with no app.current_teacher_id set still fully cascades through
  // TeacherProfile -> Lesson -> Homework etc. This is also why "delete my account"
  // (docs/CONSENTS.md §4) doesn't need special-casing per tenant table: one DELETE on User
  // is enough.
  if (userIds.length === 0) return;
  await prisma.$executeRawUnsafe(`DELETE FROM users WHERE id = ANY($1::text[])`, userIds);
}
