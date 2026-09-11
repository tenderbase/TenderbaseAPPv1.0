import { prisma } from "../db/prisma.js";
import { upsertTender } from "../db/upsert.js";
import { fetchEThekwiniOpenTenders } from "../sources/ethekwini.js";

export interface MunicipalityIngestResult {
  source: string;
  fetched: number;
  pages: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: number;
  durationMs: number;
}

/** Ingest eThekwini's public open procurement notices into the common Tender schema. */
export async function runEThekwiniIngest(opts: { backfill?: boolean } = {}): Promise<MunicipalityIngestResult> {
  const startedAt = Date.now();
  const run = await prisma.scraperRun.create({
    data: { source: "ETHEKWINI", status: "RUNNING", isBackfill: !!opts.backfill },
  });

  try {
    const res = await fetchEThekwiniOpenTenders();
    if (!res.tenders.length) throw new Error("eThekwini scraper fetched 0 tenders");

    const counts = { inserted: 0, updated: 0, unchanged: 0, errors: 0 };
    for (const tender of res.tenders) {
      try {
        const outcome = await upsertTender(tender);
        counts[outcome] += 1;
      } catch (error) {
        counts.errors += 1;
        await prisma.scraperError.create({
          data: {
            runId: run.id,
            url: tender.sourceUrl,
            message: String(error).slice(0, 500),
          },
        });
      }
    }

    const durationMs = Date.now() - startedAt;
    await prisma.scraperRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
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

    return { source: "ETHEKWINI", pages: res.pages, durationMs, fetched: res.tenders.length, ...counts };
  } catch (error) {
    await prisma.scraperRun.update({
      where: { id: run.id },
      data: { status: "ERROR", finishedAt: new Date(), durationMs: Date.now() - startedAt },
    });
    throw error;
  }
}
