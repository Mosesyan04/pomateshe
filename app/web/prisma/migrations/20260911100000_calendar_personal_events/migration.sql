-- AlterTable
ALTER TABLE "calendar_integrations" ADD COLUMN "disabledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "personal_calendar_events" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personal_calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "personal_calendar_events_ownerUserId_idx" ON "personal_calendar_events"("ownerUserId");

-- AddForeignKey
ALTER TABLE "personal_calendar_events" ADD CONSTRAINT "personal_calendar_events_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- RLS for personal_calendar_events — see docs/MULTI_TENANCY.md §4.4.
-- Not the usual "teacherId column" pattern (docs/MULTI_TENANCY.md §2.2): this table isn't
-- tenant data at all, it's owned by exactly one User regardless of role, so the policy keys
-- on a THIRD session variable (app.current_user_id) that withTenantContext now also knows
-- how to set (src/server/tenant-context.ts) — distinct from app.current_teacher_id (which is
-- a TeacherProfile.id, not a User.id) and app.current_student_user_id.
-- =============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON "personal_calendar_events" TO pomateshe_app;

ALTER TABLE "personal_calendar_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personal_calendar_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON "personal_calendar_events"
  USING ("ownerUserId" = current_setting('app.current_user_id', true));
