import { prisma, pool } from "../db/prisma.js";
import { upsertTender } from "../db/upsert.js";
import type { MunicipalityAdapter } from "../municipalities/types.js";
import { ethekwiniAdapter } from "../municipalities/ethekwini.js";

export interface MunicipalityIngestError {
  url: string | null;
  message: string;
}

export interface MunicipalityIngestResult {
  source: string;
  pages: number;
  durationMs: number;
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: number;
  errorDetails: MunicipalityIngestError[];
}

/** Ensure the municipality row exists in the same runtime database used by ingestion. */
async function ensureMunicipality(adapter: MunicipalityAdapter): Promise<void> {
  const code = adapter.id.trim().toUpperCase();
  if (!code) return;

  await pool.query(
    `INSERT INTO "Municipality" (id, code, name, province, type, "websiteUrl", enabled, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 'LOCAL_MUNICIPALITY', $5, true, NOW(), NOW())
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name,
       province = EXCLUDED.province,
       "websiteUrl" = COALESCE(EXCLUDED."websiteUrl", "Municipality"."websiteUrl"),
       enabled = true,
       "updatedAt" = NOW()` ,
    [`municipality-${code.toLowerCase()}`, code, adapter.name, adapter.province, adapter.sourceUrl],
  );
}

/** Ingest any municipal adapter through the common Tender persistence path. */
export async function runMunicipalityIngest(
  adapter: MunicipalityAdapter,
  opts: { backfill?: boolean } = {},
): Promise<MunicipalityIngestResult> {
  const startedAt = Date.now();
  const run = await prisma.scraperRun.create({
    data: { source: adapter.id, status: "RUNNING", isBackfill: !!opts.backfill },
  });

  try {
    await ensureMunicipality(adapter);
    const res = await adapter.fetchOpenTenders();
    if (!res.tenders.length) throw new Error(`${adapter.name} scraper fetched 0 tenders`);

    const counts = { inserted: 0, updated: 0, unchanged: 0, errors: 0 };
    const errorDetails: MunicipalityIngestError[] = [];

    for (const tender of res.tenders) {
      try {
        const outcome = await upsertTender(tender);
        counts[outcome] += 1;
      } catch (error) {
        counts.errors += 1;
        const message = error instanceof Error ? error.message : String(error);
        const detail = { url: tender.sourceUrl ?? null, message: message.slice(0, 1000) };
        errorDetails.push(detail);
        await prisma.scraperError.create({
          data: { runId: run.id, url: tender.sourceUrl, message: detail.message.slice(0, 500) },
        });
      }
    }

    const durationMs = Date.now() - startedAt;
    await prisma.scraperRun.update({
      where: { id: run.id },
      data: {
        status: counts.errors > 0 ? "ERROR" : "SUCCESS",
        finishedAt: new Date(),
        durationMs,
        pagesFetched: res.pages,
        fetchedCount: res.tenders.length,
        insertedCount: counts.inserted,
        updatedCount: counts.updated,
        unchangedCount: counts.unchanged,
        errorCount: counts.errors,
      },
    });

    return { source: adapter.id, pages: res.pages, durationMs, fetched: res.tenders.length, ...counts, errorDetails };
  } catch (error) {
    await prisma.scraperRun.update({
      where: { id: run.id },
      data: { status: "ERROR", finishedAt: new Date(), durationMs: Date.now() - startedAt },
    });
    throw error;
  }
}

/** Backwards-compatible wrapper while callers migrate to the registry contract. */
export async function runEThekwiniIngest(opts: { backfill?: boolean } = {}): Promise<MunicipalityIngestResult> {
  return runMunicipalityIngest(ethekwiniAdapter, opts);
}
