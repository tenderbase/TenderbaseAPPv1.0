import { randomUUID } from "node:crypto";
import { pool } from "./prisma.js";
import type { NormalisedTender } from "../normalise.js";

export type UpsertOutcome = "inserted" | "updated" | "unchanged";

/**
 * Upsert one tender, keyed on the source identity (source, ocid, releaseId).
 * Uses the runtime pg pool directly so nested document writes and municipality
 * relations work against the same production database connection.
 */
export async function upsertTender(t: NormalisedTender): Promise<UpsertOutcome> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let municipalityId: string | null = null;
    if (t.municipalityCode) {
      const municipality = await client.query<{ id: string }>(
        'SELECT id FROM "Municipality" WHERE code = $1 LIMIT 1',
        [t.municipalityCode.toUpperCase()],
      );
      municipalityId = municipality.rows[0]?.id ?? null;
      if (!municipalityId) {
        throw new Error(`Unknown municipality code: ${t.municipalityCode}`);
      }
    }

    const existing = await client.query<{ id: string; contentHash: string }>(
      'SELECT id, "contentHash" FROM "Tender" WHERE source = $1 AND ocid = $2 AND "releaseId" = $3 LIMIT 1',
      [t.source, t.ocid, t.releaseId],
    );

    if (existing.rows[0]?.contentHash === t.contentHash) {
      await client.query(
        'UPDATE "Tender" SET "lastSeenAt" = NOW(), "updatedAt" = NOW() WHERE id = $1',
        [existing.rows[0].id],
      );
      await client.query("COMMIT");
      return "unchanged";
    }

    const values = [
      t.source,
      t.sourceUrl,
      t.ocid,
      t.releaseId,
      t.tenderNumber,
      t.procurementType,
      municipalityId,
      t.title,
      t.description,
      t.organisation,
      t.category,
      t.province,
      t.location,
      t.valueCents === null ? null : BigInt(t.valueCents),
      t.publishedDate ? new Date(t.publishedDate) : null,
      t.closingDate ? new Date(t.closingDate) : null,
      t.status,
      t.contactName,
      t.contactEmail,
      t.contactPhone,
      t.cidbGrade,
      t.cidbGradeRaw,
      t.isOpportunity,
      t.contentHash,
    ];

    let tenderId: string;
    if (existing.rows[0]) {
      tenderId = existing.rows[0].id;
      await client.query(
        `UPDATE "Tender" SET
          "sourceUrl" = $1, "tenderNumber" = $2, "procurementType" = $3,
          "municipalityId" = $4, "title" = $5, "description" = $6,
          "organisation" = $7, "category" = $8, "province" = $9, "location" = $10,
          "valueCents" = $11, "publishedDate" = $12, "closingDate" = $13,
          "status" = $14, "contactName" = $15, "contactEmail" = $16,
          "contactPhone" = $17, "cidbGrade" = $18, "cidbGradeRaw" = $19,
          "isOpportunity" = $20, "contentHash" = $21,
          "lastSeenAt" = NOW(), "updatedAt" = NOW()
         WHERE id = $22`,
        [...values.slice(1), tenderId],
      );
    } else {
      const result = await client.query<{ id: string }>(
        `INSERT INTO "Tender" (
          "source", "sourceUrl", "ocid", "releaseId", "tenderNumber",
          "procurementType", "municipalityId", "title", "description", "organisation",
          "category", "province", "location", "valueCents", "publishedDate", "closingDate",
          "status", "contactName", "contactEmail", "contactPhone", "cidbGrade",
          "cidbGradeRaw", "isOpportunity", "contentHash", "firstSeenAt", "lastSeenAt",
          "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23, $24, NOW(), NOW(), NOW(), NOW()
        ) RETURNING id`,
        values,
      );
      tenderId = result.rows[0].id;
    }

    await client.query('DELETE FROM "TenderDocument" WHERE "tenderId" = $1', [tenderId]);
    for (const document of t.documents) {
      await client.query(
        'INSERT INTO "TenderDocument" (id, "tenderId", name, url, "fileType", "isAddendum") VALUES ($1, $2, $3, $4, $5, $6)',
        [randomUUID(), tenderId, document.name, document.url, document.fileType, document.isAddendum],
      );
    }

    await client.query("COMMIT");
    return existing.rows[0] ? "updated" : "inserted";
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
