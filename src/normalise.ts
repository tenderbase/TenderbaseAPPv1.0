import { createHash } from "node:crypto";
import { SOURCE_URL } from "./config.js";
import type { OcdsRelease } from "./sources/ocds.js";

export type ProcurementType =
  | "TENDER"
  | "RFQ"
  | "QUOTATION"
  | "EOI"
  | "ADDENDUM"
  | "AWARD"
  | "CANCELLATION"
  | "NOTICE"
  | "OTHER";

export interface TenderDocument {
  name: string | null;
  url: string;
  fileType: string | null;
  isAddendum: boolean;
}

export interface NormalisedTender {
  source: string;
  sourceUrl: string;
  ocid: string;
  releaseId: string;
  tenderNumber: string;
  procurementType: ProcurementType;
  municipalityCode: string | null;
  title: string | null;
  description: string | null;
  organisation: string | null;
  category: string | null;
  province: string | null;
  location: string | null;
  valueCents: number | null;
  publishedDate: string | null;
  closingDate: string | null;
  status: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  cidbGrade: string | null;
  cidbGradeRaw: string | null;
  documents: TenderDocument[];
  /** false for "Regret Letter" / cancellation notices that are not opportunities */
  isOpportunity: boolean;
  contentHash: string;
}

// ---------------------------------------------------------------- helpers

/** Collapse whitespace, strip any HTML that leaks through, trim. */
export function cleanText(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  let s = String(input);
  s = s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&");
  s = s.replace(/\s+/g, " ").trim();
  return s.length ? s : null;
}

const SENTINEL_PREFIXES = ["0001-01-01", "0000-00-00", "1900-01-01"];

/** Parse an ISO date/datetime; return null for the feed's sentinel values. */
export function parseDate(input: unknown): string | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s || SENTINEL_PREFIXES.some((p) => s.startsWith(p))) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

const EXT_TYPES: Record<string, string> = {
  pdf: "APPLICATION/PDF",
  doc: "APPLICATION/MSWORD",
  docx: "APPLICATION/VND.OPENXMLFORMATS-OFFICEDOCUMENT.WORDDOCUMENT",
  xls: "APPLICATION/VND.MS-EXCEL",
  xlsx: "APPLICATION/VND.OPENXMLFORMATS-OFFICEDOCUMENT.SPREADSHEET",
  pptx: "APPLICATION/VND.OPENXMLFORMATS-OFFICEDOCUMENT.PRESENTATION",
  zip: "APPLICATION/ZIP",
};

function guessFileType(url: string, name: string | null): string | null {
  const src = (url.split("?")[0] || "") + " " + (name ?? "");
  const m = src.match(/\.([a-z0-9]{2,5})\s*$/i);
  if (!m) return null;
  return EXT_TYPES[m[1]!.toLowerCase()] ?? null;
}

/**
 * CIDB grading is free text only, e.g.
 *   "Only tenderers with CIDB Grading of 5CE or higher are eligible"
 * Measured recall: ~2.3% of releases. Enrichment, never a hard filter.
 */
const CIDB_RE =
  /CIDB[^.]{0,120}?(?:grading|grade)[^.]{0,80}?([1-9](?:CE|GB|PE|ME|EE|EB|EP|SC|SW|SF|SG|SJ|SK|SL|SM|SN|SO|SP|SQ|SR|SS|ST|SU|SV)[A-Za-z]?)/i;

export function extractCidbGrade(
  ...parts: (string | null | undefined)[]
): { grade: string | null; raw: string | null } {
  for (const p of parts) {
    if (!p) continue;
    const m = p.match(CIDB_RE);
    if (m) {
      return { grade: m[1]!.toUpperCase(), raw: cleanText(m[0]) };
    }
  }
  return { grade: null, raw: null };
}

/**
 * Entries that are NOT bid opportunities. "Regret Letter" posts are notices to
 * unsuccessful bidders; showing one as a new tender would confuse users.
 */
