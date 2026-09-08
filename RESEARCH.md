# TenderBase — Research Findings (pre-implementation)

**Date:** 2026-09-08 · All figures measured against live data, not estimated.
**Sample:** complete 31-day OCDS window, 2026-08-09 → 2026-09-08 (1,845 releases).
Raw data + scripts in `/home/user/research/`.

---

## 1. Source availability

| Source | Status | Verdict |
|---|---|---|
| `ocds-api.etenders.gov.za` | **200** | Primary — use it |
| `www.cidb.org.za/tenders.json` | **200** | Secondary — 25 records, cidb's own procurement |
| `registers.cidb.org.za` (i-Tender) | **403** | Blocked, defer |

**The i-Tender block is not spoofable.** 403 on *every* path including `/robots.txt` and
`/favicon.ico`, under full browser headers and HTTP/2. That is a network-layer WAF rule
(geo-match or datacenter-IP reputation), not header inspection. Control: `gov.za` and
`treasury.gov.za` both return 200.

**API mechanics (verified):**
- `dateFrom` / `dateTo` are **required** — omitting → HTTP 400
- Params are PascalCase: `PageNumber` / `PageSize` (`page`/`pageSize` → 400)
- Follow `links.next`; page sizes are erratic (observed 81 → 2 → 1525 on one month)
- Latency ~13–74 s per request

---

## 2. The dataset (31 days, measured)

| Metric | Value |
|---|---|
| Releases | **1,845** (0 duplicates; `tender.id` unique across all) |
| Per publishing day | ~102 |
| Backfill wall time | **4.7 min** (5 weekly chunks, 1 page each) |
| Status | active 1,311 · complete 473 · cancelled 57 · planning 4 |

**Publishing is weekday-only:** Mon 131 · Tue 143 · Wed 137 · Thu 537 · Fri 863 ·
Sat 27 · Sun 7. Thursday/Friday dominate (76%). Weekend polling will find almost nothing.

**Intraday growth confirmed:** the same date returned 137 releases early in the day and
143 later — ~6 new tenders/hour. This validates hourly polling as genuinely useful.

---

## 3. Field quality — what we can and cannot promise

| Field | Coverage | Verdict |
|---|---|---|
| `tenderPeriod.endDate` (closing) | **100%**, zero sentinels | ✅ expiry alerts fully viable |
| `title` / `description` | 100% | ✅ |
| `contactPerson` (+ email) | **100%** | ✅ app currently has 0% — big win |
| `documents` | 99.9% | ✅ |
| `province` | 100% (9 + National) | ✅ |
| `category` | **79 distinct values, 0% "Other"** | ✅ app's 97% "Other" is *their* bug |
| `value.amount` > 0 | **0%** | ❌ drop value filtering entirely |
| CIDB grade (extractable) | 2.3% | ⚠️ enrichment only, never a filter |

**Closing dates:** median lead time **21.4 days** (p10 6.5, p90 33.6). 87.1% have ≥7 days
lead, so the "1 week before expiry" alert works for most; 12.9% are published too late to warn.

**Closing times cluster midday SAST:** 10:00–12:00 UTC (12:00–14:00 SAST) accounts for
~90% of all deadlines. Expiry logic must be **timestamp-aware**, not date-only.

---

## 4. ⚠️ Two findings that change the search design

**a) 92.9% of titles are bare reference codes.**
`0010572182`, `SCMU3-P26/27-EMSCH`, `RFX 60000003542`, `GPAA 08/2026`.
The meaning lives entirely in `description`. Therefore:
- Full-text search **must** cover description (weighted ≥ title)
- Notifications must lead with the description — an email saying "New tender: RFX 60000003542" is useless
- The UI should treat description as the headline, reference code as secondary

**b) Category alone is not enough — use category OR keyword.**
Food/catering example:
- category `Food and beverage service activities` → 42 tenders
- keyword union (cater/canteen/meals/food service) → 38 tenders
- overlap → only **26**; union → **54**

Neither alone works: category-only misses 12, keyword-only misses 16. **Union = +42% recall.**
Stemming adds ~15% for "catering" (catches "CATERERS"); synonyms matter more for
"transport" (+61% via fleet/shuttle/bus service).

---

## 5. Notification design constraints

**"Expiring soon" pool:** 361 tenders close within 7 days, but only **300 are `status=active`**.
46 are already `complete` and 14 `cancelled` — filtering on `status=active` is mandatory, or
~17% of expiry alerts will be dead.

**Noise to exclude** (~10 active entries per month, but they'd reach users):
- "Regret Letter" posts — 12 total, 9 of them `status=active`. These are *unsuccessful-bidder
  notices*, not opportunities. A caterer receiving one as a "new tender" would be confusing.
- Cancellation notices

**Volume reality for narrow filters:** KwaZulu-Natal + food/catering = **6 tenders in 31 days
(~1.4/week)**. Filters must default broad, and the empty state must be handled gracefully.
Low volume makes each alert precious — which argues for high-recall matching (missing one is
worse than a borderline extra).

---

## 6. Idempotency requirements (from hourly polling)

Hourly scans of a rolling 7-day window see each tender ~168 times.
- New-match alerts: unique key `(userId, tenderId, type)` → fires **once, ever**
- Expiry alerts: key on `(userId, tenderId, 'expiring', closingDate)` so an **extended**
  deadline re-arms the timer instead of duplicating or going silent
- Backfill must never notify: gate on `firstSeenAt > filterSet.createdAt`, plus an explicit
  `isBackfill` flag so a 1,845-tender import cannot email anyone

---

## 7. Push + email delivery

**Web Push (VAPID)** is the right choice for a Next.js PWA — no app store, works on Android
and desktop Chrome.
- `web-push` npm package; generate VAPID keys via `npx web-push generate-vapid-keys`
- Service worker handles `push` / `notificationclick`
- **iOS caveat:** requires the user to "Add to Home Screen" first (iOS 16.4+)
- Handle `404`/`410` responses by deleting expired subscriptions

Email: Resend / Postmark / SendGrid are all fine; transactional volume here is low.

Queue the fan-out rather than sending synchronously from the hourly job.

---

## 8. Revised architecture

```
hourly cron
  ├─ ingest: rolling 7-day window, follow links.next, upsert on (source, ocid, releaseId)
  │          skip when contentHash unchanged
  ├─ match:  ONLY tenders with firstSeenAt > lastRun  (~6-10/hour, not all 1,845)
  │          per filter set: category OR keyword (tsvector, description-weighted)
  └─ notify: dedupe on (userId, tenderId, type[, closingDate]) → in-app + push + email

separate: expiry sweep — status=active AND closingDate between now and now+7d
```

Matching only *newly seen* tenders is what keeps this cheap: ~10 tenders × N filter sets per
hour, instead of 1,845 × N.

**No Playwright.** Both sources are plain HTTP JSON — no browser, no `--no-sandbox`,
~500 MB off the Docker image.

---

## 9. What this kills from the original report

Playwright, `--disable-dev-shm-usage`, listing/detail crawl loops, `REQUEST_DELAY_MS`
throttling, `province`/`startDate`/`endDate` guesswork (OCDS provides real values),
multi-context concurrency, and the i-Tender source.

**What it restores:** `tsvector` + GIN full-text search — now essential, because 93% of
titles are meaningless codes and matching is the core product.
