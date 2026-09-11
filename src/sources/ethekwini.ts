import { createHash } from "node:crypto";
import type { NormalisedTender, TenderDocument } from "../normalise.js";
import { cleanText, parseDate, extractCidbGrade } from "../normalise.js";

export const ETHEKWINI_SOURCE = "ETHEKWINI";
export const ETHEKWINI_BASE_URL = "https://durban.gov.za/pages/business/procurement";

const USER_AGENT = "TenderBase/1.0 (+https://tenderbase-web.onrender.com/)";
const MAX_PAGES = 50;

function decodeHtml(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(input: string): string {
  return decodeHtml(
    input
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n")
      .replace(/<\/div\s*>/gi, "\n")
      .replace(/<\/li\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function absoluteUrl(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function parseClosingDate(text: string): string | null {
  const m = text.match(/Closing\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}:\d{2})/i);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${m[4]}:00+02:00`;
  return parseDate(iso);
}

function findField(block: string, label: string): string | null {
  const re = new RegExp(`${label}\\s+([^\\n]+)`, "i");
  return cleanText(block.match(re)?.[1] ?? null);
}

function findReference(block: string): string | null {
  return cleanText(block.match(/Reference\s+([^\n]+)/i)?.[1] ?? null);
}

function findTitle(block: string): string | null {
  const lines = block.split("\n").map(cleanText).filter((x): x is string => !!x);
  const categoryIndex = lines.findIndex((x) => /^General\s+·/i.test(x));
  if (categoryIndex > 0) return lines[categoryIndex - 1] ?? null;

  const refIndex = lines.findIndex((x) => /^Reference\s+/i.test(x));
  if (refIndex < 0) return null;
  return lines
    .slice(Math.max(0, refIndex - 6), refIndex)
    .filter((x) => !/^Tender$/i.test(x) && !/^\d+ tenders$/i.test(x) && !/^\d{4}$/i.test(x))
    .at(-1) ?? null;
}

function extractDocuments(htmlBlock: string, baseUrl: string): TenderDocument[] {
  const out: TenderDocument[] = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of htmlBlock.matchAll(re)) {
    const href = absoluteUrl(m[1]!, baseUrl);
    const label = cleanText(stripHtml(m[2]!));
    if (!/\.(pdf|docx?|xlsx?)(?:\?|#|$)/i.test(href) && !/\.pdf/i.test(label ?? "")) continue;
    const fileName = decodeURIComponent(href.split("/").pop()?.split("?")[0] ?? "");
    const name = label || fileName || null;
    const ext = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
    const types: Record<string, string> = {
      pdf: "APPLICATION/PDF",
      doc: "APPLICATION/MSWORD",
      docx: "APPLICATION/VND.OPENXMLFORMATS-OFFICEDOCUMENT.WORDDOCUMENT",
      xls: "APPLICATION/VND.MS-EXCEL",
      xlsx: "APPLICATION/VND.OPENXMLFORMATS-OFFICEDOCUMENT.SPREADSHEET",
    };
    out.push({ name, url: href, fileType: types[ext] ?? null, isAddendum: /addendum|amendment|clarification|q.?a/i.test(name ?? "") });
  }
  return out;
}

function blockToTender(block: string, htmlBlock: string, page: number): NormalisedTender | null {
  const reference = findReference(block);
  const title = findTitle(block);
  if (!reference || !title) return null;

  const closingDate = parseClosingDate(block);
  const description = findField(block, "Summary") ?? title;
  const organisation = findField(block, "Procuring Entity") ?? "eThekwini Municipality";
  const contactName = findField(block, "Contact Person");
  const contactPhone = findField(block, "Contact Number");
  const contactEmail = findField(block, "Email");
  const category = cleanText(block.match(/General\s+·\s+([^\n]+)/i)?.[1] ?? "Municipal Procurement");
  const documents = extractDocuments(htmlBlock, ETHEKWINI_BASE_URL);
  const sourceUrl = `${ETHEKWINI_BASE_URL}?page=${page}#${encodeURIComponent(reference)}`;
  const cidb = extractCidbGrade(title, description);
  const contentHash = createHash("sha256")
    .update(JSON.stringify({ title, description, organisation, category, closingDate, contactName, contactEmail, contactPhone, documents: documents.map((d) => d.url) }))
    .digest("hex");

  return {
    source: ETHEKWINI_SOURCE,
    sourceUrl,
    ocid: `ETHEKWINI-${reference.toUpperCase()}`,
    releaseId: "current",
    tenderNumber: reference,
    title,
    description,
    organisation,
    category,
    province: "KwaZulu-Natal",
    location: "eThekwini Municipality, KwaZulu-Natal",
    valueCents: null,
    publishedDate: null,
    closingDate,
    status: closingDate && new Date(closingDate).getTime() > Date.now() ? "active" : "closed",
    contactName,
    contactEmail,
    contactPhone,
    cidbGrade: cidb.grade,
    cidbGradeRaw: cidb.raw,
    documents,
    isOpportunity: true,
    contentHash,
  };
}

export function parseEThekwiniPage(html: string, page = 1): NormalisedTender[] {
  const markers = [...html.matchAll(/<[^>]*>\s*Tender\s*<\/?[^>]*>/gi)].map((m) => m.index ?? 0);
  const starts = markers.length ? markers : [...html.matchAll(/\bTender\b/gi)].map((m) => m.index ?? 0);
  const tenders: NormalisedTender[] = [];

  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i]!;
    const end = starts[i + 1] ?? html.length;
    const htmlBlock = html.slice(start, end);
    const block = stripHtml(htmlBlock);
    if (!/Reference\s+/i.test(block)) continue;
    const tender = blockToTender(block, htmlBlock, page);
    if (tender) tenders.push(tender);
  }

  const seen = new Set<string>();
  return tenders.filter((t) => {
    const key = t.tenderNumber.toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchPage(page: number): Promise<string> {
  const url = new URL(ETHEKWINI_BASE_URL);
  if (page > 1) url.searchParams.set("page", String(page));
  const response = await fetch(url, {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`eThekwini procurement page ${page} returned HTTP ${response.status}`);
  return response.text();
}

export async function fetchEThekwiniOpenTenders(): Promise<{ tenders: NormalisedTender[]; pages: number }> {
  const all: NormalisedTender[] = [];
  const seen = new Set<string>();
  let pages = 0;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const html = await fetchPage(page);
    const tenders = parseEThekwiniPage(html, page);
    pages += 1;
    if (!tenders.length) break;

    let added = 0;
    for (const tender of tenders) {
      const key = tender.tenderNumber.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(tender);
      added += 1;
    }
    if (added === 0) break;
  }

  return { tenders: all, pages };
}
