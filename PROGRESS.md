# TenderBase Pipeline — Build Progress & Live Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Data path: fetch + normalise + verify | ✅ DONE |
| 2 | Postgres + Prisma schema + idempotent upsert | ✅ DONE |
| 3 | Fastify API matching the TenderBase contract | ✅ DONE |
| 4 | Matching engine + notification dedup | ✅ DONE |
| 5 | Docker + render.yaml + README | ✅ DONE |
| Live | Free Render + Neon DB + GitHub Actions cron (:17 hourly) | ✅ LIVE |

> **Current Operational State:**
> The system is **100% deployed and live** ("Nothing left for you to click").
> Automated cron runs at **:17 every hour** via GitHub Actions (`.github/workflows/hourly.yml`) to fetch new tenders, run filter matching, and dispatch notifications.
> API served via Render, DB on Neon Postgres.

---

## Optional Extras (Post-Deployment Options)

Two optional extra tasks are available whenever desired:

1. **31-day backfill from laptop:**
   - Command: `DATABASE_URL="..." DIRECT_URL="..." npm run backfill:prod`
   - Safe and idempotent (uses SHA256 content-hash check in `upsertTender`).
   - Deepens history beyond the 7-day rolling window to 31+ days (~1,845 releases).
   - Recommended to run from laptop to bypass sandboxed/CI egress throttling.

2. **VAPID keys for push notifications:**
   - Generate keys via `npx web-push generate-vapid-keys`.
   - Add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` to repository secrets (**Settings → Secrets and variables → Actions**) and Render environment variables.
   - Enables Web Push notifications for new tender matches and 7-day expiry warnings.

---

## Phase 1 — Data path (DONE)

- `src/config.ts`, `src/sources/ocds.ts` (retry/backoff, follows `links.next`,
  never stops on a small page), `src/normalise.ts`, `src/cli/check.ts`
- `fixtures/` — real 31-day sample (1,845 releases) committed for reproducible tests
- Verified: closingDate **100%** · categories **79 distinct, 0% "Other"** ·
  contactEmail **100%** · titles that are bare codes **92.9%** · CIDB grades 2.3%

## Phase 2 — Postgres + persistence (DONE)

- PostgreSQL 17.11 locally; Prisma **6.19.3**
- `Tender`, `TenderDocument`, `ScraperRun`, `ScraperError`; unique `(source, ocid, releaseId)`
- GIN **expression** index weighted `description=A, title=B, organisation=C`
  (description highest because 92.9% of titles are meaningless codes)
- Idempotency proven: run 1 → 1,845 inserted; run 2 → **0 inserted, 0 updated, 1,845 unchanged**
- DB: **1,845 tenders / 1,844 documents** · expiring-soon pool **351**

## Phase 3 — API (DONE)

- `src/api/serialise.ts` — DB row → exact live-app contract
- `src/api/tenders.ts` — parameterised raw SQL + batched document fetch
- `src/api/server.ts` — Fastify; helmet, CORS, optional API key, Zod validation
- `src/cli/serve.ts` — entrypoint
- `scripts/contract_test.ts` — compares our shape against the **live** app

**Contract test: ALL CHECKS PASSED**

Working endpoints:
```
GET /health
GET /tenders?page&limit&perPage&q|search&province&category&status&closingBefore&constructionOnly&sort
GET /tenders/:id
```

---

## Phase 4 — Matching + notifications (DONE) ← the core product

A user sets a filter set → a matching tender arrives → in-app + push + email,
plus a warning 1 week before expiry.

- `FilterSet`, `Notification`, `PushSubscription` tables
- Shared FTS search expression `SEARCH_EXPR`
- Category OR Keyword union matching (+28.6% recall)
- Deduplication keys (`new_match` fires once ever; `expiring` includes `closingDate` for deadline re-arming)
- Backfill guard via `lastMatchedAt` cursor

**Acceptance test — ALL PHASE 4 CHECKS PASSED**

---

## Phase 5 — Deploy packaging & Free-Tier Rework (DONE)

- `src/pipeline/ingest.ts` — shared ingestion pipeline
- `src/cli/hourly.ts` — hourly loop (`npm run hourly:prod`)
- `.github/workflows/hourly.yml` — scheduled cron at `:17` UTC
- `schema.prisma` with `directUrl = env("DIRECT_URL")` for Neon PgBouncer support
- 3-stage `Dockerfile` and `render.yaml` for free tier deployment

---

## Live Status & Maintenance Notes

- System went live on Render + Neon DB + GitHub Actions cron.
- Retries hardened against SITA DNS flaps (`src/sources/ocds.ts`).
- Workflow self-validates on merges to `main`.
