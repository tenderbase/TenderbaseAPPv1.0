/**
 * Run the matcher and deliver notifications.
 *
 *   npm run notify            # match + dispatch
 *   npm run notify -- --seed  # create a demo filter set + simulate arrivals
 *   npm run notify -- --stats
 */
import { prisma } from "../db/prisma.js";
import { runMatcher } from "../match/matcher.js";
import { dispatchPending } from "../notify/dispatch.js";
import { SEARCH_EXPR } from "../db/search.js";

const flag = (n: string) => process.argv.includes(`--${n}`);

async function seed() {
  const userId = "demo-user";
  console.log("Seeding demo filter set (KwaZulu-Natal + catering)...");

  const fs = await prisma.filterSet.upsert({
    where: { id: "demo-filter-set" },
    update: {},
    create: {
      id: "demo-filter-set",
      userId,
      name: "KZN catering & food service",
      provinces: ["KwaZulu-Natal", "National"],
      categories: ["Food and beverage service activities"],
      // Union with categories: catches "canteen"/"meals"/"caterers" that the
      // category taxonomy misses entirely.
      keywords: ["catering", "canteen", "meals"],
      channels: ["inapp", "push", "email"],
      notifyEmail: process.env.DEMO_EMAIL ?? null,
      expiryLeadDays: 7,
    },
  });

  // Simulate new arrivals: real ingestion happened earlier, so these tenders
  // are older than the filter set and would (correctly) not match. Stamping a
  // fresh firstSeenAt reproduces what the hourly job sees when a tender lands.
  const horizon = new Date();
  const matching = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Tender"
    WHERE "isOpportunity" = true
      AND status = 'active'
      AND province = ANY(ARRAY['KwaZulu-Natal','National'])
      AND (category = ANY(ARRAY['Food and beverage service activities'])
           OR ${SEARCH_EXPR} @@ websearch_to_tsquery('english', 'catering OR canteen OR meals'))
  `;

  if (matching.length) {
    await prisma.tender.updateMany({
      where: { id: { in: matching.map((m) => m.id) } },
      data: { firstSeenAt: horizon },
    });
    // Reset the cursor so the matcher re-considers them.
    await prisma.filterSet.update({
      where: { id: fs.id },
      data: { lastMatchedAt: null, createdAt: new Date(Date.now() - 60_000) },
    });
  }

  console.log(`  filter set: ${fs.name}`);
  console.log(`  simulated ${matching.length} new arrivals (firstSeenAt = now)`);
}

async function stats() {
  const total = await prisma.notification.count();
  const byType = await prisma.notification.groupBy({
    by: ["type"],
    _count: { _all: true },
  });
  const delivered = await prisma.notification.groupBy({
    by: ["type"],
    _count: { _all: true },
    where: { inappSentAt: { not: null } },
  });
  console.log(`  notifications total : ${total}`);
  for (const b of byType) console.log(`    ${b.type.padEnd(12)} ${b._count._all}`);
  console.log(`  delivered (in-app)  : ${delivered.reduce((a, b) => a + b._count._all, 0)}`);
  const sets = await prisma.filterSet.count();
  console.log(`  filter sets         : ${sets}`);
}

async function main() {
  if (flag("seed")) return seed();
  if (flag("stats")) return stats();

  console.log("Matching...");
  const m = await runMatcher();
  console.log(
    `\n  filter sets: ${m.filterSets} | new: +${m.newCreated} | expiring: +${m.expiryCreated} | duplicates skipped: ${m.duplicates}`
  );

  console.log("\nDispatching...");
  const d = await dispatchPending();
  console.log(
    `  processed ${d.processed} | in-app ${d.inapp} | push ${d.push} | email ${d.email}`
  );
  if (d.push === 0 && d.processed > 0) {
    console.log("  (push not sent — VAPID keys not configured)");
  }
  if (d.email === 0 && d.processed > 0) {
    console.log("  (email not sent — RESEND_API_KEY/notifyEmail not configured)");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
