# TenderBase Data Pipeline — Plan v3 (final)

**Status:** PLAN ONLY — no code written.
**Date:** 2026-09-08 · Supersedes v1 and v2.
**Goal:** every tender, in a Postgres DB, served by an API that feeds
`https://tenderbase-web.onrender.com`.

---

## 1. What the app actually needs (reverse-engineered from the live API)

The app is **TenderBase** (Google sign-in, redirects `/` → `/login`). It already calls a
live API, so the contract is **already fixed** — we don't get to invent it.

```
GET /api/tenders?page=1&limit=20&province=…&category=…&q=…
{
  "results": [ { …tender… } ],
  "total": 554, "page": 1, "totalPages": 28, "source": "live"
}

GET /api/tenders/:id          # :id is the INTERNAL db id ("324"), not tenderNumber
{ "tender": { …, "amendments": [] }, "source": "live" }
```

Tender object fields (exact names — our schema should mirror these):

`id`, `tenderNumber`, `title`, `description`, `organisation`, `category`, `province`,
`location`, `valueCents`, `publishedDate`, `closingDate`, `sourceUrl`, `documents[]`,
`contactInformation`, `isSaved`, `savedAt`, `matchScore`, (+ `amendments` in detail only).

Quirks confirmed by probing the live app:

| Param | Behaviour |
|---|---|
| `page` | ✅ works |
| `limit` | ✅ works |
| `perPage` | ❌ **ignored** (still returns 20) |
| `search` | ❌ **ignored** |
| `q` | ✅ works (full-text) |
| `province`, `category` | ✅ work |
| `status` | ❌ ignored |
| max page size | capped at **100** (`limit=1000` → 100 rows) |

### Current state of the app's data — and the gaps we can close

| Metric | App today (554 rows) | What our pipeline gives |
|---|---|---|
| History | **6 days** (2026-09-03 → 09-08) | **31+ months** |
| `category` | **97% "Other"** | real OCDS categories (`Construction`, `Civil engineering`, `Services: Professional`, …) |
| `contactInformation` | **0% populated** | populated from `tender.contactPerson` |
| `valueCents` | **0% populated** | mostly still null — OCDS `value.amount` is nearly always `0` |
| `documents` | 99% populated | 99% populated |

The 97% "Other" is the biggest win: the OCDS feed carries a rich `category` field that the
current ingestion is throwing away.

**Also confirmed:** `tenderNumber` in the app (`"169173"`) **is** the OCDS `tender.id`.
Same source, same identifiers — so this is a clean drop-in replacement, not a migration.

---

## 2. Sources

### Primary — National Treasury OCDS API (all tenders, as requested)

```
GET https://ocds-api.etenders.gov.za/api/OCDSReleases
    ?PageNumber=1&PageSize=1000&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
```

- Live (`publishedDate: 2026-09-08T15:16:25Z` on the day of testing), HTTP 200
- `dateFrom` / `dateTo` are **required** — omitting them returns HTTP 400
- Params are `PageNumber` / `PageSize` (PascalCase — `page`/`pageSize` returns 400)
- License: PDDL 1.0 — commercial use and republication permitted with attribution
- OpenAPI: `https://ocds-api.etenders.gov.za/swagger/v1/swagger.json`
- ~137 releases/day · provinces, `tenderPeriod.endDate` (closing date), `contactPerson`,
  `documents`, `briefingSession`, `specialConditions`

### ⚠️ Three API landmines found while testing

1. **Pagination is erratic.** June 2026 returned **81** releases on page 1, **2** on page 2,
   then **1525** on page 3. Page sizes are not uniform and a tiny page is **not** the end.
   → Backfill **must** follow `links.next` until exhausted; never stop on a small page.
2. **Latency is high and per-page.** 18–24 s per request, roughly fixed cost.
   → One call per day for deltas; never shard a single day across pages.
