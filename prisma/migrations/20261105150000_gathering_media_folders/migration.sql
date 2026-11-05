-- CreateTable
CREATE TABLE "gathering_media_folders" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "gathering_media_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_upload_links" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "eventId" TEXT,
    "folderId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gathering_upload_links_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "gathering_media_assets" ALTER COLUMN "eventId" DROP NOT NULL;
ALTER TABLE "gathering_media_assets" ADD COLUMN "folderId" TEXT;

-- CreateIndex
CREATE INDEX "gathering_media_folders_groupId_deletedAt_idx" ON "gathering_media_folders"("groupId", "deletedAt");
CREATE UNIQUE INDEX "gathering_upload_links_tokenHash_key" ON "gathering_upload_links"("tokenHash");
CREATE INDEX "gathering_upload_links_groupId_eventId_idx" ON "gathering_upload_links"("groupId", "eventId");
CREATE INDEX "gathering_upload_links_groupId_folderId_idx" ON "gathering_upload_links"("groupId", "folderId");
CREATE INDEX "gathering_media_assets_groupId_folderId_idx" ON "gathering_media_assets"("groupId", "folderId");

-- AddForeignKey
ALTER TABLE "gathering_media_folders" ADD CONSTRAINT "gathering_media_folders_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gathering_media_folders" ADD CONSTRAINT "gathering_media_folders_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gathering_upload_links" ADD CONSTRAINT "gathering_upload_links_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gathering_upload_links" ADD CONSTRAINT "gathering_upload_links_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "gathering_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gathering_upload_links" ADD CONSTRAINT "gathering_upload_links_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "gathering_media_folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gathering_upload_links" ADD CONSTRAINT "gathering_upload_links_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gathering_media_assets" ADD CONSTRAINT "gathering_media_assets_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "gathering_media_folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
