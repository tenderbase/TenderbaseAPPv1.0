import { prisma } from "./prisma.js";
import type { NormalisedTender } from "../normalise.js";

export type UpsertOutcome = "inserted" | "updated" | "unchanged";

/**
 * Upsert one tender, keyed on the OCDS identity (source, ocid, releaseId).
 *
 * Change detection matters because the feed republishes releases: an identical
 * re-publication must NOT count as an update, or every hourly run would churn
 * the whole table and (later) re-notify users about nothing.
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

  const fields = {
    sourceUrl: t.sourceUrl,
    tenderNumber: t.tenderNumber,
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
      // Unchanged — only refresh lastSeenAt so we know it's still live.
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