const NOISE_RE =
  /regret\s*letter|unsuccessful\s+(?:suppliers?|bidders?)|cancellation\s+of\s+(?:a\s+)?tender/i;

/** Classify the national OCDS release conservatively. */
export function classifyProcurementType(title: string | null, description: string | null): ProcurementType {
  const text = `${title ?? ""} ${description ?? ""}`.toLowerCase();
  if (/\baddendum\b|\bamendment\b|\bclarification\b|\bq\s*&\s*a\b/.test(text)) return "ADDENDUM";
  if (/\brequest\s+for\s+quotation\b|\brfq\b|\bquotation\b/.test(text)) return "RFQ";
  if (/\bexpression\s+of\s+interest\b|\beoi\b/.test(text)) return "EOI";
  if (/\baward\b|\bsuccessful\s+(?:bidder|tenderer|supplier)/.test(text)) return "AWARD";
  if (/\bcancellation\b|\bcancelled\b|\bcanceled\b/.test(text)) return "CANCELLATION";
  if (/\bnotice\b/.test(text) && !/\btender\b/.test(text)) return "NOTICE";
  return "TENDER";
}

// ---------------------------------------------------------------- main

export function normaliseRelease(release: OcdsRelease): NormalisedTender {
  const t = release.tender ?? {};
  const buyer = release.buyer ?? {};
  const procuring = t.procuringEntity ?? {};

  const title = cleanText(t.title);
  const description = cleanText(t.description);
  const specialConditions = cleanText(t.specialConditions);

  const organisation = cleanText(buyer.name) ?? cleanText(procuring.name) ?? null;
  const period = t.tenderPeriod ?? {};
  const contact = t.contactPerson ?? {};

  const amount = Number(t?.value?.amount ?? 0);
  const valueCents = Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;

  const location =
    typeof t.deliveryLocation === "string"
      ? cleanText(t.deliveryLocation)
      : cleanText(t?.deliveryLocation?.description) ?? null;

  const documents: TenderDocument[] = (Array.isArray(t.documents) ? t.documents : [])
    .map((d: any) => {
      const url = typeof d?.url === "string" ? d.url.trim() : "";
      if (!url) return null;
      const name = cleanText(d?.title ?? d?.description ?? null);
      return {
        name,
        url,
        fileType: guessFileType(url, name),
        isAddendum: /addendum|amendment/i.test(name ?? ""),
      } satisfies TenderDocument;
    })
    .filter((d: TenderDocument | null): d is TenderDocument => d !== null);

  const cidb = extractCidbGrade(description, specialConditions, title);
  const haystack = [title, description, specialConditions].filter(Boolean).join(" ");
  const isOpportunity = !NOISE_RE.test(haystack);
  const procurementType = classifyProcurementType(title, description);

  const base = {
    status: cleanText(t.status),
    category: cleanText(t.category),
    province: cleanText(t.province),
    closingDate: parseDate(period.endDate),
    description,
    documents: documents.map((d) => d.url),
  };

  return {
    source: "OCDS",
    sourceUrl: SOURCE_URL,
    ocid: String(release.ocid ?? ""),
    releaseId: String(release.id ?? ""),
    tenderNumber: String(t.id ?? ""),
    procurementType,
    municipalityCode: null,
    title,
    description,
    organisation,
    category: base.category,
    province: base.province,
    location,
    valueCents,
    publishedDate: parseDate(release.date),
    closingDate: base.closingDate,
    status: base.status,
    contactName: cleanText(contact.name),
    contactEmail: cleanText(contact.email),
    contactPhone: cleanText(contact.telephoneNumber),
    cidbGrade: cidb.grade,
    cidbGradeRaw: cidb.raw,
    documents,
    isOpportunity,
    contentHash: createHash("sha256")
      .update(JSON.stringify({
        title,
        d: base.description,
        s: base.status,
        pt: procurementType,
        m: null,
        c: base.category,
        p: base.province,
        cd: base.closingDate,
        docs: base.documents,
      }))
      .digest("hex"),
  };
}
