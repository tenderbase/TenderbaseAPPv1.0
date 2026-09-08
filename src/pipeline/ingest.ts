/**
 * Ingest pipeline: fetch -> normalise -> upsert.
 *
 * Extracted from the CLI so the hourly cron job and the one-off backfill run
 * through exactly one code path.
 *
 * Idempotent by design: run it twice and the second pass writes nothing,
 * because `upsertTender` skips the write when the content hash is unchanged.
 *
 * NOTE: this deliberately does **not** disconnect the Prisma client — the
 * hourly job keeps using it for matching and dispatch afterwards. Callers own
 * the lifecycle; the CLI wrappers call `prisma.$disconnect()`.
 */
import { prisma } from "../db/prisma.js";
import { upsertTender } from "../db/upsert.js";
import { normaliseRelease } from "../normalise.js";
import { loadFixtures, fetchWindow } from "../load.js";
import type { OcdsRelease } from "../sources/ocds.js";

export interface IngestOptions {
  /** Fetch from the live OCDS API. When false, replay the cached fixtures. */
  live: boolean;
  /** How many days back to fetch. Ignored when `live` is false. */
  days: number;
  /** Recorded on the ScraperRun row so backfills stay distinguishable. */
  backfill?: boolean;
}

export interface IngestResult {
  fetched: number;
  pages: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: number;
  durationMs: number;
}

export async function runIngest(opts: IngestOptions): Promise<IngestResult> {
  const startedAt = Date.now();

  const run = await prisma.scraperRun.create({
    data: { source: "OCDS", status: "RUNNING", isBackfill: !!opts.backfill },
  });

  try {
    let releases: OcdsRelease[];
    let pages = 0;

    if (opts.live) {
      console.log(`Fetching live ${opts.days}-day window from the OCDS API...`);
      const res = await fetchWindow(opts.days);
      releases = res.releases;
      pages = res.pages;
    } else {
      console.log("Loading cached fixtures (no network)...");
      releases = loadFixtures();
    }

    if (!releases.length) throw new Error("No releases to ingest");

    const counts = { inserted: 0, updated: 0, unchanged: 0, errors: 0 };

    for (const raw of releases) {
      try {
        const t = normaliseRelease(raw);
        if (!t.ocid || !t.tenderNumber) continue;
        const outcome = await upsertTender(t);
        counts[outcome] += 1;
      } catch (err) {
        counts.errors += 1;
        await prisma.scraperError.create({
          data: {
            runId: run.id,
            url: String((raw as any)?.ocid ?? ""),
            message: String(err).slice(0, 500),
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
        pagesFetched: pages,
        fetchedCount: releases.length,
        insertedCount: counts.inserted,
        updatedCount: counts.updated,
        unchangedCount: counts.unchanged,
        errorCount: counts.errors,
      },
    });

    return { fetched: releases.length, pages, durationMs, ...counts };
  } catch (err) {
    await prisma.scraperRun.update({
      where: { id: run.id },
      data: {
        status: "ERROR",
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
      },
    });
    throw err;
  }
}
