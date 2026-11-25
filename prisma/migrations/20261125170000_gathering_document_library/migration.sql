-- CreateTable
CREATE TABLE "gathering_document_folders" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gathering_document_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_documents" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "eventId" TEXT,
    "folderId" TEXT,
    "uploadedByUserId" TEXT,
    "originalName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT,
    "status" "GatheringObjectStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "cleanedAt" TIMESTAMP(3),

    CONSTRAINT "gathering_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gathering_document_folders_groupId_parentId_name_id_idx" ON "gathering_document_folders"("groupId", "parentId", "name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "gathering_document_folders_id_groupId_key" ON "gathering_document_folders"("id", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "gathering_documents_storageKey_key" ON "gathering_documents"("storageKey");

-- CreateIndex
CREATE INDEX "gathering_documents_groupId_eventId_folderId_status_created_idx" ON "gathering_documents"("groupId", "eventId", "folderId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "gathering_documents_cleanedAt_status_createdAt_idx" ON "gathering_documents"("cleanedAt", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "gathering_documents_groupId_checksum_key" ON "gathering_documents"("groupId", "checksum");

-- CreateIndex
CREATE UNIQUE INDEX "gathering_events_id_groupId_key" ON "gathering_events"("id", "groupId");

-- AddForeignKey
ALTER TABLE "gathering_document_folders" ADD CONSTRAINT "gathering_document_folders_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_document_folders" ADD CONSTRAINT "gathering_document_folders_parentId_groupId_fkey" FOREIGN KEY ("parentId", "groupId") REFERENCES "gathering_document_folders"("id", "groupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_documents" ADD CONSTRAINT "gathering_documents_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_documents" ADD CONSTRAINT "gathering_documents_eventId_groupId_fkey" FOREIGN KEY ("eventId", "groupId") REFERENCES "gathering_events"("id", "groupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_documents" ADD CONSTRAINT "gathering_documents_folderId_groupId_fkey" FOREIGN KEY ("folderId", "groupId") REFERENCES "gathering_document_folders"("id", "groupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_documents" ADD CONSTRAINT "gathering_documents_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "gathering_documents" ADD CONSTRAINT "gathering_documents_one_location" CHECK ("eventId" IS NULL OR "folderId" IS NULL);
