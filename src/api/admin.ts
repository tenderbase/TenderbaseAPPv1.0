import { createHash } from "node:crypto";
import { pool } from "../db/prisma.js";
import { upsertTender } from "../db/upsert.js";
import type { NormalisedTender, ProcurementType, TenderDocument } from "../normalise.js";

export interface ManualTenderInput {
  source?: string;
  sourceUrl: string;
  ocid: string;
  releaseId: string;
  tenderNumber: string;
  procurementType?: ProcurementType;
  municipalityCode?: string | null;
  title?: string | null;
  description?: string | null;
  organisation?: string | null;
  category?: string | null;
  province?: string | null;
  location?: string | null;
  valueCents?: number | null;
  publishedDate?: string | null;
  closingDate?: string | null;
  status?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  cidbGrade?: string | null;
  cidbGradeRaw?: string | null;
  documents?: TenderDocument[];
  isOpportunity?: boolean;
}

function contentHash(t: Omit<NormalisedTender, "contentHash">): string {
  return createHash("sha256")
    .update(JSON.stringify({
      title: t.title,
      d: t.description,
      s: t.status,
      pt: t.procurementType,
      m: t.municipalityCode,
      c: t.category,
      p: t.province,
      cd: t.closingDate,
      docs: t.documents.map((d) => d.url),
    }))
    .digest("hex");
}

export async function manualUpsertTender(input: ManualTenderInput) {
  const base: Omit<NormalisedTender, "contentHash"> = {
    source: (input.source ?? "MANUAL").trim().toUpperCase(),
    sourceUrl: input.sourceUrl.trim(),
    ocid: input.ocid.trim(),
    releaseId: input.releaseId.trim(),
    tenderNumber: input.tenderNumber.trim(),
    procurementType: input.procurementType ?? "TENDER",
    municipalityCode: input.municipalityCode?.trim().toUpperCase() || null,
    title: input.title ?? null,
    description: input.description ?? null,
    organisation: input.organisation ?? null,
    category: input.category ?? null,
    province: input.province ?? null,
    location: input.location ?? null,
    valueCents: input.valueCents ?? null,
    publishedDate: input.publishedDate ?? null,
    closingDate: input.closingDate ?? null,
    status: input.status ?? "active",
    contactName: input.contactName ?? null,
    contactEmail: input.contactEmail ?? null,
    contactPhone: input.contactPhone ?? null,
    cidbGrade: input.cidbGrade ?? null,
    cidbGradeRaw: input.cidbGradeRaw ?? null,
    documents: input.documents ?? [],
    isOpportunity: input.isOpportunity ?? true,
  };

  const outcome = await upsertTender({ ...base, contentHash: contentHash(base) });
  const row = await pool.query(
    'SELECT id FROM "Tender" WHERE source = $1 AND ocid = $2 AND "releaseId" = $3 LIMIT 1',
    [base.source, base.ocid, base.releaseId],
  );
  return { outcome, tenderId: row.rows[0]?.id ?? null };
}

export async function relinkMunicipality(code: string, source: string) {
  const municipality = await pool.query('SELECT id, code, name FROM "Municipality" WHERE code = $1 LIMIT 1', [code.toUpperCase()]);
  if (!municipality.rows[0]) throw new Error(`Unknown municipality code: ${code}`);
  const result = await pool.query(
    'UPDATE "Tender" SET "municipalityId" = $1, "updatedAt" = NOW() WHERE source = $2 AND "municipalityId" IS DISTINCT FROM $1',
    [municipality.rows[0].id, source.trim().toUpperCase()],
  );
  return { municipality: municipality.rows[0], source: source.trim().toUpperCase(), linked: result.rowCount ?? 0 };
}

export async function getAdminDashboard() {
  const [sources, municipalities, types, recentRuns] = await Promise.all([
    pool.query('SELECT source, COUNT(*)::int AS count FROM "Tender" GROUP BY source ORDER BY count DESC, source ASC'),
    pool.query('SELECT m.code, m.name, m.enabled, COUNT(t.id)::int AS "tenderCount" FROM "Municipality" m LEFT JOIN "Tender" t ON t."municipalityId" = m.id GROUP BY m.id ORDER BY m.name'),
    pool.query('SELECT "procurementType", COUNT(*)::int AS count FROM "Tender" GROUP BY "procurementType" ORDER BY count DESC, "procurementType"'),
    pool.query('SELECT id, source, status, "isBackfill", "fetchedCount", "insertedCount", "updatedCount", "unchangedCount", "errorCount", "startedAt", "finishedAt", "durationMs" FROM "ScraperRun" ORDER BY "startedAt" DESC LIMIT 20'),
  ]);
  return { sources: sources.rows, municipalities: municipalities.rows, procurementTypes: types.rows, recentRuns: recentRuns.rows };
}