3. **Bulk monthly files are broken.** `data.etenders.gov.za/Home/DownloadFile/?fileName=01MMYYYY.json`
   returns a *single arbitrary page* of that month, in PascalCase, with `Releases` counts
   ranging 0–1733 across months.
   → **Unusable for complete backfill.** Paginate the API instead.

### Secondary — `cidb.org.za/tenders.json` (25 records, cidb's own procurement)

Still live and unblocked. Minor; include as a second adapter behind the same interface.
Note: 22 of 25 are already `Awarded`, and it has **no** province or closing date.

### Not used — i-Tender register (blocked)

`registers.cidb.org.za` returns 403 on **every** path including `/robots.txt` and
`/favicon.ico`, under full browser headers and HTTP/2 — a network-layer WAF block, not
header inspection. Only fixable with SA egress (ZA residential proxy ~$1–8/GB, or AWS
`af-south-1`). Deferred: the OCDS feed is broader and already covers the same universe.

---

## 3. Field mapping (OCDS → app contract)

| App field | OCDS source | Notes |
|---|---|---|
| `tenderNumber` | `tender.id` | ✅ matches app's existing values exactly |
| `title` | `tender.title` | |
| `description` | `tender.description` | |
| `organisation` | `buyer.name` → `procuringEntity.name` | fallback chain |
| `category` | `tender.category` | **the big fix** — replaces 97% "Other" |
| `province` | `tender.province` | Gauteng, KwaZulu-Natal, National, … |
| `location` | `tender.deliveryLocation` | free-text string |
| `valueCents` | `tender.value.amount` × 100 | usually `0` → store null |
| `publishedDate` | `release.date` | date part only |
| `closingDate` | `tender.tenderPeriod.endDate` | ISO-8601 |
| `sourceUrl` | constant `https://www.etenders.gov.za/Home/opportunities` | matches current app |
| `documents[]` | `tender.documents[]` | `name←title`, `url←url`, `isAddendum←false`, `fileType` from extension |
| `contactInformation` | `tender.contactPerson` | `{name, email, telephoneNumber}` |
| `amendments` | not present in feed | return `[]` |
| `isSaved` / `savedAt` / `matchScore` | **not ours** | per-user state, lives behind the app's auth |
| `source` | literal `"live"` | |

**Extra fields we can add** (not in the current contract, but the feed supports them and
the report asked for them): `ocid`, `status`, `procurementMethod`, `briefingSession`,
`cidbGrade`, `contentHash`, `firstSeenAt`/`lastSeenAt`.

**CIDB grade enrichment:** grades appear in free text only, e.g.
`"Only tenderers with CIDB Grading of 5CE or higher are eligible"` — 13/416 releases in a
sample week, 9 with an extractable grade (`5CE`, `8CE`, `4SQ`, `3GB`, `4GB`).
Regex-extract into `cidbGrade` + keep `cidbGradeRaw`. **~2% recall — best-effort, not a filter.**

---

## 4. Schema

```prisma
model Tender {
  id                 String   @id @default(cuid())   // app-facing :id
  source             String                          // "OCDS" | "CIDB_OWN"
  ocid               String
  releaseId          String
  tenderNumber       String                          // OCDS tender.id — app's key
  title              String?
  description        String?
  organisation       String?
  category           String?
  province           String?
  location           String?
  valueCents         BigInt?                         // null when amount == 0
  publishedDate      DateTime?
  closingDate        DateTime?
  status             String?                         // active|complete|cancelled|planning
  contactName        String?
  contactEmail       String?
  contactPhone       String?
  cidbGrade          String?
  cidbGradeRaw       String?
  contentHash        String
  firstSeenAt        DateTime @default(now())
  lastSeenAt         DateTime @updatedAt

  documents   TenderDocument[]
  @@unique([source, ocid, releaseId])
  @@unique([source, tenderNumber, releaseId])
  @@index([province, category])
  @@index([closingDate])
  @@index([publishedDate])
  @@index([status])
}

model TenderDocument {
  id          String  @id @default(cuid())
  tenderId    String
  name        String?
  fileType    String?
  url         String
  isAddendum  Boolean @default(false)
  tender      Tender  @relation(fields: [tenderId], references: [id])
  @@index([tenderId])
}
```

