-- AlterEnum
ALTER TYPE "GatheringHandoverStatus" ADD VALUE 'CONFIRMED';

-- AlterTable
ALTER TABLE "gathering_handovers" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "gathering_handovers" ADD COLUMN "confirmHash" TEXT;

-- 취소된 인계만 같은 회계연도에 다시 만들 수 있다.
CREATE UNIQUE INDEX "gathering_handovers_one_active_year"
ON "gathering_handovers" ("financeYearId")
WHERE status <> 'CANCELLED';
