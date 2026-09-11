import { createHash } from "node:crypto";
import type { NormalisedTender, TenderDocument } from "../normalise.js";
import { cleanText, parseDate, extractCidbGrade } from "../normalise.js";

export const ETHEKWINI_SOURCE = "ETHEKWINI";
export const ETHEKWINI_BASE_URL = "https://durban.gov.za/pages/business/procurement";

// eThekwini publishes the same procurement content on several official
// subdomains. GitHub-hosted runners have recently timed out against the main
// hostname, so try the official mirrors before using the transport fallback.
const OFFICIAL_BASE_URLS = [
  "https://tenders.durban.gov.za/pages/business/procurement",
  "https://market.durban.gov.za/pages/business/procurement",
  "https://stats.durban.gov.za/pages/business/procurement",
  "https://economic.durban.gov.za/pages/business/procurement",
  "https://dag.durban.gov.za/pages/business/procurement",
  ETHEKWINI_BASE_URL,
];

const READER_BASE_URL = "https://r.jina.ai/";
const USER_AGENT = "TenderBase/1.0 (+https://tenderbase-web.onrender.com/)";
const MAX_PAGES = 50;
const CONNECT_TIMEOUT_MS = 20_000;
const RESPONSE_TIMEOUT_MS = 60_000;
const ATTEMPTS_PER_SOURCE = 2;
const RETRY_DELAYS_MS = [2_000, 5_000];

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

function blockToTender(block: string, htmlBlock: string, page: number, sourceBaseUrl = ETHEKWINI_BASE_URL): NormalisedTender | null {
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
  const documents = extractDocuments(htmlBlock, sourceBaseUrl);
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

export function parseEThekwiniPage(html: string, page = 1, sourceBaseUrl = ETHEKWINI_BASE_URL): NormalisedTender[] {
  const markers = [...html.matchAll(/<[^>]*>\s*Tender\s*<\/?[^>]*>/gi)].map((m) => m.index ?? 0);
  const starts = markers.length ? markers : [...html.matchAll(/\bTender\b/gi)].map((m) => m.index ?? 0);
  const tenders: NormalisedTender[] = [];

  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i]!;
    const end = starts[i + 1] ?? html.length;
    const htmlBlock = html.slice(start, end);
    const block = stripHtml(htmlBlock);
    if (!/Reference\s+/i.test(block)) continue;
    const tender = blockToTender(block, htmlBlock, page, sourceBaseUrl);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESPONSE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDirect(url: string): Promise<{ html: string; baseUrl: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < ATTEMPTS_PER_SOURCE; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, {
        headers: { accept: "text/html,application/xhtml+xml", "user-agent": USER_AGENT },
      });
      if (response.ok) {
        const parsed = new URL(url);
        return { html: await response.text(), baseUrl: parsed.origin + parsed.pathname };
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < ATTEMPTS_PER_SOURCE - 1) await sleep(RETRY_DELAYS_MS[attempt]!);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchViaReader(officialUrl: string): Promise<{ html: string; baseUrl: string }> {
  const readerUrl = `${READER_BASE_URL}${officialUrl}`;
  const response = await fetchWithTimeout(readerUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": USER_AGENT,
      "x-respond-with": "html",
      "x-timeout": "30",
    },
  });
  if (!response.ok) throw new Error(`Reader fallback returned HTTP ${response.status}`);
  const parsed = new URL(officialUrl);
  return { html: await response.text(), baseUrl: parsed.origin + parsed.pathname };
}

async function fetchPage(page: number): Promise<{ html: string; baseUrl: string; fetchedUrl: string }> {
  const urls = OFFICIAL_BASE_URLS.map((base) => {
    const url = new URL(base);
    if (page > 1) url.searchParams.set("page", String(page));
    return url.toString();
  });

  const errors: string[] = [];
  for (const url of urls) {
    try {
      const result = await fetchDirect(url);
      return { ...result, fetchedUrl: url };
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Official public crawlers are currently seeing the procurement data while
  // GitHub-hosted runners can time out against the municipality edge. Reader
  // is only a transport fallback; provenance URLs remain official eThekwini.
  const canonicalUrl = urls.at(-1)!;
  try {
    const result = await fetchViaReader(canonicalUrl);
    return { ...result, fetchedUrl: `reader:${canonicalUrl}` };
  } catch (error) {
    errors.push(`reader:${canonicalUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }

  throw new Error(`eThekwini procurement page ${page} unavailable. ${errors.join(" | ")}`);
}

export async function fetchEThekwiniOpenTenders(): Promise<{ tenders: NormalisedTender[]; pages: number }> {
  const all: NormalisedTender[] = [];
  const seen = new Set<string>();
  let pages = 0;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const fetched = await fetchPage(page);
    const tenders = parseEThekwiniPage(fetched.html, page, fetched.baseUrl);
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
