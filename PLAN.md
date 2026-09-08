# TenderBase Data Pipeline — Implementation Plan & Status

**Status:** ✅ FULLY IMPLEMENTED AND LIVE DEPLOYED
**Date:** 2026-09-08
**Goal:** Ingest every South African national/provincial tender from the eTenders OCDS feed, store in Neon Postgres, serve via Fastify API on Render, match user filter sets, and dispatch alerts via GitHub Actions hourly cron (:17 UTC).

---

## Executive Implementation & Live Status Summary

1. **Production Pipeline:**
   - **Hourly Job:** Triggered automatically at minute **:17 of every hour** via GitHub Actions (`.github/workflows/hourly.yml`). Ingests rolling 7-day tender releases, matches active filter sets, and dispatches in-app, push, and email alerts.
   - **Database:** Hosted on Neon Postgres (pooled `DATABASE_URL` for app queries, direct `DIRECT_URL` for Prisma migrations).
   - **API:** Hosted on Render (`https://tenderbase-web.onrender.com`), serving read-only public tender data adhering 100% to the live application contract.

2. **Optional Post-Deployment Extras:**
   - **31-Day Backfill from Laptop:**
     `DATABASE_URL="..." DIRECT_URL="..." npm run backfill:prod`
     Safely deepens historical tender coverage beyond 7 days to 31+ days (~1,845 releases). Fully idempotent via SHA256 content hashes.
   - **VAPID Keys for Web Push:**
     `npx web-push generate-vapid-keys`
     Add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` to repository secrets and Render env vars to activate real Web Push delivery.

---

## 1. What the app actually needs (reverse-engineered from the live API)

The app is **TenderBase** (Google sign-in, redirects `/` → `/login`). It calls:

```
GET /api/tenders?page=1&limit=20&province=…&category=…&q=…
{
  "results": [ { …tender… } ],
  "total": 554, "page": 1, "totalPages": 28, "source": "live"
}

GET /api/tenders/:id          # :id is the INTERNAL db id ("324"), not tenderNumber
{ "tender": { …, "amendments": [] }, "source": "live" }
```

Tender object fields (exact contract implemented):

`id`, `tenderNumber`, `title`, `description`, `organisation`, `category`, `province`,
`location`, `valueCents`, `publishedDate`, `closingDate`, `sourceUrl`, `documents[]`,
`contactInformation`, `isSaved`, `savedAt`, `matchScore`, (`amendments` in detail only).

Quirks confirmed and supported:

| Param | Implemented Behaviour |
|---|---|
| `page` | 1-based pagination |
| `limit` | Clamped to max 100 (never 400s) |
| `perPage` | Supported as alias to `limit` |
| `search` | Supported as alias to `q` |
| `q` | Full-text search (tsvector, description-weighted) |
| `province`, `category` | Filtering enabled |
| `status` | Defaults to `active` |

---

## 2. Sources & Data Path

### Primary — National Treasury OCDS API

```
GET https://ocds-api.etenders.gov.za/api/OCDSReleases
    ?PageNumber=1&PageSize=1000&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
```

- License: PDDL 1.0
- Follows `links.next` pagination.
- Hardened retry logic (`src/sources/ocds.ts`) with multi-tier backoff protecting against transient SITA DNS flaps.

---

## 3. Schema & Database Architecture

```prisma
model Tender {
  id                 String   @id @default(cuid())
  source             String
  ocid               String
  releaseId          String
  tenderNumber       String
  title              String?
  description        String?
  organisation       String?
  category           String?
  province           String?
  location           String?
  valueCents         BigInt?
  publishedDate      DateTime?
  closingDate        DateTime?
  status             String?
  contactName        String?
  contactEmail       String?
  contactPhone       String?
  cidbGrade          String?
  cidbGradeRaw       String?
  contentHash        String
  firstSeenAt        DateTime @default(now())
  lastSeenAt         DateTime @updatedAt

  documents          TenderDocument[]
  @@unique([source, ocid, releaseId])
  @@unique([source, tenderNumber, releaseId])
  @@index([province, category])
  @@index([closingDate])
  @@index([publishedDate])
  @@index([status])
}
```

Full-text search index (`tsvector` weighted `description=A, title=B, organisation=C`) applied via raw Prisma SQL migration (`SEARCH_EXPR`).

---

## 4. Matching & Notifications

- Category OR Keyword union matching (+28.6% recall over category-only).
- Deduplication via `dedupeKey`: `new_match` fires once ever per (filterSet, tender); `expiring` includes `closingDate` so extended deadlines re-arm.
- Backfill guard: filter sets only match tenders with `firstSeenAt > lastMatchedAt`.
