-- CreateEnum
CREATE TYPE "JcVerificationState" AS ENUM ('CONFIRMED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "JcOrgType" AS ENUM ('DISTRICT', 'LOCAL');

-- AlterTable
ALTER TABLE "District" ADD COLUMN     "adminNote" TEXT,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "lastVerifiedAt" DATE,
ADD COLUMN     "registryKey" TEXT,
ADD COLUMN     "reviewReason" TEXT,
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "verificationState" "JcVerificationState" NOT NULL DEFAULT 'NEEDS_REVIEW';

-- AlterTable
ALTER TABLE "Local" ADD COLUMN     "adminNote" TEXT,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "lastVerifiedAt" DATE,
ADD COLUMN     "registryKey" TEXT,
ADD COLUMN     "reviewReason" TEXT,
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "verificationState" "JcVerificationState" NOT NULL DEFAULT 'NEEDS_REVIEW';

-- AlterTable
ALTER TABLE "gathering_local_affiliations" ADD COLUMN     "localId" TEXT;

-- AlterTable
ALTER TABLE "gathering_groups" ADD COLUMN     "scopeDistrictId" TEXT,
ADD COLUMN     "scopeLocalId" TEXT;

-- AlterTable
ALTER TABLE "gathering_memberships" ADD COLUMN     "manualLocalId" TEXT;

-- CreateTable
CREATE TABLE "jc_organization_aliases" (
    "id" TEXT NOT NULL,
    "orgType" "JcOrgType" NOT NULL,
    "districtId" TEXT,
    "localId" TEXT,
    "alias" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jc_organization_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jc_organization_histories" (
    "id" TEXT NOT NULL,
    "orgType" "JcOrgType" NOT NULL,
    "districtId" TEXT,
    "localId" TEXT,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "actorAdminId" TEXT,
    "actorLabel" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jc_organization_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jc_organization_aliases_normalized_idx" ON "jc_organization_aliases"("normalized");

-- CreateIndex
CREATE UNIQUE INDEX "jc_organization_aliases_localId_normalized_key" ON "jc_organization_aliases"("localId", "normalized");

-- CreateIndex
CREATE UNIQUE INDEX "jc_organization_aliases_districtId_normalized_key" ON "jc_organization_aliases"("districtId", "normalized");

-- CreateIndex
CREATE INDEX "jc_organization_histories_localId_createdAt_idx" ON "jc_organization_histories"("localId", "createdAt");

-- CreateIndex
CREATE INDEX "jc_organization_histories_districtId_createdAt_idx" ON "jc_organization_histories"("districtId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "District_registryKey_key" ON "District"("registryKey");

-- CreateIndex
CREATE UNIQUE INDEX "Local_registryKey_key" ON "Local"("registryKey");

-- CreateIndex
CREATE INDEX "Local_approvalNumber_idx" ON "Local"("approvalNumber");

-- CreateIndex
CREATE INDEX "gathering_local_affiliations_localId_idx" ON "gathering_local_affiliations"("localId");

-- CreateIndex
CREATE INDEX "gathering_groups_scopeDistrictId_idx" ON "gathering_groups"("scopeDistrictId");

-- CreateIndex
CREATE INDEX "gathering_groups_scopeLocalId_idx" ON "gathering_groups"("scopeLocalId");

-- CreateIndex
CREATE INDEX "gathering_memberships_manualLocalId_idx" ON "gathering_memberships"("manualLocalId");

-- AddForeignKey
ALTER TABLE "jc_organization_aliases" ADD CONSTRAINT "jc_organization_aliases_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jc_organization_aliases" ADD CONSTRAINT "jc_organization_aliases_localId_fkey" FOREIGN KEY ("localId") REFERENCES "Local"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jc_organization_histories" ADD CONSTRAINT "jc_organization_histories_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jc_organization_histories" ADD CONSTRAINT "jc_organization_histories_localId_fkey" FOREIGN KEY ("localId") REFERENCES "Local"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jc_organization_histories" ADD CONSTRAINT "jc_organization_histories_actorAdminId_fkey" FOREIGN KEY ("actorAdminId") REFERENCES "gathering_admin_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_local_affiliations" ADD CONSTRAINT "gathering_local_affiliations_localId_fkey" FOREIGN KEY ("localId") REFERENCES "Local"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_groups" ADD CONSTRAINT "gathering_groups_scopeDistrictId_fkey" FOREIGN KEY ("scopeDistrictId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_groups" ADD CONSTRAINT "gathering_groups_scopeLocalId_fkey" FOREIGN KEY ("scopeLocalId") REFERENCES "Local"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_memberships" ADD CONSTRAINT "gathering_memberships_manualLocalId_fkey" FOREIGN KEY ("manualLocalId") REFERENCES "Local"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

