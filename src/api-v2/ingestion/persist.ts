import pg from "pg";
import type { NormalizedTender } from "./types.js";

const { Pool } = pg;

export type PersistStats = {
  inserted: number;
  updated: number;
  unchanged: number;
};

export async function persistTender(pool: pg.Pool, tender: NormalizedTender): Promise<"inserted" | "updated" | "unchanged"> {
  const hash = tender.raw ? JSON.stringify(tender.raw) : "{}";
  const existing = await pool.query<{ id: string; contentHash: string }>(
    'select id, "contentHash" from "Tender" where source = $1 and ocid = $2 and "releaseId" = $3 limit 1',
    [tender.source, tender.ocid, tender.releaseId],
  );

  const contentHash = await sha256(hash);
  if (existing.rowCount && existing.rows[0].contentHash === contentHash) {
    await pool.query('update "Tender" set "lastSeenAt" = now() where id = $1', [existing.rows[0].id]);
    return "unchanged";
  }

  if (existing.rowCount) {
    await pool.query(
      `update "Tender" set
        "sourceUrl"=$1, "tenderNumber"=$2, title=$3, description=$4, organisation=$5,
        category=$6, province=$7, location=$8, "valueCents"=$9, "publishedDate"=$10,
        "closingDate"=$11, status=$12, "contactName"=$13, "contactEmail"=$14,
        "contactPhone"=$15, "procurementType"=$16, "contentHash"=$17,
        "lastSeenAt"=now(), "updatedAt"=now()
       where id=$18`,
      [
        tender.sourceUrl, tender.tenderNumber, tender.title ?? null, tender.description ?? null,
        tender.organisation ?? null, tender.category ?? null, tender.province ?? null,
        tender.location ?? null, tender.valueCents?.toString() ?? null,
        tender.publishedDate ?? null, tender.closingDate ?? null, tender.status ?? null,
        tender.contactName ?? null, tender.contactEmail ?? null, tender.contactPhone ?? null,
        tender.procurementType, contentHash, existing.rows[0].id,
      ],
    );
    return "updated";
  }

  await pool.query(
    `insert into "Tender" (
      id, source, "sourceUrl", ocid, "releaseId", "tenderNumber", "procurementType",
      title, description, organisation, category, province, location, "valueCents",
      "publishedDate", "closingDate", status, "contactName", "contactEmail", "contactPhone",
      "contentHash", "firstSeenAt", "lastSeenAt", "createdAt", "updatedAt", "isOpportunity"
    ) values (
      gen_random_uuid()::text, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,now(),now(),now(),now(),true
    )`,
    [
      tender.source, tender.sourceUrl, tender.ocid, tender.releaseId, tender.tenderNumber,
      tender.procurementType, tender.title ?? null, tender.description ?? null,
      tender.organisation ?? null, tender.category ?? null, tender.province ?? null,
      tender.location ?? null, tender.valueCents?.toString() ?? null, tender.publishedDate ?? null,
      tender.closingDate ?? null, tender.status ?? null, tender.contactName ?? null,
      tender.contactEmail ?? null, tender.contactPhone ?? null, contentHash,
    ],
  );
  return "inserted";
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function persistBatch(pool: pg.Pool, tenders: NormalizedTender[]): Promise<PersistStats> {
  const stats: PersistStats = { inserted: 0, updated: 0, unchanged: 0 };
  for (const tender of tenders) {
    const result = await persistTender(pool, tender);
    stats[result]++;
  }
  return stats;
}
