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
export const MAX_RETRIES = 3;
export const MAX_PAGES = 30;
export const REQUEST_DELAY_MS = 500;

// Rolling window used by the hourly job. 7 days (rather than 1) because
// Treasury occasionally publishes releases dated several days back.
export const ROLLING_WINDOW_DAYS = 7;

// One-off backfill depth, per the product decision to focus on recent tenders.
export const BACKFILL_DAYS = 31;
