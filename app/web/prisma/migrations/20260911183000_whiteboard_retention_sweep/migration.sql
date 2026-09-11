-- Whiteboard (Phase 3, snapshot persistence + retention cron):
--
-- 1. Drop `snapshotStorageKey` — dead column. The object key is computed deterministically
--    from (teacherId, whiteboardId) by both app/web and app/realtime, never stored, because
--    the realtime process that actually writes snapshots has no Postgres access at all
--    (docs/WHITEBOARD.md §2/§4) and must be able to derive its own key from token claims
--    alone, not from a value read back out of this column.
ALTER TABLE "whiteboards" DROP COLUMN "snapshotStorageKey";

-- 2. Second, narrow permissive policies letting the retention cron (running as the ordinary
--    pomateshe_app role, no withTenantContext, no new DB role) see and delete ONLY whiteboards
--    already past their own expiresAt — mirrors the public_read precedent on teacher_profiles
--    (see migration 20260910170000_teacher_profile_contact_info's public read policy and
--    docs/MULTI_TENANCY.md §4.3). Full rationale: docs/MULTI_TENANCY.md §4.5.
--
--    The existing `tenant_isolation` policy is untouched and still applies for every normal,
--    per-teacher request made through withTenantContext. Postgres ORs permissive policies for
--    the same command, so a row is visible/deletable via EITHER "teacherId matches the
--    session's tenant" OR "expiresAt has already passed" — never both required at once, and
--    never anything beyond SELECT/DELETE (no INSERT/UPDATE policy added here).
CREATE POLICY retention_sweep_select ON "whiteboards"
  FOR SELECT
  USING ("expiresAt" < now());

CREATE POLICY retention_sweep_delete ON "whiteboards"
  FOR DELETE
  USING ("expiresAt" < now());
