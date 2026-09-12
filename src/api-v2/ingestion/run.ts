import type pg from "pg";
import { fetchOcdsPage } from "./client.js";
import { normalizeRelease } from "./ocds.js";
import { persistBatch } from "./persist.js";

export type IngestionRunSummary = {
  runId: string;
  pages: number;
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: number;
  status: "completed" | "failed";
};

async function ensureTables(pool: pg.Pool): Promise<void> {
  await pool.query(`
    create table if not exists "V2IngestionRun" (
      id text primary key,
      source text not null,
      "startedAt" timestamptz not null default now(),
      "finishedAt" timestamptz,
      status text not null,
      pages integer not null default 0,
      fetched integer not null default 0,
      inserted integer not null default 0,
      updated integer not null default 0,
      unchanged integer not null default 0,
      errors integer not null default 0,
      "lastUrl" text
    );
    create table if not exists "V2RawRelease" (
      id text primary key,
      "runId" text references "V2IngestionRun"(id) on delete set null,
      source text not null,
      ocid text not null,
      "releaseId" text not null,
      "contentHash" text not null,
      payload jsonb not null,
      "createdAt" timestamptz not null default now(),
      unique (source, ocid, "releaseId")
    );
    create table if not exists "V2IngestionError" (
      id text primary key,
      "runId" text references "V2IngestionRun"(id) on delete cascade,
      url text,
      ocid text,
      "releaseId" text,
      message text not null,
      "createdAt" timestamptz not null default now()
    );
    create index if not exists "V2IngestionRun_startedAt_idx" on "V2IngestionRun"("startedAt" desc);
    create index if not exists "V2IngestionError_runId_idx" on "V2IngestionError"("runId");
  `);
}

function id(): string {
  return crypto.randomUUID();
}

async function hash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function storeRaw(pool: pg.Pool, runId: string, tender: ReturnType<typeof normalizeRelease>): Promise<void> {
  const contentHash = await hash(tender.raw);
  await pool.query(
    `insert into "V2RawRelease" (id,"runId",source,ocid,"releaseId","contentHash",payload)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb)
     on conflict (source,ocid,"releaseId") do update set
       "runId"=excluded."runId", "contentHash"=excluded."contentHash", payload=excluded.payload`,
    [id(), runId, tender.source, tender.ocid, tender.releaseId, contentHash, JSON.stringify(tender.raw)],
  );
}

export async function runOcdsIngestion(
  pool: pg.Pool,
  startUrl: string,
  maxPages = 100,
): Promise<IngestionRunSummary> {
  await ensureTables(pool);
  const runId = id();
  await pool.query(
    `insert into "V2IngestionRun" (id,source,status) values ($1,$2,$3)`,
    [runId, "OCDS", "running"],
  );

  const summary: IngestionRunSummary = {
    runId, pages: 0, fetched: 0, inserted: 0, updated: 0, unchanged: 0, errors: 0, status: "completed",
  };

  try {
    let nextUrl: string | undefined = startUrl;
    while (nextUrl && summary.pages < Math.max(1, maxPages)) {
      await pool.query(`update "V2IngestionRun" set "lastUrl"=$1 where id=$2`, [nextUrl, runId]);
      let page;
      try {
        page = await fetchOcdsPage(nextUrl);
      } catch (error) {
        summary.errors++;
        await pool.query(
          `insert into "V2IngestionError" (id,"runId",url,message) values ($1,$2,$3,$4)`,
          [id(), runId, nextUrl, error instanceof Error ? error.message : String(error)],
        );
        throw error;
      }

      summary.pages++;
      summary.fetched += page.records.length;
      const normalized = [];
      for (const record of page.records) {
        try {
          normalized.push(normalizeRelease(record, page.url));
        } catch (error) {
          summary.errors++;
          await pool.query(
            `insert into "V2IngestionError" (id,"runId",url,message) values ($1,$2,$3,$4)`,
            [id(), runId, page.url, error instanceof Error ? error.message : String(error)],
          );
        }
      }

      for (const tender of normalized) {
        try {
          await storeRaw(pool, runId, tender);
          const stats = await persistBatch(pool, [tender]);
          summary.inserted += stats.inserted;
          summary.updated += stats.updated;
          summary.unchanged += stats.unchanged;
        } catch (error) {
          summary.errors++;
          await pool.query(
            `insert into "V2IngestionError" (id,"runId",url,ocid,"releaseId",message) values ($1,$2,$3,$4,$5,$6)`,
            [id(), runId, page.url, tender.ocid, tender.releaseId, error instanceof Error ? error.message : String(error)],
          );
        }
      }
      nextUrl = page.nextUrl;
    }
  } catch {
    summary.status = "failed";
  }

  await pool.query(
    `update "V2IngestionRun" set "finishedAt"=now(),status=$1,pages=$2,fetched=$3,inserted=$4,updated=$5,unchanged=$6,errors=$7 where id=$8`,
    [summary.status, summary.pages, summary.fetched, summary.inserted, summary.updated, summary.unchanged, summary.errors, runId],
  );
  return summary;
}
