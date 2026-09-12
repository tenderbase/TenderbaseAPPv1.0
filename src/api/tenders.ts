import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { SEARCH_EXPR } from "../db/search.js";

export interface ListParams {
  page: number;
  limit: number;
  q?: string;
  source?: string;
  province?: string;
  category?: string;
  status?: string;
  municipality?: string;
  municipalityCode?: string;
  procurementType?: string;
  closingBefore?: Date;
  closingAfter?: Date;
  publishedAfter?: Date;
  publishedBefore?: Date;
  cidbGrade?: string;
  organisation?: string;
  constructionOnly?: boolean;
  sort: "latest" | "closing" | "closing_desc" | "published_asc";
}

const CONSTRUCTION_CATEGORIES = ["Construction", "Civil engineering", "Construction of buildings"];

export interface RawTender {
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
  cidbGrade: string | null;
  cidbGradeRaw: string | null;
  firstSeenAt: Date | null;
  procurementType: string;
  municipalityCode: string | null;
  municipalityName: string | null;
}

function buildWhere(p: ListParams): Prisma.Sql {
  const conds: Prisma.Sql[] = [Prisma.sql`"isOpportunity" = true`];
  if (p.source) conds.push(Prisma.sql`"source" = ${p.source}`);
  if (p.province) conds.push(Prisma.sql`"province" = ${p.province}`);
  if (p.category) conds.push(Prisma.sql`"category" = ${p.category}`);
  if (p.status) conds.push(Prisma.sql`"status" = ${p.status}`);
  if (p.municipalityCode) conds.push(Prisma.sql`"municipality"."code" = ${p.municipalityCode.toUpperCase()}`);
  else if (p.municipality) {
    const municipality = p.municipality.trim();
    conds.push(Prisma.sql`("municipality"."code" = ${municipality.toUpperCase()} OR "municipality"."name" ILIKE ${"%" + municipality + "%"})`);
  }
  if (p.procurementType) conds.push(Prisma.sql`"procurementType" = ${p.procurementType.toUpperCase()}`);
  if (p.q) conds.push(Prisma.sql`${SEARCH_EXPR} @@ websearch_to_tsquery('english', ${p.q})`);
  if (p.closingBefore) conds.push(Prisma.sql`"closingDate" <= ${p.closingBefore}`);
  if (p.closingAfter) conds.push(Prisma.sql`"closingDate" >= ${p.closingAfter}`);
  if (p.publishedAfter) conds.push(Prisma.sql`"publishedDate" >= ${p.publishedAfter}`);
  if (p.publishedBefore) conds.push(Prisma.sql`"publishedDate" <= ${p.publishedBefore}`);
  if (p.cidbGrade) conds.push(Prisma.sql`"cidbGrade" = ${p.cidbGrade}`);
  if (p.organisation) conds.push(Prisma.sql`"organisation" ILIKE ${"%" + p.organisation + "%"}`);
  if (p.constructionOnly) conds.push(Prisma.sql`"category" = ANY(${CONSTRUCTION_CATEGORIES}::text[])`);
  return Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}`;
}

const TENDER_SELECT = Prisma.sql`
  SELECT t.id, t."tenderNumber", t.title, t.description, t.organisation, t.category,
         t.province, t.location, t."valueCents", t."publishedDate", t."closingDate",
         t."sourceUrl", t."contactName", t."contactEmail", t."contactPhone", t.status,
         t."cidbGrade", t."cidbGradeRaw", t."firstSeenAt", t."procurementType",
         m.code AS "municipalityCode", m.name AS "municipalityName"
  FROM "Tender" t
  LEFT JOIN "Municipality" m ON m.id = t."municipalityId"
`;

export async function listTenders(p: ListParams) {
  try {
    const where = buildWhere(p);
    const offset = (p.page - 1) * p.limit;
    let order = Prisma.sql`ORDER BY t."publishedDate" DESC NULLS LAST, t."firstSeenAt" DESC`;
    if (p.sort === "closing") order = Prisma.sql`ORDER BY t."closingDate" ASC NULLS LAST`;
    else if (p.sort === "closing_desc") order = Prisma.sql`ORDER BY t."closingDate" DESC NULLS LAST`;
    else if (p.sort === "published_asc") order = Prisma.sql`ORDER BY t."publishedDate" ASC NULLS LAST`;

    const rows = await prisma.$queryRaw<RawTender[]>`
      ${TENDER_SELECT} ${where} ${order}
      LIMIT ${p.limit} OFFSET ${offset}
    `;

    const countRes = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count
      FROM "Tender" t
      LEFT JOIN "Municipality" m ON m.id = t."municipalityId"
      ${where}
    `;
    const total = countRes[0]?.count ?? 0;
    const ids = rows.map((r) => r.id);
    const docs = ids.length ? await prisma.tenderDocument.findMany({ where: { tenderId: { in: ids } } }) : [];
    const byTender = new Map<string, typeof docs>();
    for (const d of docs) {
      const arr = byTender.get(d.tenderId) ?? [];
      arr.push(d);
      byTender.set(d.tenderId, arr);
    }
    return { rows, documentsByTender: byTender, total };
  } catch (err) {
    console.error("DEBUG listTenders error:", err);
    throw err;
  }
}

