// Central configuration. Every value here was validated against the live API
// during research — see /home/user/RESEARCH.md for the measurements behind them.

// National Treasury documents the release endpoint with this exact path casing.
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
export const HTTP_RETRY_DELAYS_MS = [1_000, 2_000];

// Network-level errors usually DO fix themselves. Spread retries over time.
export const NET_RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 40_000, 60_000];

// Hard ceiling for ONE page fetch.
export const GET_JSON_DEADLINE_MS = 9 * 60_000;

export const MAX_PAGES = 30;
export const REQUEST_DELAY_MS = 500;

// Rolling window used by the hourly job. 7 days because Treasury occasionally
// publishes releases dated several days back.
export const ROLLING_WINDOW_DAYS = 7;

// One-off backfill depth, per the product decision to focus on recent tenders.
export const BACKFILL_DAYS = 31;
