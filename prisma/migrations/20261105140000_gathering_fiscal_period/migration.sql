-- AlterTable
ALTER TABLE "gathering_groups" ADD COLUMN "fiscalStartMonth" INTEGER NOT NULL DEFAULT 12;
ALTER TABLE "gathering_groups" ADD COLUMN "fiscalStartDay" INTEGER NOT NULL DEFAULT 24;
