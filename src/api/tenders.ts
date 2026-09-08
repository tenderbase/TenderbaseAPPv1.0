import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { SEARCH_EXPR } from "../db/search.js";

export interface ListParams {
  page: number;
  limit: number;
  q?: string;
  province?: string;
  category?: string;
  status?: string;
  closingBefore?: Date;
  constructionOnly?: boolean;
  sort: "latest" | "closing";
}

// Categories the product treats as "construction".
const CONSTRUCTION_CATEGORIES = [
  "Construction",
  "Civil engineering",
  "Construction of buildings",
];

interface RawTender {
  id: string;
  tenderNumber: string;
  title: string | null;
  description: string | null;
  organisation: string | null;
  category: string | null;
  province: string | null;
  location: string | null;
  valueCents: bigint | null;
  publishedDate: Date | null;
  closingDate: Date | null;
  sourceUrl: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: string | null;
}

function buildWhere(p: ListParams): Prisma.Sql {
  const conds: Prisma.Sql[] = [
    // Never surface "Regret Letter" / cancellation notices as opportunities.
    Prisma.sql`"isOpportunity" = true`,
  ];
  if (p.province) conds.push(Prisma.sql`"province" = ${p.province}`);
  if (p.category) conds.push(Prisma.sql`"category" = ${p.category}`);
  if (p.status) conds.push(Prisma.sql`"status" = ${p.status}`);
  if (p.q) conds.push(Prisma.sql`${SEARCH_EXPR} @@ websearch_to_tsquery('english', ${p.q})`);
  if (p.closingBefore) conds.push(Prisma.sql`"closingDate" <= ${p.closingBefore}`);
  if (p.constructionOnly) {
    conds.push(Prisma.sql`"category" = ANY(${CONSTRUCTION_CATEGORIES}::text[])`);
  }
  return Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}`;
}

export async function listTenders(p: ListParams) {
  const where = buildWhere(p);
  const offset = (p.page - 1) * p.limit;

  const order =
    p.sort === "closing"
      ? Prisma.sql`ORDER BY "closingDate" ASC NULLS LAST`
      : Prisma.sql`ORDER BY "publishedDate" DESC NULLS LAST, "firstSeenAt" DESC`;

  const rows = await prisma.$queryRaw<RawTender[]>`
    SELECT id, "tenderNumber", title, description, organisation, category,
           province, location, "valueCents", "publishedDate", "closingDate",
           "sourceUrl", "contactName", "contactEmail", "contactPhone", status
    FROM "Tender"
    ${where}
    ${order}
    LIMIT ${p.limit} OFFSET ${offset}
  `;

  const countRes = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM "Tender" ${where}
  `;
  const total = countRes[0]?.count ?? 0;

  // Attach documents in one query rather than N.
  const ids = rows.map((r) => r.id);
  const docs = ids.length
    ? await prisma.tenderDocument.findMany({ where: { tenderId: { in: ids } } })
    : [];
  const byTender = new Map<string, typeof docs>();
  for (const d of docs) {
    const arr = byTender.get(d.tenderId) ?? [];
    arr.push(d);
    byTender.set(d.tenderId, arr);
  }

  return { rows, documentsByTender: byTender, total };
}
