-- AlterTable
-- Full student-card fields per Phase 2 (ФИО already covered by the existing displayName;
-- contactPhone/contactTelegram already existed). No RLS changes needed — teacher_student_links
-- already carries teacherId/studentUserId and its two existing policies (teacher_scope,
-- student_scope) already cover these new columns like any other column on the table.
ALTER TABLE "teacher_student_links"
  ADD COLUMN "subject" TEXT,
  ADD COLUMN "gradeLevel" TEXT,
  ADD COLUMN "defaultPriceCents" INTEGER,
  ADD COLUMN "defaultDurationMinutes" INTEGER;
