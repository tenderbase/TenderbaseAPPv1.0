import type { Tender, TenderDocument } from "@prisma/client";

/**
 * Shape the live TenderBase app already consumes. Field names here are
 * load-bearing — changing one silently breaks the app.
 *
 * Differences from the current live API (all deliberate improvements backed by
 * RESEARCH.md): `category` is now real (was 97% "Other"), `contactInformation`
 * is populated (was 0%), and `isOpportunity` false entries are hidden.
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
}

export function toContractTender(
  row: Tender,
  documents: TenderDocument[]
): ContractTender {
  const hasContact = !!(row.contactName || row.contactEmail || row.contactPhone);
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
    valueCents: row.valueCents === null ? null : Number(row.valueCents),
    // The live API returns publishedDate as a date and closingDate as a full
    // ISO timestamp. Match that exactly.
    publishedDate: row.publishedDate ? row.publishedDate.toISOString().slice(0, 10) : null,
    closingDate: row.closingDate ? row.closingDate.toISOString() : null,
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
      ? { name: row.contactName, email: row.contactEmail, telephone: row.contactPhone }
      : null,
    isSaved: false,
    savedAt: null,
    matchScore: null,
  };
}
