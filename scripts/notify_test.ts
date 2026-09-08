/**
 * Phase 4 acceptance tests for the behaviours that are easy to get wrong and
 * expensive to discover in production.
 *
 *   A. A repeated run must never re-notify.
 *   B. An EXTENDED closing date must re-arm the expiry alert.
 *   C. A newly created filter set must NOT match historical tenders
 *      (otherwise a 1,845-tender backfill emails everyone).
 */
import { prisma } from "../src/db/prisma.js";
import { runMatcher, matchNewTenders } from "../src/match/matcher.js";
import { buildPayload } from "../src/notify/dispatch.js";

let failures = 0;
function assert(label: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

async function main() {
  console.log("=".repeat(70));
  console.log("A. REPEATED RUNS NEVER RE-NOTIFY");
  console.log("=".repeat(70));
  const before = await prisma.notification.count();
  const r1 = await runMatcher();
  const after = await prisma.notification.count();
  assert(
    "second run creates no new notifications",
    after === before,
    `before=${before} after=${after} created=${r1.newCreated + r1.expiryCreated}`
  );

  console.log("\n" + "=".repeat(70));
  console.log("B. EXTENDED CLOSING DATE RE-ARMS THE EXPIRY ALERT");
  console.log("=".repeat(70));
  const exp = await prisma.notification.findFirst({
    where: { type: "expiring" },
    include: { tender: true },
  });
  if (!exp) {
    console.log("  SKIP — no expiring notification present");
  } else {
    const original = exp.tender.closingDate!;
    const expiringBefore = await prisma.notification.count({ where: { type: "expiring" } });

    // Simulate the buyer extending the deadline to 5 days out (inside the
    // 7-day horizon, so it must produce a fresh alert).
    const extended = new Date(Date.now() + 5 * 86_400_000);
    await prisma.tender.update({
      where: { id: exp.tenderId },
      data: { closingDate: extended },
    });

    const res = await runMatcher();
    const expiringAfter = await prisma.notification.count({ where: { type: "expiring" } });
    assert(
      "extension produces a new expiry alert (new dedupe key)",
      expiringAfter === expiringBefore + 1,
      `before=${expiringBefore} after=${expiringAfter}`
    );

    // And it must not keep re-firing once the new deadline is recorded.
    const res2 = await runMatcher();
    const expiringThird = await prisma.notification.count({ where: { type: "expiring" } });
    assert(
      "the re-armed alert does not repeat",
      expiringThird === expiringAfter,
      `after=${expiringAfter} third=${expiringThird} (created ${res2.expiryCreated})`
    );

    console.log("\n   Sample expiry payload:");
    const t = await prisma.tender.findUniqueOrThrow({ where: { id: exp.tenderId } });
    console.log("   ", JSON.stringify(buildPayload(t, "expiring")));

    // Restore
    await prisma.tender.update({
      where: { id: exp.tenderId },
      data: { closingDate: original },
    });
  }

  console.log("\n" + "=".repeat(70));
  console.log("C. BACKFILL GUARD — new filter set must not match history");
  console.log("=".repeat(70));
  const totalTenders = await prisma.tender.count();
  const probe = await prisma.filterSet.create({
    data: {
      userId: "guard-probe",
      name: "backfill guard probe",
      provinces: [],
      categories: [],
      keywords: [],
      isActive: true,
    },
  });
  const probeResult = await matchNewTenders(probe);
  assert(
    `a brand-new filter set matches 0 of ${totalTenders} historical tenders`,
    probeResult.created === 0,
    `created=${probeResult.created}`
  );
  await prisma.filterSet.delete({ where: { id: probe.id } });

  console.log("\n" + "=".repeat(70));
  console.log("D. EXPIRY ALERTS ONLY COVER ACTIVE, REAL OPPORTUNITIES");
  console.log("=".repeat(70));
  const bad = await prisma.$queryRaw<Array<{ id: string; status: string | null; is_op: boolean }>>`
    SELECT n.id, t.status, t."isOpportunity" AS is_op
    FROM "Notification" n
    JOIN "Tender" t ON t.id = n."tenderId"
    WHERE n.type = 'expiring' AND (t.status <> 'active' OR t."isOpportunity" = false)
  `;
  assert("no expiry alert points at a closed or non-opportunity tender", bad.length === 0, `found ${bad.length}`);

  console.log("\n" + "=".repeat(70));
  console.log(failures === 0 ? "ALL PHASE 4 CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  console.log("=".repeat(70));
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
