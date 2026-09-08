import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fetchRange, type OcdsRelease } from "./sources/ocds.js";

const FIXTURES = "fixtures";

/** Load cached raw OCDS payloads (one file per weekly chunk). */
export function loadFixtures(): OcdsRelease[] {
  if (!existsSync(FIXTURES)) return [];
  const out: OcdsRelease[] = [];
  for (const f of readdirSync(FIXTURES).filter((x) => x.endsWith(".json")).sort()) {
    const data = JSON.parse(readFileSync(join(FIXTURES, f), "utf8"));
    out.push(...(data.releases ?? []));
  }
  return out;
}

const fmt = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Fetch the last `days` of releases in weekly chunks.
 *
 * Weekly (not monthly) because a 31-day backfill measured 4.7 minutes this way,
 * each chunk completing on a single page. Following `links.next` inside each
 * chunk keeps us correct if that ever changes.
 */
export async function fetchWindow(days = 31, chunkDays = 7) {
  const today = new Date();
  const ranges: Array<[string, string]> = [];
  for (let offset = 0; offset < days; offset += chunkDays) {
    const to = new Date(today);
    to.setUTCDate(to.getUTCDate() - offset);
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - chunkDays);
    ranges.push([fmt(from), fmt(to)]);
  }
  ranges.reverse();

  const releases: OcdsRelease[] = [];
  let pages = 0;
  for (const [from, to] of ranges) {
    const res = await fetchRange(from, to);
    pages += res.pages;
    releases.push(...res.releases);
    console.log(`  ${from} -> ${to}: ${res.releases.length} releases (${res.pages} pages)`);
  }
  return { releases, pages, ranges };
}
