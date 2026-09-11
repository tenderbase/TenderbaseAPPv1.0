/** One-off live municipality scraper for development and manual backfills. */
import { prisma } from "../db/prisma.js";
import { runEThekwiniIngest } from "../pipeline/municipality.js";

async function main() {
  const result = await runEThekwiniIngest({ backfill: process.argv.includes("--backfill") });
  console.log("\n" + "=".repeat(60));
  console.log("ETHEKWINI INGEST COMPLETE");
  console.log("=".repeat(60));
  console.log(`  pages     : ${result.pages}`);
  console.log(`  fetched   : ${result.fetched}`);
  console.log(`  inserted  : ${result.inserted}`);
  console.log(`  updated   : ${result.updated}`);
  console.log(`  unchanged : ${result.unchanged}`);
  console.log(`  errors    : ${result.errors}`);
  console.log(`  duration  : ${(result.durationMs / 1000).toFixed(1)}s`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
