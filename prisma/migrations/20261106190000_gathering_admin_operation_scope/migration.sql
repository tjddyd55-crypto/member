-- 같은 멱등 키를 다른 모임이나 대상에 다시 쓰면 이전 결과를 돌려주지 않는다.
ALTER TABLE "gathering_admin_operations" ADD COLUMN "groupId" TEXT;
ALTER TABLE "gathering_admin_operations" ADD COLUMN "targetId" TEXT;
