-- CreateTable
CREATE TABLE "gathering_member_blocks" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "blockerUserId" TEXT NOT NULL,
    "blockedUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gathering_member_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gathering_member_blocks_groupId_blockerUserId_blockedUserId_key" ON "gathering_member_blocks"("groupId", "blockerUserId", "blockedUserId");
CREATE INDEX "gathering_member_blocks_groupId_blockerUserId_idx" ON "gathering_member_blocks"("groupId", "blockerUserId");

-- AddForeignKey
ALTER TABLE "gathering_member_blocks" ADD CONSTRAINT "gathering_member_blocks_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gathering_member_blocks" ADD CONSTRAINT "gathering_member_blocks_blockerUserId_fkey" FOREIGN KEY ("blockerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gathering_member_blocks" ADD CONSTRAINT "gathering_member_blocks_blockedUserId_fkey" FOREIGN KEY ("blockedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
