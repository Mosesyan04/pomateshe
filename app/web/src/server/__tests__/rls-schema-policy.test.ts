import { describe, it, expect, afterAll } from "vitest";
import { rawAppPool } from "./test-helpers";

/**
 * docs/MULTI_TENANCY.md §6.4 / docs/TESTING.md §2 point 3 — "Schema policy test".
 *
 * This is the test that would have caught the main finding of the second architecture
 * review: RLS can be `ENABLE`d and have policies defined, and still do nothing, if the
 * connecting role happens to own the table (table owners bypass RLS unless
 * FORCE ROW LEVEL SECURITY is also set). No HTTP-level or even ordinary SQL-level test
 * catches that — it requires literally checking pg_class for ownership and the force flag.
 * Runs against every migration in CI, not just once by hand.
 */

const TENANT_TABLES = [
  "teacher_profiles",
  "teacher_student_links",
  "groups",
  "group_members",
  "lessons",
  "homework",
  "material_files",
  "whiteboards",
  "calendar_integrations",
  "personal_calendar_events",
];

const NON_TENANT_TABLES = [
  "users",
  "sessions",
  "password_reset_tokens",
  "consent_records",
  "audit_logs",
];

afterAll(async () => {
  await rawAppPool.end();
});

describe("RLS schema policy", () => {
  it("has RLS enabled AND forced on every tenant table, owned by someone other than the runtime role", async () => {
    const { rows } = await rawAppPool.query<{
      tablename: string;
      rls_enabled: boolean;
      rls_forced: boolean;
      tableowner: string;
    }>(`
      SELECT c.relname AS tablename,
             c.relrowsecurity AS rls_enabled,
             c.relforcerowsecurity AS rls_forced,
             pg_get_userbyid(c.relowner) AS tableowner
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname = ANY($1::text[])
    `, [TENANT_TABLES]);

    expect(rows).toHaveLength(TENANT_TABLES.length);

    for (const row of rows) {
      expect(row.rls_enabled, `${row.tablename}: RLS must be ENABLED`).toBe(true);
      expect(row.rls_forced, `${row.tablename}: RLS must be FORCED (owner bypass otherwise)`).toBe(true);
      expect(row.tableowner, `${row.tablename}: must not be owned by the runtime role`).not.toBe(
        "pomateshe_app",
      );
    }
  });

  it("confirms the runtime role itself has no RLS-bypassing attributes", async () => {
    const { rows } = await rawAppPool.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'pomateshe_app'`);

    expect(rows).toHaveLength(1);
    expect(rows[0].rolsuper).toBe(false);
    expect(rows[0].rolbypassrls).toBe(false);
  });

  it("does not enable RLS on non-tenant tables (sanity check against over-applying it)", async () => {
    const { rows } = await rawAppPool.query<{ tablename: string; rls_enabled: boolean }>(`
      SELECT c.relname AS tablename, c.relrowsecurity AS rls_enabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname = ANY($1::text[])
    `, [NON_TENANT_TABLES]);

    expect(rows).toHaveLength(NON_TENANT_TABLES.length);
    for (const row of rows) {
      expect(row.rls_enabled, `${row.tablename}: should NOT have RLS`).toBe(false);
    }
  });
});
