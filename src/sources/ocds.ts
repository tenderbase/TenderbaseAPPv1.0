import {
  OCDS_BASE,
  USER_AGENT,
  REQUEST_TIMEOUT_MS,
  MAX_RETRIES,
  MAX_PAGES,
  REQUEST_DELAY_MS,
} from "../config.js";

// The OCDS feed is loosely typed and the API is genuinely erratic:
//   - `dateFrom`/`dateTo` are REQUIRED (omitting them -> HTTP 400)
//   - params are PascalCase (`page`/`pageSize` -> HTTP 400)
//   - page sizes vary wildly (observed 81 -> 2 -> 1525 on a single month),
//     so a small page is NOT the end. Always follow `links.next`.
export interface OcdsRelease {
  ocid?: string;
  id?: string;
  date?: string;
  tag?: string[];
  tender?: Record<string, any>;
  buyer?: { id?: string; name?: string };
  parties?: any[];
  awards?: any[];
  contracts?: any[];
  [key: string]: any;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await sleep(1000 * Math.pow(2, attempt - 1));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`OCDS fetch failed after ${MAX_RETRIES} attempts: ${String(lastErr)}`);
}

export interface FetchRangeResult {
  releases: OcdsRelease[];
  pages: number;
}

/**
 * Fetch every release in [dateFrom, dateTo], following `links.next` to exhaustion.
 * Never stops on a small page — page sizes are not uniform.
 */
export async function fetchRange(
  dateFrom: string,
  dateTo: string,
  onPage?: (page: number, count: number) => void
): Promise<FetchRangeResult> {
  const releases: OcdsRelease[] = [];
  const seen = new Set<string>();
  let pages = 0;
  let url: string | undefined =
    `${OCDS_BASE}?PageNumber=1&PageSize=1000&dateFrom=${dateFrom}&dateTo=${dateTo}`;

  while (url && !seen.has(url) && pages < MAX_PAGES) {
    seen.add(url);
    pages++;
    const data = await getJson(url);
    const batch: OcdsRelease[] = data?.releases ?? [];
    releases.push(...batch);
    onPage?.(pages, batch.length);
    url = data?.links?.next;
    if (url && REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS);
  }
  return { releases, pages };
}
