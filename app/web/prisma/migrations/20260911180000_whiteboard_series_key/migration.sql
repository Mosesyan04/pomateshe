-- Rekey Whiteboard away from a single Lesson to a (teacherId, studentLinkId) or (teacherId,
-- groupId) pair — docs/WHITEBOARD.md §3/§9 (review-3): the board now continues across a
-- student's whole lesson series instead of resetting on every Lesson. No data migration
-- needed — the whiteboards table has never had rows in any real deployment (feature not yet
-- implemented before this migration).

-- DropForeignKey
ALTER TABLE "whiteboards" DROP CONSTRAINT "whiteboards_lessonId_fkey";

-- DropIndex
DROP INDEX "whiteboards_lessonId_key";

-- AlterTable
ALTER TABLE "whiteboards"
  DROP COLUMN "lessonId",
  ADD COLUMN "studentLinkId" TEXT,
  ADD COLUMN "groupId" TEXT;

-- AddForeignKey
ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_studentLinkId_fkey" FOREIGN KEY ("studentLinkId") REFERENCES "teacher_student_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
-- Each only actually enforces uniqueness on its own populated side (Postgres treats every
-- NULL as distinct) — together with the CHECK constraint below, this gives "at most one
-- whiteboard per student" and "at most one per group" without the two interfering.
CREATE UNIQUE INDEX "whiteboards_teacherId_studentLinkId_key" ON "whiteboards"("teacherId", "studentLinkId");
CREATE UNIQUE INDEX "whiteboards_teacherId_groupId_key" ON "whiteboards"("teacherId", "groupId");

-- =============================================================================
-- CHECK constraint that Prisma's schema DSL cannot express at this version: exactly one of
-- Whiteboard.studentLinkId / Whiteboard.groupId must be set — same pattern as
-- lessons_exactly_one_target_check (docs/DATABASE.md §1).
-- =============================================================================
ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_exactly_one_target_check"
  CHECK (
    (("studentLinkId" IS NOT NULL)::int + ("groupId" IS NOT NULL)::int) = 1
  );
