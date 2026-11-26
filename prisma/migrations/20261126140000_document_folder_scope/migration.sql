ALTER TABLE "gathering_document_folders" ADD COLUMN "eventId" TEXT, ADD COLUMN "createdByUserId" TEXT;
CREATE INDEX "document_folder_scope_idx" ON "gathering_document_folders"("groupId", "eventId", "parentId");
ALTER TABLE "gathering_document_folders" ADD CONSTRAINT "document_folder_event_group_fk" FOREIGN KEY ("eventId", "groupId") REFERENCES "gathering_events"("id", "groupId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gathering_documents" DROP CONSTRAINT "gathering_documents_one_location";
