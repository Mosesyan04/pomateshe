-- Bootstrap: database roles for Pomateshe, matching docs/MULTI_TENANCY.md §2.3.
--
-- pomateshe_migrator: owns the schema, runs `prisma migrate deploy`. Never used at runtime.
-- pomateshe_app:      runtime role for the Next.js app. NOT a table owner, no BYPASSRLS —
--                      this is what makes Row-Level Security actually take effect (see
--                      docs/MULTI_TENANCY.md §2.3 for why owning the tables would silently
--                      defeat RLS).
-- pomateshe_admin_support: separate role for the explicit, audited admin support-mode
--                      (docs/MULTI_TENANCY.md §5). Not created here — added when that
--                      feature is actually built (Правило 10 ТЗ: not before it's needed).
--
-- Run once per environment as a Postgres superuser. Idempotent (safe to re-run).
--
-- The passwords below are LOCAL DEV DEFAULTS ONLY (see docs/SECURITY.md §7 — secrets never
-- live in the repo). Staging/production must set real, unique passwords out-of-band (e.g.
-- `ALTER ROLE ... WITH PASSWORD '...'` run manually, value stored only in the host's secret
-- manager / .env, never committed) — never reuse these values outside local development.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pomateshe_migrator') THEN
    CREATE ROLE pomateshe_migrator WITH LOGIN PASSWORD 'pomateshe_migrator_dev_only' CREATEDB;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pomateshe_app') THEN
    CREATE ROLE pomateshe_app WITH LOGIN PASSWORD 'pomateshe_app_dev_only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- Local dev/test database, owned by the migrator role.
SELECT 'CREATE DATABASE pomateshe OWNER pomateshe_migrator'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'pomateshe')\gexec

GRANT CONNECT ON DATABASE pomateshe TO pomateshe_app;
