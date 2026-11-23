-- AlterTable
ALTER TABLE "gathering_memberships" ADD COLUMN     "addedByUserId" TEXT,
ADD COLUMN     "linkedAt" TIMESTAMP(3),
ADD COLUMN     "linkedByUserId" TEXT,
ADD COLUMN     "manualDisplayName" TEXT,
ADD COLUMN     "manualLocalJcName" TEXT,
ADD COLUMN     "manualPhone" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "gathering_role_assignments" ALTER COLUMN "userId" DROP NOT NULL,
ALTER COLUMN "assignedByUserId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "gathering_executive_terms" ADD COLUMN     "membershipId" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "gathering_member_dues" ADD COLUMN     "membershipId" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "gathering_memberships" ADD CONSTRAINT "gathering_memberships_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_memberships" ADD CONSTRAINT "gathering_memberships_linkedByUserId_fkey" FOREIGN KEY ("linkedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_executive_terms" ADD CONSTRAINT "gathering_executive_terms_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "gathering_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_member_dues" ADD CONSTRAINT "gathering_member_dues_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "gathering_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "gathering_memberships_group_manual_phone_active_key"
ON "gathering_memberships" ("groupId", "manualPhone")
WHERE "userId" IS NULL AND "manualPhone" IS NOT NULL AND "status" IN ('ACTIVE', 'PENDING', 'SUSPENDED');

CREATE UNIQUE INDEX "gathering_member_dues_group_membership_year_key"
ON "gathering_member_dues" ("groupId", "membershipId", "financeYearId")
WHERE "membershipId" IS NOT NULL;