export async function getCategories() {
  try {
    return await prisma.$queryRaw<Array<{ category: string; count: number }>>`
      SELECT "category", COUNT(*)::int AS count FROM "Tender"
      WHERE "isOpportunity" = true AND "category" IS NOT NULL
      GROUP BY "category" ORDER BY count DESC, "category" ASC
    `;
  } catch (err) {
    console.error("Database query failed in getCategories:", (err as Error).message);
    return [];
  }
}

export async function getProvinces() {
  try {
    return await prisma.$queryRaw<Array<{ province: string; count: number }>>`
      SELECT "province", COUNT(*)::int AS count FROM "Tender"
      WHERE "isOpportunity" = true AND "province" IS NOT NULL
      GROUP BY "province" ORDER BY count DESC, "province" ASC
    `;
  } catch (err) {
    console.error("Database query failed in getProvinces:", (err as Error).message);
    return [];
  }
}

export async function getMunicipalities() {
  try {
    return await prisma.$queryRaw<Array<{ code: string; name: string; province: string; tenderCount: number }>>`
      SELECT m.code, m.name, m.province, COUNT(t.id)::int AS "tenderCount"
      FROM "Municipality" m
      LEFT JOIN "Tender" t ON t."municipalityId" = m.id AND t."isOpportunity" = true
      WHERE m.enabled = true
      GROUP BY m.id, m.code, m.name, m.province
      ORDER BY m.name ASC
    `;
  } catch (err) {
    console.error("Database query failed in getMunicipalities:", (err as Error).message);
    return [];
  }
}

export async function getProcurementTypes() {
  try {
    return await prisma.$queryRaw<Array<{ procurementType: string; count: number }>>`
      SELECT "procurementType", COUNT(*)::int AS count
      FROM "Tender"
      WHERE "isOpportunity" = true
      GROUP BY "procurementType"
      ORDER BY count DESC, "procurementType" ASC
    `;
  } catch (err) {
    console.error("Database query failed in getProcurementTypes:", (err as Error).message);
    return [];
  }
}

export async function getStats() {
  try {
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const [counts] = await prisma.$queryRaw<Array<{ total: number; active: number; complete: number; cancelled: number; expiringSoon: number; latestPublished: Date | null }>>`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active,
        COUNT(*) FILTER (WHERE status = 'complete')::int AS complete,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
        COUNT(*) FILTER (WHERE status = 'active' AND "closingDate" >= ${now} AND "closingDate" <= ${nextWeek})::int AS "expiringSoon",
        MAX("publishedDate") AS "latestPublished"
      FROM "Tender" WHERE "isOpportunity" = true
    `;
    const [catCount] = await prisma.$queryRaw<Array<{ count: number }>>`SELECT COUNT(DISTINCT "category")::int AS count FROM "Tender" WHERE "isOpportunity" = true AND "category" IS NOT NULL`;
    const [provCount] = await prisma.$queryRaw<Array<{ count: number }>>`SELECT COUNT(DISTINCT "province")::int AS count FROM "Tender" WHERE "isOpportunity" = true AND "province" IS NOT NULL`;
    return {
      totalTenders: counts?.total ?? 0,
      activeTenders: counts?.active ?? 0,
      completedTenders: counts?.complete ?? 0,
      cancelledTenders: counts?.cancelled ?? 0,
      expiringSoonTenders: counts?.expiringSoon ?? 0,
      categoriesCount: catCount?.count ?? 0,
      provincesCount: provCount?.count ?? 0,
      latestPublishedDate: counts?.latestPublished ? (typeof counts.latestPublished === "string" ? counts.latestPublished : counts.latestPublished.toISOString()) : null,
    };
  } catch (err) {
    console.error("DEBUG getStats error:", err);
    return { totalTenders: 0, activeTenders: 0, completedTenders: 0, cancelledTenders: 0, expiringSoonTenders: 0, categoriesCount: 0, provincesCount: 0, latestPublishedDate: null };
  }
}
