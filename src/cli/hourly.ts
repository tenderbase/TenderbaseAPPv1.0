/**
 * The core product loop. GitHub Actions runs this once an hour at :17 UTC.
 *
 * 1. INGEST national/provincial eTenders OCDS data.
 * 2. INGEST municipality sources (currently eThekwini).
 * 3. MATCH + DISPATCH notifications.
 *
 * Every stage is idempotent. Municipality records use their own source key so
 * they never collide with OCDS releases.
 */
import { prisma } from "../db/prisma.js";
import { runIngest } from "../pipeline/ingest.js";
import { runEThekwiniIngest } from "../pipeline/municipality.js";
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
  const days = Number(arg("days", String(process.env.INGEST_WINDOW_DAYS ?? ROLLING_WINDOW_DAYS)));

  console.log("=".repeat(64));
  console.log(`TenderBase hourly run — ${stamp()}`);
  console.log("=".repeat(64));

  let national = null as null | Awaited<ReturnType<typeof runIngest>>;
  let municipal = null as null | Awaited<ReturnType<typeof runEThekwiniIngest>>;

  if (matchOnly) {
    console.log("[1/4] national ingest SKIPPED (--match-only)");
    console.log("[2/4] municipality ingest SKIPPED (--match-only)");
  } else {
    console.log(`[1/4] national ingest — rolling ${days}-day window`);
    national = await runIngest({ live: true, days });
    console.log(`      fetched ${national.fetched} | inserted ${national.inserted} | updated ${national.updated} | unchanged ${national.unchanged} | errors ${national.errors}`);

    console.log("[2/4] municipality ingest — eThekwini open tenders");
    municipal = await runEThekwiniIngest();
    console.log(`      fetched ${municipal.fetched} | inserted ${municipal.inserted} | updated ${municipal.updated} | unchanged ${municipal.unchanged} | errors ${municipal.errors} (${(municipal.durationMs / 1000).toFixed(1)}s)`);
  }

  console.log("[3/4] match   new arrivals + expiring soon");
  const m = await runMatcher();
  console.log(`      filter sets ${m.filterSets} | new +${m.newCreated} | expiring +${m.expiryCreated} | duplicates skipped ${m.duplicates}`);

  console.log("[4/4] dispatch in-app + push + email");
  const d = await dispatchPending();
  console.log(`      processed ${d.processed} | in-app ${d.inapp} | push ${d.push} | email ${d.email}`);

  if (d.processed > 0 && d.push === 0) console.log("      note: push sent 0 — VAPID keys not configured");
  if (d.processed > 0 && d.email === 0) console.log("      note: email sent 0 — RESEND_API_KEY / notifyEmail not set");

  const total = await prisma.tender.count();
  console.log(`\nDone in ${((Date.now() - startedAt) / 1000).toFixed(1)}s — ${total} tenders in DB`);

  if (national && national.fetched === 0) throw new Error("national ingest fetched 0 releases — upstream source looks broken");
  if (municipal && municipal.fetched === 0) throw new Error("eThekwini ingest fetched 0 tenders — municipal source looks broken");
}

main()
  .catch((e) => {
    console.error(`\nHOURLY RUN FAILED: ${e}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
