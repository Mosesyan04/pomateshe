-- AlterTable
-- Free text, teacher-authored — the public page (/t/[slug]) needs SOME way for a prospective
-- student to reach the teacher. Deliberately not a signup/self-register flow: registration
-- stays invite-only (docs/AUTH.md §3, already tested, not being revisited here) — a visitor
-- contacts the teacher off-platform first, the teacher then sends an invite as usual.
ALTER TABLE "teacher_profiles" ADD COLUMN "contactInfo" TEXT;
