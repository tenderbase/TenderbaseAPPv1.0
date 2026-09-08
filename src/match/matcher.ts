import { Prisma, type FilterSet } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { SEARCH_EXPR } from "../db/search.js";
import { buildDedupeKey } from "../notify/dedupe.js";

export interface MatchStats {
  matched: number;
  created: number;
  duplicates: number;
}

/**
 * Build the WHERE clause for a filter set.
 *
 * Match rule:
 *   province                -> hard filter (AND)
 *   category OR keywords    -> union (OR)
 *
 * The union is deliberate. Measured on real data, for food/catering:
 * category alone found 42, keyword alone 38, union 54 (+28.6%). Neither signal
 * covers everything, so requiring both would silently hide opportunities.
 */
export function buildMatchConditions(fs: FilterSet, extra: Prisma.Sql[] = []): Prisma.Sql {
  const conds: Prisma.Sql[] = [
    // Never alert on "Regret Letter"/cancellation entries, or closed tenders.
    Prisma.sql`"isOpportunity" = true`,
    Prisma.sql`status = 'active'`,
    ...extra,
  ];

  if (fs.provinces.length) {
    conds.push(Prisma.sql`province = ANY(${fs.provinces}::text[])`);
  }

  const cat = fs.categories.length
    ? Prisma.sql`category = ANY(${fs.categories}::text[])`
    : null;
  const kw = fs.keywords.length
    ? Prisma.sql`${SEARCH_EXPR} @@ websearch_to_tsquery('english', ${fs.keywords.join(" OR ")})`
    : null;

  if (cat && kw) conds.push(Prisma.sql`(${cat} OR ${kw})`);
  else if (cat) conds.push(cat);
  else if (kw) conds.push(kw);
  // Neither set -> matches everything (within the province filter, if any).

  return Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}`;
}

/**
 * Find tenders new to this filter set and create `new_match` notifications.
 *
 * Only scans tenders with firstSeenAt > cursor (~6-10 per hour), not the whole
 * table — that's what keeps this cheap as the dataset grows.
 */
export async function matchNewTenders(fs: FilterSet): Promise<MatchStats> {
  if (!fs.notifyNewMatch) return { matched: 0, created: 0, duplicates: 0 };

  // The cursor IS the backfill guard: a filter set never sees tenders that
  // were first ingested before it existed.
  const since = fs.lastMatchedAt ?? fs.createdAt;
  const where = buildMatchConditions(fs, [Prisma.sql`"firstSeenAt" > ${since}`]);

  const rows = await prisma.$queryRaw<Array<{ id: string; firstSeenAt: Date }>>`
    SELECT id, "firstSeenAt" FROM "Tender" ${where}
  `;
  if (!rows.length) return { matched: 0, created: 0, duplicates: 0 };

  const res = await prisma.notification.createMany({
    data: rows.map((r) => ({
      dedupeKey: buildDedupeKey({
        filterSetId: fs.id,
        tenderId: r.id,
        type: "new_match",
      }),
      filterSetId: fs.id,
      tenderId: r.id,
      userId: fs.userId,
      type: "new_match",
    })),
    skipDuplicates: true,
  });

  // Advance to the newest firstSeenAt we actually processed — NOT now() — so
  // tenders ingested mid-run are never skipped.
  const newest = rows.reduce(
    (acc, r) => (r.firstSeenAt > acc ? r.firstSeenAt : acc),
    rows[0]!.firstSeenAt
  );
  await prisma.filterSet.update({
    where: { id: fs.id },
    data: { lastMatchedAt: newest },
  });

  return {
    matched: rows.length,
    created: res.count,
    duplicates: rows.length - res.count,
  };
}

/**
 * Create `expiring` alerts for tenders closing within the filter set's lead time.
 *
 * Deliberately limited to tenders the user has ALREADY been alerted about
 * (a `new_match` exists). Two reasons:
 *   1. No alert burst when a filter set is created against existing data.
 *   2. Logically consistent — "you were told about this; it's about to close".
 */
export async function matchExpiring(fs: FilterSet): Promise<MatchStats> {
  if (!fs.notifyExpiring) return { matched: 0, created: 0, duplicates: 0 };

  const horizon = new Date(Date.now() + fs.expiryLeadDays * 86_400_000);

  const rows = await prisma.$queryRaw<Array<{ id: string; closingDate: Date }>>`
    SELECT t.id, t."closingDate"
    FROM "Tender" t
    JOIN "Notification" n ON n."tenderId" = t.id
    WHERE n."filterSetId" = ${fs.id}
      AND n.type = 'new_match'
      AND t."isOpportunity" = true
      AND t.status = 'active'
      AND t."closingDate" > now()
      AND t."closingDate" <= ${horizon}
  `;
  if (!rows.length) return { matched: 0, created: 0, duplicates: 0 };

  const res = await prisma.notification.createMany({
    data: rows.map((r) => ({
      dedupeKey: buildDedupeKey({
        filterSetId: fs.id,
        tenderId: r.id,
        type: "expiring",
        closingDate: r.closingDate,
      }),
      filterSetId: fs.id,
      tenderId: r.id,
      userId: fs.userId,
      type: "expiring",
      closingDate: r.closingDate,
    })),
    skipDuplicates: true,
  });

  return {
    matched: rows.length,
    created: res.count,
    duplicates: rows.length - res.count,
  };
}

export async function runMatcher() {
  const sets = await prisma.filterSet.findMany({ where: { isActive: true } });
  const totals = { newCreated: 0, expiryCreated: 0, duplicates: 0 };
  for (const fs of sets) {
    const n = await matchNewTenders(fs);
    const e = await matchExpiring(fs);
    totals.newCreated += n.created;
    totals.expiryCreated += e.created;
    totals.duplicates += n.duplicates + e.duplicates;
    console.log(
      `  ${fs.name.padEnd(28)} new:+${n.created} (${n.matched} matched)  expiring:+${e.created} (${e.matched} in window)`
    );
  }
  return { filterSets: sets.length, ...totals };
}
