-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('pending', 'accepted', 'revoked');

-- CreateTable
CREATE TABLE "student_invites" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "student_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_invites_tokenHash_key" ON "student_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "student_invites_teacherId_idx" ON "student_invites"("teacherId");

-- AddForeignKey
ALTER TABLE "student_invites" ADD CONSTRAINT "student_invites_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teacher_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
