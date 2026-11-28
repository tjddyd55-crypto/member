-- CreateEnum
CREATE TYPE "LocalOwnerAssignmentAction" AS ENUM ('APPOINTED', 'REVOKED');

-- Allow a headquarters admin to record classification without inventing a user actor.
ALTER TABLE "local_member_class_changes" ADD COLUMN "changedByAdminId" TEXT,
ALTER COLUMN "changedByUserId" DROP NOT NULL,
ADD CONSTRAINT "local_member_class_changes_actor_check"
CHECK (("changedByUserId" IS NOT NULL) <> ("changedByAdminId" IS NOT NULL));

-- CreateTable
CREATE TABLE "local_owner_assignments" (
    "id" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "action" "LocalOwnerAssignmentAction" NOT NULL,
    "actorAdminId" TEXT NOT NULL,
    "actorLabel" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_owner_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "local_owner_assignments_localId_createdAt_idx" ON "local_owner_assignments"("localId", "createdAt");

-- AddForeignKey
ALTER TABLE "local_owner_assignments" ADD CONSTRAINT "local_owner_assignments_localId_fkey" FOREIGN KEY ("localId") REFERENCES "Local"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_owner_assignments" ADD CONSTRAINT "local_owner_assignments_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "LocalMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
