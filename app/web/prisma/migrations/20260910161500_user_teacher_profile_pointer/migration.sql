-- AlterTable
ALTER TABLE "users" ADD COLUMN "teacherProfileId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_teacherProfileId_key" ON "users"("teacherProfileId");
