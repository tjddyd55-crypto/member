-- 휴대폰 단위 체험 제한을 걷어 낸다. 기존 체험 행은 지우지 않는다.
DROP INDEX IF EXISTS "gathering_trial_claims_phoneHash_key";
ALTER TABLE "gathering_trial_claims" DROP COLUMN IF EXISTS "phoneHash";
DROP INDEX IF EXISTS "gathering_trial_claims_groupId_idx";
CREATE UNIQUE INDEX "gathering_trial_claims_groupId_key" ON "gathering_trial_claims"("groupId");
