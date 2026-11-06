-- 기존 이용권·파일·회원 행은 갱신하거나 지우지 않는다.
ALTER TABLE "gathering_subscriptions" ADD COLUMN "approvedByAdminId" TEXT;

CREATE TABLE "gathering_admin_operations" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gathering_admin_operations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "gathering_admin_operations_idempotencyKey_key" ON "gathering_admin_operations"("idempotencyKey");

CREATE TYPE "GatheringDepositStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

CREATE TABLE "gathering_deposits" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "payerName" TEXT NOT NULL,
    "amountWon" INTEGER NOT NULL,
    "paidOn" TIMESTAMP(3) NOT NULL,
    "status" "GatheringDepositStatus" NOT NULL DEFAULT 'PENDING',
    "memo" TEXT,
    "confirmedByAdminId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gathering_deposits_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "gathering_deposits_idempotencyKey_key" ON "gathering_deposits"("idempotencyKey");
CREATE INDEX "gathering_deposits_groupId_status_idx" ON "gathering_deposits"("groupId", "status");

CREATE TABLE "gathering_deposit_links" (
    "id" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gathering_deposit_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "gathering_deposit_links_depositId_key" ON "gathering_deposit_links"("depositId");

CREATE TABLE "gathering_admin_bank_settings" (
    "id" TEXT NOT NULL DEFAULT 'bank',
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "memo" TEXT,
    "updatedByAdminId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gathering_admin_bank_settings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "gathering_subscriptions" ADD CONSTRAINT "gathering_subscriptions_approvedByAdminId_fkey" FOREIGN KEY ("approvedByAdminId") REFERENCES "gathering_admin_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gathering_admin_operations" ADD CONSTRAINT "gathering_admin_operations_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "gathering_admin_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gathering_deposits" ADD CONSTRAINT "gathering_deposits_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gathering_deposits" ADD CONSTRAINT "gathering_deposits_confirmedByAdminId_fkey" FOREIGN KEY ("confirmedByAdminId") REFERENCES "gathering_admin_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gathering_deposit_links" ADD CONSTRAINT "gathering_deposit_links_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "gathering_deposits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gathering_deposit_links" ADD CONSTRAINT "gathering_deposit_links_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "gathering_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
