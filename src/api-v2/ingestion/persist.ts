import { randomUUID, createHash } from "node:crypto";
import pg from "pg";
import type { NormalizedTender } from "./types.js";

export type PersistStats = { inserted: number; updated: number; unchanged: number };

async function syncDocuments(client: pg.PoolClient, tenderId: string, documents: NormalizedTender["documents"]): Promise<void> {
  await client.query("DELETE FROM tender_documents WHERE tender_id = $1", [tenderId]);
  for (const document of documents) {
    await client.query(
      "INSERT INTO tender_documents (id, tender_id, name, url, file_type, is_addendum) VALUES ($1, $2, $3, $4, $5, $6)",
      [randomUUID(), tenderId, document.name, document.url, document.fileType, document.isAddendum],
    );
  }
}

function currencyFromRaw(tender: NormalizedTender): string | null {
  const value = tender.raw.tender;
  if (!value || typeof value !== "object") return null;
  const currency = (value as Record<string, unknown>).value;
  if (!currency || typeof currency !== "object") return null;
  const code = (currency as Record<string, unknown>).currency;
  return typeof code === "string" ? code : null;
}

export async function persistTender(pool: pg.Pool, tender: NormalizedTender): Promise<"inserted" | "updated" | "unchanged"> {
  const contentHash = createHash("sha256").update(JSON.stringify(tender.raw)).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ id: string; content_hash: string }>(
      "SELECT id, content_hash FROM tenders WHERE source = $1 AND ocid = $2 AND release_id = $3 LIMIT 1",
      [tender.source, tender.ocid, tender.releaseId],
    );

    if (existing.rowCount && existing.rows[0].content_hash === contentHash) {
      await client.query("UPDATE tenders SET last_seen_at = now() WHERE id = $1", [existing.rows[0].id]);
      await client.query("COMMIT");
      return "unchanged";
    }

    const currency = currencyFromRaw(tender);

    if (existing.rowCount) {
      const tenderId = existing.rows[0].id;
      await client.query(
        `UPDATE tenders SET source_url=$1, tender_number=$2, procurement_type=$3, title=$4, description=$5,
          category=$6, province=$7, location=$8, value_cents=$9, currency=$10, published_date=$11, closing_date=$12,
          status=$13, contact_name=$14, contact_email=$15, contact_phone=$16, content_hash=$17,
          raw_release=$18, last_seen_at=now(), updated_at=now() WHERE id=$19`,
        [tender.sourceUrl, tender.tenderNumber, tender.procurementType, tender.title ?? null, tender.description ?? null,
          tender.category ?? null, tender.province ?? null, tender.location ?? null, tender.valueCents?.toString() ?? null,
          currency, tender.publishedDate ?? null, tender.closingDate ?? null, tender.status ?? null, tender.contactName ?? null,
          tender.contactEmail ?? null, tender.contactPhone ?? null, contentHash, JSON.stringify(tender.raw), tenderId],
      );
      await syncDocuments(client, tenderId, tender.documents);
      await client.query("COMMIT");
      return "updated";
    }

    const tenderId = randomUUID();
    await client.query(
      `INSERT INTO tenders (
        id, source, source_url, ocid, release_id, tender_number, procurement_type, title, description,
        category, province, location, value_cents, currency, published_date, closing_date, status,
        contact_name, contact_email, contact_phone, content_hash, raw_release, first_seen_at, last_seen_at,
        created_at, updated_at, is_opportunity
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,now(),now(),now(),now(),true)`,
      [tenderId, tender.source, tender.sourceUrl, tender.ocid, tender.releaseId, tender.tenderNumber,
        tender.procurementType, tender.title ?? null, tender.description ?? null, tender.category ?? null,
        tender.province ?? null, tender.location ?? null, tender.valueCents?.toString() ?? null, currency,
        tender.publishedDate ?? null, tender.closingDate ?? null, tender.status ?? null, tender.contactName ?? null,
        tender.contactEmail ?? null, tender.contactPhone ?? null, contentHash, JSON.stringify(tender.raw)],
    );
    await syncDocuments(client, tenderId, tender.documents);
    await client.query("COMMIT");
    return "inserted";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function persistBatch(pool: pg.Pool, tenders: NormalizedTender[]): Promise<PersistStats> {
  const stats: PersistStats = { inserted: 0, updated: 0, unchanged: 0 };
  for (const tender of tenders) stats[await persistTender(pool, tender)]++;
  return stats;
}