At ~50k rows/year, **full-text search is now justified** — add the generated `tsvector`
column + GIN index on `title ‖ description ‖ organisation` for the `q` parameter.
(It was overkill for the 25-row cidb source; it isn't here.)

Plus the observability tables from the report: `ScraperRun`, `ScraperError`,
and a new `BackfillState` for resumable backfill.

**No Playwright anywhere.** Both sources are plain HTTP JSON — no browser, no
`--no-sandbox`, ~500 MB off the Docker image.

---

## 5. Ingestion

### Backfill (one-off, ~31 months)

**Resumable and month-at-a-time.** For each month, walk `links.next` from `PageNumber=1`
until exhausted, upserting as you go. Checkpoint progress in `BackfillState` after each
page so an interrupted run resumes instead of restarting.

Why month-at-a-time: at 18–24 s per page and an unknown (erratic) number of pages per
month, a single 31-month sweep would run 1–2 hours and risk hitting platform job limits.
One month per invocation is restartable and observable.

Rules: never stop on a small page (81 → 2 → 1525), always follow `links.next`,
and treat a page with 0 releases **and** no `links.next` as the true end.

### Incremental (daily cron)

One call per day: `dateFrom = dateTo = yesterday`. ~137 releases, ~28 s.
Upsert on `(source, ocid, releaseId)`; skip writes when `contentHash` is unchanged —
OCDS republishes releases, so change detection matters.

Politeness: this is a government open-data API, so `REQUEST_DELAY_MS`-style throttling is
unnecessary. Do add retry-with-backoff and a hard timeout per request.

---

## 6. API

Mirror the existing contract **exactly** so the app needs zero changes:

- `GET /api/tenders` — `page`, `limit` (cap 100), `province`, `category`, `q`,
  optional `closingBefore`, `constructionOnly`. Returns `{results,total,page,totalPages,source}`
- `GET /api/tenders/:id` — returns `{tender, source}` incl. `amendments`
- `GET /health`
- API-key middleware, CORS locked to the TenderBase origins, Zod validation, helmet

Keep `perPage` and `search` working **as aliases** even though the current API ignores
them — harmless, and it avoids a trap if the app starts sending them.

`isSaved` / `savedAt` / `matchScore` return defaults (`false` / `null`); they're per-user
and belong to the app's authenticated layer.

---

## 7. Build phases

**Phase 1 — prove the data path (no DB)**
1. Fetch one day of OCDS releases → commit as `tests/fixtures/ocds-day.json`
2. Write the normaliser: release → app-shaped row (categories, contacts, CIDB regex, dates)
3. Print stats vs the app's current data: category spread, contact coverage, date range

**Phase 2 — persist**
4. Prisma schema + migration (+ `tsvector`/GIN)
5. Resumable monthly backfill walker
6. Daily delta job with content-hash skip

**Phase 3 — serve**
7. Fastify API matching the contract above
8. Contract tests asserting our response shape equals the live app's shape

**Phase 4 — ship**
9. Fixture-based unit + integration tests
10. Dockerfile (Node 20 slim, no browser), `render.yaml`, README

---

## 8. Open questions

1. **Cutover:** is our API meant to *replace* the app's current backend (point it at our
   Neon DB), or sit alongside as a second source?
2. **User state:** `isSaved` / `matchScore` imply per-user saved tenders and matching. Does
   our API stay read-only public data, with the app merging user state? (My recommendation.)
3. **Depth:** backfill the full 31 months (~50k rows), or start with a recent window
   (e.g. 6 months) and extend once the pipeline is proven?
4. **Stack:** Node/TS + Prisma (report's choice) vs Python + FastAPI/SQLAlchemy?
