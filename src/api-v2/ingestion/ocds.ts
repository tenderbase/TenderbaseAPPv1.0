import { createHash } from "node:crypto";
import type { JsonRecord, NormalizedTender } from "./types.js";

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const result = asString(value);
    if (result) return result;
  }
  return undefined;
}

function asDate(value: unknown): Date | undefined {
  const text = asString(value);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function asCents(value: unknown): bigint | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.round(value * 100));
  if (typeof value === "string" && value.trim()) {
    const number = Number(value.replace(/,/g, ""));
    if (Number.isFinite(number)) return BigInt(Math.round(number * 100));
  }
  return undefined;
}

export function contentHash(value: JsonRecord): string {
  return createHash("sha256")
    .update(JSON.stringify(value, Object.keys(value).sort()))
    .digest("hex");
}

export function normalizeRelease(input: unknown, sourceUrl: string): NormalizedTender {
  const release = asRecord(input);
  const tender = asRecord(release.tender);
  const buyer = asRecord(release.buyer);
  const value = asRecord(tender.value);
  const period = asRecord(tender.tenderPeriod);
  const contact = asRecord(tender.contactPerson ?? tender.contactPoint);

  const ocid = firstString(release.ocid);
  const releaseId = firstString(release.id, release.releaseId);
  if (!ocid || !releaseId) throw new Error("OCDS release is missing ocid or id");

  const tenderNumber = firstString(
    tender.id,
    tender.procurementNumber,
    release.tenderNumber,
    release.id,
  ) ?? releaseId;

  const title = firstString(tender.title, release.title);
  const description = firstString(tender.description, release.description);
  const organisation = firstString(buyer.name, release.buyerName);
  const category = firstString(tender.category, tender.mainProcurementCategory, tender.procurementCategory);
  const province = firstString(tender.province, release.province);
  const location = firstString(tender.deliveryLocation, tender.location, release.location);
  const currency = asString(value.currency);

  const normalized: NormalizedTender = {
    source: "OCDS",
    sourceUrl,
    ocid,
    releaseId,
    tenderNumber,
    title,
    description,
    organisation,
    category,
    province,
    location,
    valueCents: asCents(value.amount),
    publishedDate: asDate(release.date ?? release.publishedDate),
    closingDate: asDate(period.end ?? tender.closingDate),
    status: firstString(tender.status, release.status),
    contactName: firstString(contact.name),
    contactEmail: firstString(contact.email),
    contactPhone: firstString(contact.telephone, contact.phone, contact.telephoneNumber),
    procurementType: classifyProcurementType(tender, release),
    raw: release,
  };

  if (currency) normalized.raw._tenderbaseCurrency = currency;
  return normalized;
}

export function classifyProcurementType(tender: JsonRecord, release: JsonRecord): string {
  const text = [
    asString(tender.procurementMethod),
    asString(tender.procurementMethodDetails),
    asString(tender.title),
    asString(tender.description),
    asString(release.title),
    asString(release.tag),
  ].filter(Boolean).join(" ").toLowerCase();

  if (/request\s+for\s+(?:quotation|quote)|\brfq\b|quotation/.test(text)) return "RFQ";
  if (/request\s+for\s+(?:information|info)|\brfi\b/.test(text)) return "RFI";
  if (/request\s+for\s+(?:proposal|proposals)|\brfp\b/.test(text)) return "RFP";
  if (/expression\s+of\s+interest|\beoi\b/.test(text)) return "EOI";
  if (/addendum|amendment/.test(text)) return "ADDENDUM";
  if (/cancel|withdraw|regret/.test(text)) return "CANCELLATION";
  return "TENDER";
}
