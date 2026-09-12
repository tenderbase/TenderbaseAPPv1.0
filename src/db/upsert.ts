import { pool, prisma } from "./prisma.js";
import type { NormalisedTender } from "../normalise.js";

export type UpsertOutcome = "inserted" | "updated" | "unchanged";

/**
 * Upsert one tender, keyed on the source identity (source, ocid, releaseId).
 * Municipality identity is resolved through the stable municipality code.
 */
export async function upsertTender(t: NormalisedTender): Promise<UpsertOutcome> {
  const key = {
    source_ocid_releaseId: {
      source: t.source,
      ocid: t.ocid,
      releaseId: t.releaseId,
    },
  };

  const existing = await prisma.tender.findUnique({
    where: key,
    select: { id: true, contentHash: true },
  });

  let municipality: { id: string } | null = null;
  if (t.municipalityCode) {
    const result = await pool.query<{ id: string }>(
      'SELECT id FROM "Municipality" WHERE code = $1 LIMIT 1',
      [t.municipalityCode],
    );
    municipality = result.rows[0] ?? null;
  }

  if (t.municipalityCode && !municipality) {
    throw new Error(`Unknown municipality code: ${t.municipalityCode}`);
  }

  const fields = {
    sourceUrl: t.sourceUrl,
    tenderNumber: t.tenderNumber,
    procurementType: t.procurementType,
    municipalityId: municipality?.id ?? null,
    title: t.title,
    description: t.description,
    organisation: t.organisation,
    category: t.category,
    province: t.province,
    location: t.location,
    valueCents: t.valueCents === null ? null : BigInt(t.valueCents),
    publishedDate: t.publishedDate ? new Date(t.publishedDate) : null,
    closingDate: t.closingDate ? new Date(t.closingDate) : null,
    status: t.status,
    contactName: t.contactName,
    contactEmail: t.contactEmail,
    contactPhone: t.contactPhone,
    cidbGrade: t.cidbGrade,
    cidbGradeRaw: t.cidbGradeRaw,
    isOpportunity: t.isOpportunity,
    contentHash: t.contentHash,
  };

  if (existing) {
    if (existing.contentHash === t.contentHash) {
      await prisma.tender.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date() },
      });
      return "unchanged";
    }
    await prisma.tender.update({
      where: { id: existing.id },
      data: {
        ...fields,
        lastSeenAt: new Date(),
        documents: { deleteMany: {}, create: t.documents },
      },
    });
    return "updated";
  }

  await prisma.tender.create({
    data: {
      source: t.source,
      ocid: t.ocid,
      releaseId: t.releaseId,
      ...fields,
      documents: { create: t.documents },
    },
  });
  return "inserted";
}
