/**
 * Ingest tenders into Postgres (one-off / manual entrypoint).
 *
 *   npm run ingest                       # replay the cached fixtures
 *   npm run ingest -- --live             # fetch fresh from the OCDS API
 *   npm run ingest -- --live --days 7
 *   npm run ingest -- --backfill --live  # 31-day initial backfill
 *
 * The hourly job uses `src/cli/hourly.ts`, which calls the same `runIngest`.
 */
import { prisma } from "../db/prisma.js";
import { runIngest } from "../pipeline/ingest.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const flag = (n: string) => process.argv.includes(`--${n}`);

async function main() {
  const live = flag("live");
  const backfill = flag("backfill");
  const days = Number(arg("days", "31"));

  const r = await runIngest({ live, backfill, days });

  console.log("\n" + "=".repeat(60));
  console.log("INGEST COMPLETE");
  console.log("=".repeat(60));
  console.log(`  fetched   : ${r.fetched}${live ? ` (${r.pages} pages)` : ""}`);
  console.log(`  inserted  : ${r.inserted}`);
  console.log(`  updated   : ${r.updated}`);
  console.log(
    `  unchanged : ${r.unchanged}   <-- second run should be all of them`
  );
  console.log(`  errors    : ${r.errors}`);
  console.log(`  duration  : ${(r.durationMs / 1000).toFixed(1)}s`);

  const total = await prisma.tender.count();
  const docs = await prisma.tenderDocument.count();
  console.log(`\n  DB now holds ${total} tenders / ${docs} documents`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
