-- 추가만 한다. 기존 이용권, 만료일, 입금, 파일, 인계 행은 갱신하거나 지우지 않는다.
ALTER TYPE "GatheringSubscriptionSource" ADD VALUE 'TRIAL';

ALTER TABLE "gathering_groups" ADD COLUMN "suspendedAt" TIMESTAMP(3);

CREATE TABLE "gathering_trial_claims" (
    "id" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gathering_trial_claims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gathering_trial_claims_phoneHash_key" ON "gathering_trial_claims"("phoneHash");
CREATE INDEX "gathering_trial_claims_groupId_idx" ON "gathering_trial_claims"("groupId");
