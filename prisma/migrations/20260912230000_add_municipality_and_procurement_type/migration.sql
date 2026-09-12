-- Add first-class municipality identity and procurement classification.

CREATE TABLE "Municipality" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "province" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'LOCAL_MUNICIPALITY',
  "websiteUrl" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Municipality_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Municipality_code_key" ON "Municipality"("code");
CREATE INDEX "Municipality_province_enabled_idx" ON "Municipality"("province", "enabled");

ALTER TABLE "Tender" ADD COLUMN "procurementType" TEXT NOT NULL DEFAULT 'TENDER';
ALTER TABLE "Tender" ADD COLUMN "municipalityId" TEXT;

CREATE INDEX "Tender_municipalityId_procurementType_idx" ON "Tender"("municipalityId", "procurementType");

ALTER TABLE "Tender"
  ADD CONSTRAINT "Tender_municipalityId_fkey"
  FOREIGN KEY ("municipalityId") REFERENCES "Municipality"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the first municipal identity. Existing eThekwini records are linked to it.
INSERT INTO "Municipality" ("id", "code", "name", "province", "type", "websiteUrl", "enabled", "createdAt", "updatedAt")
VALUES (
  'municipality-ethekwini',
  'ETHEKWINI',
  'eThekwini Municipality',
  'KwaZulu-Natal',
  'METROPOLITAN_MUNICIPALITY',
  'https://www.durban.gov.za',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;

UPDATE "Tender"
SET "municipalityId" = (SELECT "id" FROM "Municipality" WHERE "code" = 'ETHEKWINI')
WHERE "source" = 'ETHEKWINI';
