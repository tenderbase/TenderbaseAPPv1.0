// Central configuration. Every value here was validated against the live API
// during research — see /home/user/RESEARCH.md for the measurements behind them.

export const OCDS_BASE = "https://ocds-api.etenders.gov.za/api/OCDSReleases";

// Identify ourselves honestly: the feed is public open data and we are polite.
export const USER_AGENT =
  "TenderBase/0.1 (+https://tenderbase-web.onrender.com) node-fetch";

// The eTender portal page a tender "comes from". Matches what the live
// TenderBase app already returns in `sourceUrl`, so the contract stays stable.
export const SOURCE_URL = "https://www.etenders.gov.za/Home/opportunities";

// The API is slow (13-74s measured). Generous timeout, few retries.
export const REQUEST_TIMEOUT_MS = 120_000;

// Two-tier retry policy (see getJson in src/sources/ocds.ts).
//
// HTTP errors (400/503/...) rarely fix themselves: 3 attempts, 1-2s apart.
export const HTTP_RETRY_DELAYS_MS = [1_000, 2_000];

// Network-level errors usually DO fix themselves. The authoritative
// nameservers for etenders.gov.za (SITA, 164.151.132.39/.40) flap in bursts —
// observed 2026-09-08: Google DNS logged "Name servers did not respond" at
// 21:08 UTC, and the same server answered cleanly at 21:12. A failed lookup
// returns instantly, so quick retries all land inside the same bad moment;
// spread up to 6 attempts over ~2.5 minutes instead.
export const NET_RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 40_000, 60_000];

// Hard ceiling for ONE page fetch, so a hanging endpoint (accepts the
// connection but never responds) cannot eat the Actions job's 20-minute
// budget. A normal page takes 13-74s, so 9 minutes is ~7x the worst observed.
export const GET_JSON_DEADLINE_MS = 9 * 60_000;

export const MAX_PAGES = 30;
export const REQUEST_DELAY_MS = 500;

// Rolling window used by the hourly job. 7 days (rather than 1) because
// Treasury occasionally publishes releases dated several days back.
export const ROLLING_WINDOW_DAYS = 7;

// One-off backfill depth, per the product decision to focus on recent tenders.
export const BACKFILL_DAYS = 31;
