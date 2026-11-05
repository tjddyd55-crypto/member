-- AlterTable
ALTER TABLE "gathering_subscriptions" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "gathering_subscriptions_idempotencyKey_key" ON "gathering_subscriptions"("idempotencyKey");
