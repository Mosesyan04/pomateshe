import { describe, it, expect, afterAll } from "vitest";
import { rawAppPool } from "./test-helpers";

/**
 * docs/MULTI_TENANCY.md §6.3 / docs/TESTING.md §2 point 4 — "Fail-closed test".
 *
 * Proves `current_setting('app.current_teacher_id', true)` returning NULL when unset
 * results in zero visible rows, not an error and not the full table. This is what makes a
 * bug where some code path forgets to call withTenantContext fail safe (nothing visible)
 * rather than fail open (everything visible).
 */

afterAll(async () => {
  await rawAppPool.end();
});

describe("RLS fails closed with no tenant context", () => {
  it("returns zero rows from a tenant table when app.current_teacher_id was never set", async () => {
    const client = await rawAppPool.connect();
    try {
      await client.query("BEGIN");
      // Deliberately NOT calling set_config — this is the point of the test.
      const { rows } = await client.query('SELECT id FROM lessons');
      expect(rows).toHaveLength(0);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("also fails closed for the dual-policy table (teacher_student_links) with neither context set", async () => {
    const client = await rawAppPool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query("SELECT id FROM teacher_student_links");
      expect(rows).toHaveLength(0);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
