-- Additive only: existing rows stay nullable so current members are not backfilled.
CREATE TYPE "GatheringSex" AS ENUM ('MALE', 'FEMALE');

ALTER TABLE "gathering_profiles"
  ADD COLUMN "birthDate" DATE,
  ADD COLUMN "sex" "GatheringSex";

ALTER TABLE "gathering_memberships"
  ADD COLUMN "manualBirthDate" DATE,
  ADD COLUMN "manualSex" "GatheringSex";
