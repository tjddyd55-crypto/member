-- CreateEnum
CREATE TYPE "LocalProfileLinkAction" AS ENUM ('LINKED', 'UNLINKED');

-- CreateTable
CREATE TABLE "local_member_profile_links" (
    "id" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "memberProfileId" TEXT NOT NULL,
    "action" "LocalProfileLinkAction" NOT NULL,
    "verificationNote" TEXT NOT NULL,
    "actedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_member_profile_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "local_member_profile_links_membershipId_createdAt_idx" ON "local_member_profile_links"("membershipId", "createdAt");

-- CreateIndex
CREATE INDEX "local_member_profile_links_memberProfileId_createdAt_idx" ON "local_member_profile_links"("memberProfileId", "createdAt");

-- AddForeignKey
ALTER TABLE "local_member_profile_links" ADD CONSTRAINT "local_member_profile_links_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "LocalMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_member_profile_links" ADD CONSTRAINT "local_member_profile_links_memberProfileId_fkey" FOREIGN KEY ("memberProfileId") REFERENCES "MemberProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_member_profile_links" ADD CONSTRAINT "local_member_profile_links_actedByUserId_fkey" FOREIGN KEY ("actedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
