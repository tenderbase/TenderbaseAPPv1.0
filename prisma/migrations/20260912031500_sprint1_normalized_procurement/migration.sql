-- Sprint 1: normalized Neon procurement foundation.
-- Existing Tender/Scraper tables remain compatible with the live app.

CREATE TABLE "Province" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Province_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Province_code_key" ON "Province"("code");
CREATE UNIQUE INDEX "Province_name_key" ON "Province"("name");
CREATE INDEX "Province_name_idx" ON "Province"("name");

CREATE TABLE "Organization" (
  "id" TEXT NOT NULL,
  "externalId" TEXT,
  "name" TEXT NOT NULL,
  "organizationType" TEXT,
  "provinceId" TEXT,
  "municipalityId" TEXT,
  "websiteUrl" TEXT,
  "source" TEXT NOT NULL DEFAULT 'OCDS',
  "rawData" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Organization_name_idx" ON "Organization"("name");
CREATE INDEX "Organization_externalId_idx" ON "Organization"("externalId");
CREATE INDEX "Organization_provinceId_idx" ON "Organization"("provinceId");
CREATE INDEX "Organization_municipalityId_idx" ON "Organization"("municipalityId");
CREATE UNIQUE INDEX "organization_source_externalId" ON "Organization"("source", "externalId");
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "Province"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_municipalityId_fkey" FOREIGN KEY ("municipalityId") REFERENCES "Municipality"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Tender" ADD COLUMN "buyerOrganizationId" TEXT;
CREATE INDEX "Tender_buyerOrganizationId_idx" ON "Tender"("buyerOrganizationId");
ALTER TABLE "Tender" ADD CONSTRAINT "Tender_buyerOrganizationId_fkey" FOREIGN KEY ("buyerOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TenderAward" (
  "id" TEXT NOT NULL,
  "tenderId" TEXT NOT NULL,
  "supplierOrgId" TEXT,
  "awardId" TEXT,
  "status" TEXT,
  "amountCents" BIGINT,
  "currency" TEXT DEFAULT 'ZAR',
  "awardedAt" TIMESTAMP(3),
  "rawData" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenderAward_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tender_award_identity" ON "TenderAward"("tenderId", "awardId");
CREATE INDEX "TenderAward_supplierOrgId_idx" ON "TenderAward"("supplierOrgId");
CREATE INDEX "TenderAward_awardedAt_idx" ON "TenderAward"("awardedAt");
ALTER TABLE "TenderAward" ADD CONSTRAINT "TenderAward_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenderAward" ADD CONSTRAINT "TenderAward_supplierOrgId_fkey" FOREIGN KEY ("supplierOrgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TenderCancellation" (
  "id" TEXT NOT NULL,
  "tenderId" TEXT NOT NULL,
  "reason" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "rawData" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenderCancellation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TenderCancellation_tenderId_idx" ON "TenderCancellation"("tenderId");
CREATE INDEX "TenderCancellation_cancelledAt_idx" ON "TenderCancellation"("cancelledAt");
ALTER TABLE "TenderCancellation" ADD CONSTRAINT "TenderCancellation_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TenderChange" (
  "id" TEXT NOT NULL,
  "tenderId" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "changeType" TEXT NOT NULL,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "contentHash" TEXT,
  "summary" TEXT,
  "rawData" JSONB,
  CONSTRAINT "TenderChange_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tender_change_identity" ON "TenderChange"("tenderId", "releaseId", "changeType");
CREATE INDEX "TenderChange_tenderId_changedAt_idx" ON "TenderChange"("tenderId", "changedAt");
ALTER TABLE "TenderChange" ADD CONSTRAINT "TenderChange_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RawTenderData" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'OCDS',
  "ocid" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "contentHash" TEXT NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "httpStatus" INTEGER,
  "tenderId" TEXT,
  CONSTRAINT "RawTenderData_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "raw_source_ocid_releaseId" ON "RawTenderData"("source", "ocid", "releaseId");
CREATE INDEX "RawTenderData_ocid_idx" ON "RawTenderData"("ocid");
CREATE INDEX "RawTenderData_fetchedAt_idx" ON "RawTenderData"("fetchedAt");
CREATE INDEX "RawTenderData_tenderId_idx" ON "RawTenderData"("tenderId");
ALTER TABLE "RawTenderData" ADD CONSTRAINT "RawTenderData_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "IngestionRun" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'OCDS',
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "isBackfill" BOOLEAN NOT NULL DEFAULT false,
  "dateFrom" TIMESTAMP(3),
  "dateTo" TIMESTAMP(3),
  "cursor" TEXT,
  "pagesFetched" INTEGER NOT NULL DEFAULT 0,
  "fetchedCount" INTEGER NOT NULL DEFAULT 0,
  "insertedCount" INTEGER NOT NULL DEFAULT 0,
  "updatedCount" INTEGER NOT NULL DEFAULT 0,
  "unchangedCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "lastReleaseAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  CONSTRAINT "IngestionRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IngestionRun_source_status_startedAt_idx" ON "IngestionRun"("source", "status", "startedAt");
CREATE INDEX "IngestionRun_lastReleaseAt_idx" ON "IngestionRun"("lastReleaseAt");

CREATE TABLE "IngestionError" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "ocid" TEXT,
  "releaseId" TEXT,
  "url" TEXT,
  "message" TEXT NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IngestionError_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IngestionError_runId_idx" ON "IngestionError"("runId");
CREATE INDEX "IngestionError_createdAt_idx" ON "IngestionError"("createdAt");
ALTER TABLE "IngestionError" ADD CONSTRAINT "IngestionError_runId_fkey" FOREIGN KEY ("runId") REFERENCES "IngestionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
