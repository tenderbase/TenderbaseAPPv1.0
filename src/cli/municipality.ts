/** Municipality ingestion runner. Defaults to every registered adapter; use --municipality=CODE to target one. */
import { prisma } from "../db/prisma.js";
import { getMunicipalityAdapter, listMunicipalityAdapters } from "../municipalities/registry.js";
import { runMunicipalityIngest } from "../pipeline/municipality.js";

function requestedCode(): string | undefined {
  const arg = process.argv.find((value) => value.startsWith("--municipality="));
  return arg?.split("=", 2)[1]?.trim() || undefined;
}

async function main() {
  const backfill = process.argv.includes("--backfill");
  const code = requestedCode();
  const adapters = code
    ? [getMunicipalityAdapter(code)].filter((adapter): adapter is NonNullable<typeof adapter> => Boolean(adapter))
    : listMunicipalityAdapters();

  if (!adapters.length) {
    throw new Error(code ? `No municipality adapter registered for ${code}` : "No municipality adapters are registered");
  }

  let failed = 0;
  for (const adapter of adapters) {
    console.log("\n" + "=".repeat(60));
    console.log(`${adapter.id} INGEST START`);
    console.log("=".repeat(60));

    try {
      const result = await runMunicipalityIngest(adapter, { backfill });
      console.log(`  pages     : ${result.pages}`);
      console.log(`  fetched   : ${result.fetched}`);
      console.log(`  inserted  : ${result.inserted}`);
      console.log(`  updated   : ${result.updated}`);
      console.log(`  unchanged : ${result.unchanged}`);
      console.log(`  errors    : ${result.errors}`);
      console.log(`  duration  : ${(result.durationMs / 1000).toFixed(1)}s`);
    } catch (error) {
      failed += 1;
      console.error(`${adapter.id} INGEST FAILED:`, error);
    }
  }

  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
