-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'teacher', 'student');

-- CreateEnum
CREATE TYPE "LessonStatus" AS ENUM ('scheduled', 'completed', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "LinkStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('privacy_policy', 'pdn_processing', 'cookie_analytics', 'cookie_marketing', 'offer');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT,
    "subjects" TEXT[],
    "avatarStorageKey" TEXT,
    "timezone" TEXT NOT NULL,
    "publicPageSettings" JSONB NOT NULL DEFAULT '{}',
    "zoomPersonalLink" TEXT,
    "defaultLessonPriceCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_student_links" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "studentUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "contactPhone" TEXT,
    "contactTelegram" TEXT,
    "notes" TEXT,
    "status" "LinkStatus" NOT NULL DEFAULT 'active',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_student_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "studentLinkId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lessons" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "studentLinkId" TEXT,
    "groupId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "status" "LessonStatus" NOT NULL DEFAULT 'scheduled',
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "paidAt" TIMESTAMP(3),
    "zoomLinkSnapshot" TEXT,
    "calendarEventId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homework" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "lessonId" TEXT,
    "studentLinkId" TEXT,
    "groupId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "homework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_files" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "homeworkId" TEXT,
    "lessonId" TEXT,
    "storageKey" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whiteboards" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "snapshotStorageKey" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whiteboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_integrations" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "googleAccountEmail" TEXT,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "calendarId" TEXT,
    "watchChannelId" TEXT,
    "watchExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ConsentType" NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_profiles_userId_key" ON "teacher_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_profiles_slug_key" ON "teacher_profiles"("slug");

-- CreateIndex
CREATE INDEX "teacher_student_links_teacherId_idx" ON "teacher_student_links"("teacherId");

-- CreateIndex
CREATE INDEX "teacher_student_links_studentUserId_idx" ON "teacher_student_links"("studentUserId");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_student_links_teacherId_studentUserId_key" ON "teacher_student_links"("teacherId", "studentUserId");

-- CreateIndex
CREATE INDEX "groups_teacherId_idx" ON "groups"("teacherId");

-- CreateIndex
CREATE INDEX "group_members_teacherId_idx" ON "group_members"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "group_members_groupId_studentLinkId_key" ON "group_members"("groupId", "studentLinkId");

-- CreateIndex
CREATE INDEX "lessons_teacherId_scheduledAt_idx" ON "lessons"("teacherId", "scheduledAt");

-- CreateIndex
CREATE INDEX "lessons_teacherId_paidAt_idx" ON "lessons"("teacherId", "paidAt");

-- CreateIndex
CREATE INDEX "homework_teacherId_dueAt_idx" ON "homework"("teacherId", "dueAt");

-- CreateIndex
CREATE INDEX "material_files_teacherId_idx" ON "material_files"("teacherId");

-- CreateIndex
CREATE INDEX "material_files_homeworkId_idx" ON "material_files"("homeworkId");

-- CreateIndex
CREATE INDEX "material_files_lessonId_idx" ON "material_files"("lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "whiteboards_lessonId_key" ON "whiteboards"("lessonId");

-- CreateIndex
CREATE INDEX "whiteboards_teacherId_idx" ON "whiteboards"("teacherId");

-- CreateIndex
CREATE INDEX "whiteboards_expiresAt_idx" ON "whiteboards"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_integrations_teacherId_key" ON "calendar_integrations"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_integrations_watchChannelId_key" ON "calendar_integrations"("watchChannelId");

-- CreateIndex
CREATE INDEX "consent_records_userId_type_idx" ON "consent_records"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "consent_records_userId_type_policyVersion_key" ON "consent_records"("userId", "type", "policyVersion");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_student_links" ADD CONSTRAINT "teacher_student_links_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teacher_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_student_links" ADD CONSTRAINT "teacher_student_links_studentUserId_fkey" FOREIGN KEY ("studentUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teacher_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teacher_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_studentLinkId_fkey" FOREIGN KEY ("studentLinkId") REFERENCES "teacher_student_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teacher_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_studentLinkId_fkey" FOREIGN KEY ("studentLinkId") REFERENCES "teacher_student_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework" ADD CONSTRAINT "homework_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teacher_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework" ADD CONSTRAINT "homework_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework" ADD CONSTRAINT "homework_studentLinkId_fkey" FOREIGN KEY ("studentLinkId") REFERENCES "teacher_student_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_files" ADD CONSTRAINT "material_files_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teacher_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_files" ADD CONSTRAINT "material_files_homeworkId_fkey" FOREIGN KEY ("homeworkId") REFERENCES "homework"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_files" ADD CONSTRAINT "material_files_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teacher_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_integrations" ADD CONSTRAINT "calendar_integrations_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teacher_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- Row-Level Security — see docs/MULTI_TENANCY.md §2.3, §3.2 for the full rationale.
-- This block is NOT optional and NOT generated by Prisma — every future migration that
-- adds a tenant table must include the same four steps for that table (GRANT, ENABLE,
-- FORCE, CREATE POLICY), in the migration that creates it. See docs/DEPLOYMENT.md §5.
-- =============================================================================

-- Runtime role: NOT the owner of these tables (this migration runs as pomateshe_migrator,
-- which owns everything created above). No BYPASSRLS. This is what makes RLS actually take
-- effect instead of being silently bypassed by table ownership.
GRANT USAGE ON SCHEMA public TO pomateshe_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pomateshe_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pomateshe_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pomateshe_app;

-- teacher_profiles: the tenant root itself. A teacher may only see/edit their OWN profile —
-- policy keys on the table's own "id", not on a teacherId column (there isn't one; this
-- table *is* what teacherId points at everywhere else).
ALTER TABLE "teacher_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teacher_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "teacher_profiles"
  USING ("id" = current_setting('app.current_teacher_id', true));

-- teacher_student_links: the one table with two contexts (teacher's own students, or a
-- student's own links to their teachers) — see docs/MULTI_TENANCY.md §3.2. Two permissive
-- policies OR together; withTenantContext sets exactly one of the two settings per call.
ALTER TABLE "teacher_student_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teacher_student_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY teacher_scope ON "teacher_student_links"
  USING ("teacherId" = current_setting('app.current_teacher_id', true));
CREATE POLICY student_scope ON "teacher_student_links"
  USING ("studentUserId" = current_setting('app.current_student_user_id', true));

-- Remaining tenant tables: single teacher-only policy, direct "teacherId" column compare.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'groups', 'group_members', 'lessons', 'homework',
    'material_files', 'whiteboards', 'calendar_integrations'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("teacherId" = current_setting(''app.current_teacher_id'', true))',
      t
    );
  END LOOP;
END
$$;

-- Not tenant-scoped, no RLS (see docs/DATABASE.md §2): users, sessions,
-- password_reset_tokens, consent_records, audit_logs. Deliberately excluded from the loop
-- above, not an oversight.

-- =============================================================================
-- CHECK constraint that Prisma's schema DSL cannot express at this version:
-- exactly one of Lesson.studentLinkId / Lesson.groupId must be set (docs/DATABASE.md §2).
-- =============================================================================
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_exactly_one_target_check"
  CHECK (
    (("studentLinkId" IS NOT NULL)::int + ("groupId" IS NOT NULL)::int) = 1
  );
