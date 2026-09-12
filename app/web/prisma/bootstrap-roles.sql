-- Bootstrap: database role for Pomateshe, matching docs/MULTI_TENANCY.md §2.3/§2.3.1.
--
-- [Updated pre-deploy] Originally two roles (pomateshe_migrator owning the schema,
-- pomateshe_app as a non-owner runtime role) — SprintHost confirmed their shared-hosting
-- tariff allows exactly ONE fixed Postgres role per database, created by their panel, with no
-- way to add a second one (not through the panel, not on request to support). This script now
-- creates a SINGLE role that is both the schema owner (runs `prisma migrate deploy`) and the
-- runtime role the app connects as — DATABASE_URL and APP_DATABASE_URL point at the exact
-- same credentials in this model, not two different roles.
--
-- pomateshe_app: owns the schema AND is the runtime role. NOSUPERUSER, NOBYPASSRLS — these
--                two are what actually keeps Row-Level Security enforced despite this role
--                owning the tables, via FORCE ROW LEVEL SECURITY on every tenant table
--                (verified empirically, see src/server/__tests__/rls-schema-policy.test.ts).
--                No GRANT, however broad, can substitute for these two role ATTRIBUTES —
--                see docs/MULTI_TENANCY.md §2.3.1 for the full risk analysis of this model
--                versus the original two-role design.
-- pomateshe_admin_support: separate role for the explicit, audited admin support-mode
--                      (docs/MULTI_TENANCY.md §5). Not created here — added when that
--                      feature is actually built (Правило 10 ТЗ: not before it's needed).
--
-- On SprintHost, this role is created by their panel (see docs/DEPLOYMENT.md), not by running
-- this script — this script exists for local development and any OTHER environment (a
-- self-hosted Postgres, a future managed-Postgres provider) where a superuser connection to
-- bootstrap roles from is actually available. Run once per such environment. Idempotent.
--
-- The password below is a LOCAL DEV DEFAULT ONLY (see docs/SECURITY.md §7 — secrets never
-- live in the repo). Staging/production must set a real, unique password out-of-band (e.g.
-- `ALTER ROLE ... WITH PASSWORD '...'` run manually, value stored only in the host's secret
-- manager / .env, never committed) — never reuse this value outside local development.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pomateshe_app') THEN
    CREATE ROLE pomateshe_app WITH LOGIN PASSWORD 'pomateshe_app_dev_only' NOSUPERUSER CREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- Local dev/test database, owned by the single role — `prisma migrate deploy` runs as this
-- role (CREATEDB above is needed only for this local-bootstrap convenience and for `prisma
-- migrate dev`'s shadow database; production's `migrate deploy` needs neither).
SELECT 'CREATE DATABASE pomateshe OWNER pomateshe_app'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'pomateshe')\gexec
