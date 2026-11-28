-- AlterTable
ALTER TABLE "Local" ADD COLUMN     "serviceEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "serviceEnabledAt" TIMESTAMP(3);
