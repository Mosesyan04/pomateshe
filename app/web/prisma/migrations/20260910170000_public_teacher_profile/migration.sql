-- AlterTable
-- Pairs with avatarStorageKey, same as MaterialFile.storageKey/mimeType elsewhere — the
-- content-type to serve is picked once at upload time (after magic-byte detection), not
-- re-derived from a client-supplied filename extension on every request.
ALTER TABLE "teacher_profiles" ADD COLUMN "avatarMimeType" TEXT;

-- =============================================================================
-- Public read access to teacher_profiles — see docs/MULTI_TENANCY.md §5 for the rationale.
-- A teacher's public marketing page (/t/[slug]) must be readable by a visitor with NO
-- session at all, which means no app.current_teacher_id is ever set for that request. The
-- existing `tenant_isolation` policy (FOR ALL, id = current_setting(...)) already covers the
-- teacher's own authenticated read/write; this ADDS a second, SELECT-only permissive policy
-- that opens read access to everyone. Postgres ORs permissive policies together for the same
-- command, so a row is now selectable if EITHER policy matches — writes (INSERT/UPDATE/DELETE)
-- are untouched and still require the owning teacher's context.
-- Column-level exposure is NOT enforced by this policy (RLS is row-level, not column-level) —
-- src/server/teacher-profile.ts's getPublicTeacherProfile selects only the intentionally
-- public columns; anything not meant for public viewing (e.g. zoomPersonalLink,
-- publicPageSettings) must never be added to that function's `select` without a deliberate
-- decision, since RLS itself will not stop a query from reading them.
-- =============================================================================
CREATE POLICY public_read ON "teacher_profiles"
  FOR SELECT
  USING (true);
