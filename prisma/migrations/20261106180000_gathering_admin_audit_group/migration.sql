-- 담당 관리자 감사는 대상 행 ID가 아니라 모임으로 거른다.
ALTER TABLE "gathering_admin_audits" ADD COLUMN "groupId" TEXT;

CREATE INDEX "gathering_admin_audits_groupId_createdAt_idx" ON "gathering_admin_audits"("groupId", "createdAt");
