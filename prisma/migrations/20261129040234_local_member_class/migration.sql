-- CreateEnum
CREATE TYPE "LocalMemberClass" AS ENUM ('YB', 'OB');

-- AlterTable
ALTER TABLE "LocalMembership" ADD COLUMN     "memberClass" "LocalMemberClass";

-- CreateTable
CREATE TABLE "local_member_class_changes" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "fromClass" "LocalMemberClass",
    "toClass" "LocalMemberClass" NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "revertsChangeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_member_class_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "local_member_class_changes_membershipId_createdAt_idx" ON "local_member_class_changes"("membershipId", "createdAt");

-- AddForeignKey
ALTER TABLE "local_member_class_changes" ADD CONSTRAINT "local_member_class_changes_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "LocalMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_member_class_changes" ADD CONSTRAINT "local_member_class_changes_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
