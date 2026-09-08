import {
  OCDS_BASE,
  USER_AGENT,
  REQUEST_TIMEOUT_MS,
  HTTP_RETRY_DELAYS_MS,
  NET_RETRY_DELAYS_MS,
  GET_JSON_DEADLINE_MS,
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

/**
 * Flatten an error chain into one readable line. undici wraps the real cause
 * (e.g. `ENOTFOUND`) inside `TypeError: fetch failed`.cause — printing only
 * the wrapper is how a DNS outage masquerades as an opaque "fetch failed".
 */
function describeError(err: unknown): string {
  const parts: string[] = [];
  for (let e: any = err; e && parts.length < 5; e = e.cause) {
    parts.push(e.code ? `${e.code}: ${e.message}` : `${e.name}: ${e.message ?? e}`);
  }
  return parts.join(" <- ") || String(err);
}

/**
 * GET one page as JSON with a two-tier retry policy:
 *
 *  - HTTP errors (400/503/...) rarely fix themselves: 3 attempts, 1-2s apart.
 *  - Network errors (DNS/TCP/TLS) usually do — the .gov.za nameservers flap
 *    in bursts of seconds-to-minutes, and a failed lookup returns instantly,
 *    so the old 3x1-2s schedule burned every attempt inside one bad moment.
 *    Network failures get up to 6 attempts spread over ~2.5 minutes.
 *
 * A per-page deadline caps both paths so a hanging endpoint cannot consume
 * the Actions job's 20-minute budget.
 */
async function getJson(url: string): Promise<any> {
  const deadline = Date.now() + GET_JSON_DEADLINE_MS;
  let attempts = 0;
  let httpFails = 0;
  let netFails = 0;
  const seen = new Set<string>(); // distinct failures, for the final message

  for (;;) {
    attempts++;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: ac.signal,
      });
      if (res.ok) return await res.json();

      // HTTP tier, counted separately so a flapping 503 does not eat the
      // (much longer) network budget.
      const err = new Error(`HTTP ${res.status} for ${url}`);
      seen.add(describeError(err));
      const wait = HTTP_RETRY_DELAYS_MS[httpFails++];
      if (wait === undefined || Date.now() + wait > deadline) break;
      await sleep(wait);
    } catch (err) {
      // Network tier: DNS lookups, TCP connects, TLS handshakes, timeouts.
      seen.add(describeError(err));
      const wait = NET_RETRY_DELAYS_MS[netFails++];
      if (wait === undefined || Date.now() + wait > deadline) break;
      await sleep(wait);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    `OCDS fetch failed after ${attempts} attempt(s) ` +
      `(${httpFails} http, ${netFails} network): ${[...seen].join(" | ")}`
  );
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
