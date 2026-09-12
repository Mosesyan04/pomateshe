import { describe, it, expect, afterAll } from "vitest";
import { rawAppPool } from "./test-helpers";

/**
 * docs/MULTI_TENANCY.md §6.4 / §2.3.1, docs/TESTING.md §2 point 3 — "Schema policy test".
 *
 * [Updated pre-deploy] Originally written for two roles (pomateshe_migrator owning the
 * schema, pomateshe_app as a non-owning runtime role) — SprintHost confirmed their tariff
 * allows exactly one fixed Postgres role, so the runtime role now unavoidably owns the
 * tables it queries. This is the test that would have caught the ORIGINAL finding driving
 * the two-role design (RLS can be ENABLEd and have policies defined, and still do nothing,
 * if the connecting role owns the table and FORCE isn't set) — it still catches exactly that,
 * now for a single role instead of asserting the role can't be the owner at all.
 *
 * What actually keeps isolation intact under this single-role model (verified empirically
 * against this project's real schema before adopting it, see docs/MULTI_TENANCY.md §2.3.1):
 * FORCE ROW LEVEL SECURITY makes RLS apply even to the owning role, AS LONG AS that role has
 * neither SUPERUSER nor BYPASSRLS — no GRANT, however broad ("standard full rights", which is
 * all some hosting panels allow choosing), can substitute for or override those two role
 * ATTRIBUTES. This test asserts both halves directly against the schema/role catalog, not by
 * relying on ownership behavior — so it single-handedly protects the single-role model too.
 *
 * What this model gives up, and this test cannot catch: since the runtime role now owns the
 * tables, its own credentials (e.g. under a hypothetical future SQL-injection bug) could run
 * ALTER TABLE ... DISABLE ROW LEVEL SECURITY or DROP POLICY — an owner can always do that to
 * their own objects, no test run against the schema after the fact changes that. The original
 * two-role design closed that specific door; this one doesn't. Accepted, documented tradeoff
 * (docs/MULTI_TENANCY.md §2.3.1), not something a schema-policy assertion can compensate for.
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

const NON_TENANT_TABLES = ["users", "sessions", "password_reset_tokens", "consent_records", "audit_logs"];

afterAll(async () => {
  await rawAppPool.end();
});

async function currentRuntimeRole(): Promise<string> {
  const { rows } = await rawAppPool.query<{ current_user: string }>("SELECT current_user");
  return rows[0].current_user;
}

describe("RLS schema policy (single-role model)", () => {
  it("has RLS enabled AND forced on every tenant table", async () => {
    const { rows } = await rawAppPool.query<{
      tablename: string;
      rls_enabled: boolean;
      rls_forced: boolean;
      tableowner: string;
    }>(
      `
      SELECT c.relname AS tablename,
             c.relrowsecurity AS rls_enabled,
             c.relforcerowsecurity AS rls_forced,
             pg_get_userbyid(c.relowner) AS tableowner
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname = ANY($1::text[])
    `,
      [TENANT_TABLES],
    );

    expect(rows).toHaveLength(TENANT_TABLES.length);

    for (const row of rows) {
      expect(row.rls_enabled, `${row.tablename}: RLS must be ENABLED`).toBe(true);
      // The load-bearing assertion under the single-role model: without FORCE, the runtime
      // role (which now owns every table) would bypass RLS entirely, regardless of policies.
      expect(row.rls_forced, `${row.tablename}: RLS must be FORCED (this role owns the table)`).toBe(true);
    }
  });

  it("confirms the runtime role owns the tenant tables (expected under the single-role model, not a violation)", async () => {
    const runtimeRole = await currentRuntimeRole();
    const { rows } = await rawAppPool.query<{ tablename: string; tableowner: string }>(
      `
      SELECT c.relname AS tablename, pg_get_userbyid(c.relowner) AS tableowner
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname = ANY($1::text[])
    `,
      [TENANT_TABLES],
    );

    expect(rows).toHaveLength(TENANT_TABLES.length);
    for (const row of rows) {
      expect(row.tableowner, `${row.tablename}: expected the single runtime role to own it`).toBe(runtimeRole);
    }
  });

  it("confirms the runtime role has neither SUPERUSER nor BYPASSRLS — the only two attributes FORCE cannot override", async () => {
    const runtimeRole = await currentRuntimeRole();
    const { rows } = await rawAppPool.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`, [runtimeRole]);

    expect(rows).toHaveLength(1);
    expect(rows[0].rolsuper, "runtime role must not be SUPERUSER — FORCE ROW LEVEL SECURITY never applies to one").toBe(
      false,
    );
    expect(
      rows[0].rolbypassrls,
      "runtime role must not have BYPASSRLS — no amount of GRANT-based privilege can substitute for this",
    ).toBe(false);
  });

  it("does not enable RLS on non-tenant tables (sanity check against over-applying it)", async () => {
    const { rows } = await rawAppPool.query<{ tablename: string; rls_enabled: boolean }>(
      `
      SELECT c.relname AS tablename, c.relrowsecurity AS rls_enabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname = ANY($1::text[])
    `,
      [NON_TENANT_TABLES],
    );

    expect(rows).toHaveLength(NON_TENANT_TABLES.length);
    for (const row of rows) {
      expect(row.rls_enabled, `${row.tablename}: should NOT have RLS`).toBe(false);
    }
  });
});
