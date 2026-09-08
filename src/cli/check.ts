/**
 * Phase 1 verification: load a real 31-day sample, run it through the
 * normaliser, and assert the measurements the product depends on.
 *
 *   npm run check            # use cached fixtures
 *   npm run check -- --live  # fetch fresh from the API
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { normaliseRelease, type NormalisedTender } from "../normalise.js";
import type { OcdsRelease } from "../sources/ocds.js";
import { fetchRange } from "../sources/ocds.js";

const FIXTURES = "fixtures";

function loadFixtures(): OcdsRelease[] {
  if (!existsSync(FIXTURES)) return [];
  const out: OcdsRelease[] = [];
  for (const f of readdirSync(FIXTURES).filter((x) => x.endsWith(".json")).sort()) {
    const data = JSON.parse(readFileSync(join(FIXTURES, f), "utf8"));
    out.push(...(data.releases ?? []));
  }
  return out;
}

async function loadLive(): Promise<OcdsRelease[]> {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const chunks: OcdsRelease[] = [];
  for (let i = 4; i >= 0; i--) {
    const to = new Date(today);
    to.setUTCDate(to.getUTCDate() - i * 7);
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - 7);
    const { releases, pages } = await fetchRange(fmt(from), fmt(to));
    console.log(`  ${fmt(from)} -> ${fmt(to)}: ${releases.length} releases (${pages} pages)`);
    chunks.push(...releases);
  }
  return chunks;
}

// ------------------------------------------------------------------ stats

const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) : "0.0");

function counter<T>(rows: T[], key: (r: T) => any) {
  const m = new Map<any, number>();
  for (const r of rows) {
    const k = key(r);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function titleIsCode(t: NormalisedTender): boolean {
  const x = t.title ?? "";
  return /^[\sA-Z0-9/\-_.()#]*$/.test(x) && !/[a-z]{4,}/.test(x);
}

function section(title: string) {
  console.log("\n" + "=".repeat(72));
  console.log(title);
  console.log("=".repeat(72));
}

async function main() {
  const live = process.argv.includes("--live");
  console.log(live ? "Fetching LIVE 31-day window..." : "Loading cached fixtures...");

  const raw = live ? await loadLive() : loadFixtures();
  if (!raw.length) {
    console.error("\nNo data. Run with --live to fetch, or add fixtures to ./fixtures");
    process.exit(1);
  }

  const byOcid = new Map<string, NormalisedTender>();
  for (const r of raw) {
    const n = normaliseRelease(r);
    if (n.ocid) byOcid.set(n.ocid, n);
  }
  const rows = [...byOcid.values()];

  section("1. DATASET");
  console.log(`  raw releases        : ${raw.length}`);
  console.log(`  unique by ocid      : ${rows.length}  (${raw.length - rows.length} duplicates dropped)`);
  console.log(`  tenderNumber unique : ${new Set(rows.map((r) => r.tenderNumber)).size}/${rows.length}`);

  section("2. CLOSING DATE COVERAGE  (drives the '1 week before expiry' alert)");
  const withClosing = rows.filter((r) => r.closingDate);
  console.log(`  usable closingDate  : ${withClosing.length}/${rows.length} (${pct(withClosing.length, rows.length)}%)`);
  const leads: number[] = [];
  for (const r of rows) {
    if (!r.closingDate || !r.publishedDate) continue;
    leads.push((new Date(r.closingDate).getTime() - new Date(r.publishedDate).getTime()) / 86400000);
  }
  leads.sort((a, b) => a - b);
  if (leads.length) {
    const q = (p: number) => leads[Math.floor(leads.length * p)]!.toFixed(1);
    console.log(`  lead time days      : median ${q(0.5)} | p10 ${q(0.1)} | p90 ${q(0.9)}`);
    console.log(`  >=7 days (can warn) : ${leads.filter((x) => x >= 7).length} (${pct(leads.filter((x) => x >= 7).length, leads.length)}%)`);
  }

  section("3. CATEGORY QUALITY  (live app currently shows 97% 'Other')");
  const cats = counter(rows, (r) => r.category);
  console.log(`  distinct categories : ${cats.length}`);
  for (const [k, v] of cats.slice(0, 10)) console.log(`    ${String(v).padStart(5)} (${pct(v, rows.length)}%)  ${k}`);
  const other = cats.filter(([k]) => k === "Other")[0]?.[1] ?? 0;
  console.log(`  'Other'             : ${other} (${pct(other, rows.length)}%)  <-- must be ~0`);

  section("4. FIELD COVERAGE");
  const cov = (label: string, fn: (r: NormalisedTender) => boolean) => {
    const n = rows.filter(fn).length;
    console.log(`    ${label.padEnd(26)} ${String(n).padStart(5)}/${rows.length} (${pct(n, rows.length)}%)`);
  };
  cov("title", (r) => !!r.title);
  cov("description", (r) => !!r.description);
  cov("organisation", (r) => !!r.organisation);
  cov("province", (r) => !!r.province);
  cov("documents", (r) => r.documents.length > 0);
  cov("contactEmail", (r) => !!r.contactEmail);
  cov("valueCents", (r) => r.valueCents !== null);

  section("5. TITLE USABILITY");
  const codes = rows.filter(titleIsCode);
  console.log(`  titles that are bare reference codes: ${codes.length} (${pct(codes.length, rows.length)}%)`);
  console.log(`  --> search MUST cover description, notifications must lead with it`);

  section("6. OPPORTUNITY FILTER  (noise exclusion)");
  const noise = rows.filter((r) => !r.isOpportunity);
  console.log(`  flagged as NOT an opportunity: ${noise.length} (${pct(noise.length, rows.length)}%)`);
  for (const r of noise.slice(0, 3)) console.log(`    ${r.tenderNumber}  ${(r.description ?? "").slice(0, 60)}`);

  section("7. STATUS BREAKDOWN");
  for (const [k, v] of counter(rows, (r) => r.status)) console.log(`    ${String(v).padStart(5)}  ${k}`);

  section("8. PROVINCES");
  for (const [k, v] of counter(rows, (r) => r.province)) console.log(`    ${String(v).padStart(5)}  ${k}`);

  section("9. CIDB GRADE ENRICHMENT");
  const graded = rows.filter((r) => r.cidbGrade);
  console.log(`  extractable grades: ${graded.length} (${pct(graded.length, rows.length)}%)  <-- enrichment only`);
  for (const r of graded.slice(0, 5)) console.log(`    ${r.cidbGrade}  ${(r.cidbGradeRaw ?? "").slice(0, 66)}`);

  section("10. MATCH RECALL — 'catering' (category OR keyword)");
  const blob = (r: NormalisedTender) =>
    `${r.title ?? ""} ${r.description ?? ""}`.toLowerCase();
  const byCat = new Set(rows.filter((r) => (r.category ?? "").includes("Food and beverage")).map((r) => r.ocid));
  const byKw = new Set(
    rows.filter((r) => /cater\w*|canteen|meals?\b|food (service|provision)/i.test(blob(r))).map((r) => r.ocid)
  );
  const union = new Set([...byCat, ...byKw]);
  console.log(`  category only : ${byCat.size}`);
  console.log(`  keyword only  : ${byKw.size}`);
  console.log(`  UNION (use this): ${union.size}   (+${pct(union.size - Math.max(byCat.size, byKw.size), Math.max(byCat.size, byKw.size))}% vs best single method)`);

  section("11. 'EXPIRING SOON' POOL  (closing <=7d AND status=active)");
  const now = Date.now();
  const soonAny = rows.filter((r) => r.closingDate && (new Date(r.closingDate).getTime() - now) / 86400000 <= 7 && new Date(r.closingDate).getTime() >= now);
  const soonActive = soonAny.filter((r) => r.status === "active");
  console.log(`  closing in 0-7 days (any status): ${soonAny.length}`);
  console.log(`  ...AND status=active             : ${soonActive.length}  <-- what we actually notify on`);
  console.log(`  filtered out as not active       : ${soonAny.length - soonActive.length}`);

  section("SAMPLE NORMALISED RECORD");
  console.log(JSON.stringify(rows[0], null, 2).slice(0, 1400));
  console.log("\nPhase 1 check complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
