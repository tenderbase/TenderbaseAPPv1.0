-- CreateTable
CREATE TABLE "Tender" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'OCDS',
    "sourceUrl" TEXT NOT NULL,
    "ocid" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "tenderNumber" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "organisation" TEXT,
    "category" TEXT,
    "province" TEXT,
    "location" TEXT,
    "valueCents" BIGINT,
    "publishedDate" TIMESTAMP(3),
    "closingDate" TIMESTAMP(3),
    "status" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "cidbGrade" TEXT,
    "cidbGradeRaw" TEXT,
    "isOpportunity" BOOLEAN NOT NULL DEFAULT true,
    "contentHash" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderDocument" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "name" TEXT,
    "url" TEXT NOT NULL,
    "fileType" TEXT,
    "isAddendum" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TenderDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScraperRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'OCDS',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "isBackfill" BOOLEAN NOT NULL DEFAULT false,
    "dateFrom" TIMESTAMP(3),
    "dateTo" TIMESTAMP(3),
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "fetchedCount" INTEGER NOT NULL DEFAULT 0,
    "insertedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "ScraperRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScraperError" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "url" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScraperError_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tender_province_category_idx" ON "Tender"("province", "category");

-- CreateIndex
CREATE INDEX "Tender_closingDate_idx" ON "Tender"("closingDate");

-- CreateIndex
CREATE INDEX "Tender_publishedDate_idx" ON "Tender"("publishedDate");

-- CreateIndex
CREATE INDEX "Tender_status_idx" ON "Tender"("status");

-- CreateIndex
CREATE INDEX "Tender_firstSeenAt_idx" ON "Tender"("firstSeenAt");

-- CreateIndex
CREATE INDEX "Tender_isOpportunity_status_closingDate_idx" ON "Tender"("isOpportunity", "status", "closingDate");

-- CreateIndex
CREATE UNIQUE INDEX "Tender_source_ocid_releaseId_key" ON "Tender"("source", "ocid", "releaseId");

-- CreateIndex
CREATE INDEX "TenderDocument_tenderId_idx" ON "TenderDocument"("tenderId");

-- CreateIndex
CREATE INDEX "ScraperRun_startedAt_idx" ON "ScraperRun"("startedAt");

-- CreateIndex
CREATE INDEX "ScraperError_runId_idx" ON "ScraperError"("runId");

-- AddForeignKey
ALTER TABLE "TenderDocument" ADD CONSTRAINT "TenderDocument_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScraperError" ADD CONSTRAINT "ScraperError_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ScraperRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
