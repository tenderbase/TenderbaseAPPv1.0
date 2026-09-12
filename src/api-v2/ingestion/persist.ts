import { randomUUID, createHash } from "node:crypto";
import pg from "pg";
import type { NormalizedTender } from "./types.js";

export type PersistStats = { inserted: number; updated: number; unchanged: number };

async function syncDocuments(client: pg.PoolClient, tenderId: string, documents: NormalizedTender["documents"]): Promise<void> {
  await client.query('DELETE FROM "TenderDocument" WHERE "tenderId" = $1', [tenderId]);
  for (const document of documents) {
    await client.query(
      'INSERT INTO "TenderDocument" (id, "tenderId", name, url, "fileType", "isAddendum") VALUES ($1, $2, $3, $4, $5, $6)',
      [randomUUID(), tenderId, document.name, document.url, document.fileType, document.isAddendum],
    );
  }
}

export async function persistTender(pool: pg.Pool, tender: NormalizedTender): Promise<"inserted" | "updated" | "unchanged"> {
  const contentHash = createHash("sha256").update(JSON.stringify(tender.raw)).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ id: string; contentHash: string }>(
      'select id, "contentHash" from "Tender" where source = $1 and ocid = $2 and "releaseId" = $3 limit 1',
      [tender.source, tender.ocid, tender.releaseId],
    );
    if (existing.rowCount && existing.rows[0].contentHash === contentHash) {
      await client.query('update "Tender" set "lastSeenAt" = now() where id = $1', [existing.rows[0].id]);
      await client.query("COMMIT");
      return "unchanged";
    }

    let tenderId: string;
    if (existing.rowCount) {
      tenderId = existing.rows[0].id;
      await client.query(
        `update "Tender" set "sourceUrl"=$1, "tenderNumber"=$2, title=$3, description=$4, organisation=$5,
          category=$6, province=$7, location=$8, "valueCents"=$9, "publishedDate"=$10, "closingDate"=$11,
          status=$12, "contactName"=$13, "contactEmail"=$14, "contactPhone"=$15, "procurementType"=$16,
          "contentHash"=$17, "lastSeenAt"=now(), "updatedAt"=now() where id=$18`,
        [tender.sourceUrl, tender.tenderNumber, tender.title ?? null, tender.description ?? null, tender.organisation ?? null,
          tender.category ?? null, tender.province ?? null, tender.location ?? null, tender.valueCents?.toString() ?? null,
          tender.publishedDate ?? null, tender.closingDate ?? null, tender.status ?? null, tender.contactName ?? null,
          tender.contactEmail ?? null, tender.contactPhone ?? null, tender.procurementType, contentHash, tenderId],
      );
      await syncDocuments(client, tenderId, tender.documents);
      await client.query("COMMIT");
      return "updated";
    }

    const result = await client.query<{ id: string }>(
      `insert into "Tender" (id, source, "sourceUrl", ocid, "releaseId", "tenderNumber", "procurementType",
        title, description, organisation, category, province, location, "valueCents", "publishedDate", "closingDate",
        status, "contactName", "contactEmail", "contactPhone", "contentHash", "firstSeenAt", "lastSeenAt",
        "createdAt", "updatedAt", "isOpportunity")
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,now(),now(),now(),now(),true)
       returning id`,
      [randomUUID(), tender.source, tender.sourceUrl, tender.ocid, tender.releaseId, tender.tenderNumber,
        tender.procurementType, tender.title ?? null, tender.description ?? null, tender.organisation ?? null,
        tender.category ?? null, tender.province ?? null, tender.location ?? null, tender.valueCents?.toString() ?? null,
        tender.publishedDate ?? null, tender.closingDate ?? null, tender.status ?? null, tender.contactName ?? null,
        tender.contactEmail ?? null, tender.contactPhone ?? null, contentHash],
    );
    tenderId = result.rows[0].id;
    await syncDocuments(client, tenderId, tender.documents);
    await client.query("COMMIT");
    return "inserted";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function persistBatch(pool: pg.Pool, tenders: NormalizedTender[]): Promise<PersistStats> {
  const stats: PersistStats = { inserted: 0, updated: 0, unchanged: 0 };
  for (const tender of tenders) stats[await persistTender(pool, tender)]++;
  return stats;
}
