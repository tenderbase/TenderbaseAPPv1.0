/**
 * The core product loop. GitHub Actions runs this once an hour at :17 UTC.
 *
 *   1. INGEST  — pull the rolling 7-day window from the live OCDS API.
 *                Upserts; skips the write when the content hash is unchanged.
 *   2. MATCH   — only consider tenders first seen since this filter set's
 *                cursor (~6-10/hour, not all 1,800+).
 *   3. DISPATCH — in-app + web push + email.
 *
 * Every stage is idempotent, so a re-run inside the same hour is harmless:
 * ingest writes nothing the second time, and the dedupe keys stop the matcher
 * from queueing the same alert twice.
 *
 *   npm run hourly                     # ingest + match + dispatch
 *   npm run hourly -- --match-only     # skip the network, just match/dispatch
 *   npm run hourly -- --days 14        # widen the ingest window
 */
import { prisma } from "../db/prisma.js";
import { runIngest } from "../pipeline/ingest.js";
import { runMatcher } from "../match/matcher.js";
import { dispatchPending } from "../notify/dispatch.js";
import { ROLLING_WINDOW_DAYS } from "../config.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const flag = (n: string) => process.argv.includes(`--${n}`);

const stamp = () => new Date().toISOString();

async function main() {
  const startedAt = Date.now();
  const matchOnly = flag("match-only");
  const days = Number(
    arg("days", String(process.env.INGEST_WINDOW_DAYS ?? ROLLING_WINDOW_DAYS))
  );

  console.log("=".repeat(64));
  console.log(`TenderBase hourly run — ${stamp()}`);
  console.log("=".repeat(64));

  // ---------------------------------------------------------------- 1. ingest
  let ingested = null as null | Awaited<ReturnType<typeof runIngest>>;
  if (matchOnly) {
    console.log("[1/3] ingest SKIPPED (--match-only)");
  } else {
    console.log(`[1/3] ingest  rolling ${days}-day window`);
    ingested = await runIngest({ live: true, days });
    console.log(
      `      fetched ${ingested.fetched} | inserted ${ingested.inserted} | ` +
        `updated ${ingested.updated} | unchanged ${ingested.unchanged} | ` +
        `errors ${ingested.errors} (${(ingested.durationMs / 1000).toFixed(1)}s)`
    );
  }

  // ----------------------------------------------------------------- 2. match
  console.log("[2/3] match   new arrivals + expiring soon");
  const m = await runMatcher();
  console.log(
    `      filter sets ${m.filterSets} | new +${m.newCreated} | ` +
      `expiring +${m.expiryCreated} | duplicates skipped ${m.duplicates}`
  );

  // -------------------------------------------------------------- 3. dispatch
  console.log("[3/3] dispatch in-app + push + email");
  const d = await dispatchPending();
  console.log(
    `      processed ${d.processed} | in-app ${d.inapp} | ` +
      `push ${d.push} | email ${d.email}`
  );

  // Honest diagnostics: an unconfigured channel is a config gap, not a success.
  if (d.processed > 0 && d.push === 0) {
    console.log("      note: push sent 0 — VAPID keys not configured");
  }
  if (d.processed > 0 && d.email === 0) {
    console.log("      note: email sent 0 — RESEND_API_KEY / notifyEmail not set");
  }

  const total = await prisma.tender.count();
  console.log(
    `\nDone in ${((Date.now() - startedAt) / 1000).toFixed(1)}s — ` +
      `${total} tenders in DB`
  );

  // A window that silently returns nothing is worth failing loudly on: it
  // usually means the upstream API changed shape or started erroring.
  if (ingested && ingested.fetched === 0) {
    throw new Error("ingest fetched 0 releases — upstream source looks broken");
  }
}

main()
  .catch((e) => {
    console.error(`\nHOURLY RUN FAILED: ${e}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
