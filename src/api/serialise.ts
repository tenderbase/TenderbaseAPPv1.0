import type { Tender, TenderDocument } from "@prisma/client";

/**
 * Shape the live TenderBase app already consumes. Field names here are
 * load-bearing — changing one silently breaks the app.
 *
 * All original contract fields are guaranteed. Extra additive fields are
 * included to facilitate frontend ingestion and detail views.
 */
export interface ContractDocument {
  id: string;
  name: string | null;
  fileType: string | null;
  sizeBytes: number;
  updatedAt: string;
  url: string;
  isAddendum: boolean;
}

export interface ContractTender {
  id: string;
  tenderNumber: string;
  title: string | null;
  description: string | null;
  organisation: string | null;
  category: string | null;
  province: string | null;
  location: string | null;
  valueCents: number | null;
  publishedDate: string | null;
  closingDate: string | null;
  sourceUrl: string;
  documents: ContractDocument[];
  contactInformation: { name: string | null; email: string | null; telephone: string | null } | null;
  // Per-user state — owned by the app's auth layer, not this API.
  isSaved: boolean;
  savedAt: null;
  matchScore: null;

  // Additive metadata fields for rich frontend ingestion
  status?: string | null;
  cidbGrade?: string | null;
  cidbGradeRaw?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  firstSeenAt?: string | null;
}

export function toContractTender(
  row: Tender | any,
  documents: TenderDocument[]
): ContractTender {
  const hasContact = !!(row.contactName || row.contactEmail || row.contactPhone);

  const formatPubDate = (val: any) => {
    if (!val) return null;
    if (typeof val === "string") return val.slice(0, 10);
    if (val instanceof Date) return val.toISOString().slice(0, 10);
    return String(val).slice(0, 10);
  };

  const formatIsoDate = (val: any) => {
    if (!val) return null;
    if (typeof val === "string") return val;
    if (val instanceof Date) return val.toISOString();
    return String(val);
  };

  return {
    id: row.id,
    tenderNumber: row.tenderNumber,
    title: row.title,
    // 92.9% of titles are bare reference codes — description carries the meaning.
    description: row.description,
    organisation: row.organisation,
    category: row.category,
    province: row.province,
    location: row.location,
    valueCents: row.valueCents === null || row.valueCents === undefined ? null : Number(row.valueCents),
    publishedDate: formatPubDate(row.publishedDate),
    closingDate: formatIsoDate(row.closingDate),
    sourceUrl: row.sourceUrl,
    documents: documents.map((d) => ({
      id: d.id,
      name: d.name,
      fileType: d.fileType,
      sizeBytes: 0,
      updatedAt: "",
      url: d.url,
      isAddendum: d.isAddendum,
    })),
    contactInformation: hasContact
      ? { name: row.contactName ?? null, email: row.contactEmail ?? null, telephone: row.contactPhone ?? null }
      : null,
    isSaved: false,
    savedAt: null,
    matchScore: null,

    // Additive metadata
    status: row.status ?? null,
    cidbGrade: row.cidbGrade ?? null,
    cidbGradeRaw: row.cidbGradeRaw ?? null,
    contactName: row.contactName ?? null,
    contactEmail: row.contactEmail ?? null,
    contactPhone: row.contactPhone ?? null,
    firstSeenAt: formatIsoDate(row.firstSeenAt),
  };
}
