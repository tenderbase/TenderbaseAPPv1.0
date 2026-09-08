# TenderBase — tender pipeline & API

Ingests **every** South African national/provincial tender published on the
eTenders OCDS feed into Postgres, serves them through an API that mirrors the
contract the live app already consumes, and notifies users when a tender
matching their saved filters arrives — or a week before it expires.

```
eTenders OCDS API ──hourly (:17)──▶ Postgres (Neon) ──▶ Fastify API (Render) ──▶ tenderbase-web
                                         │
                                         └──▶ matcher ──▶ in-app + push + email
```

The point of the product: **stop people missing out on tender opportunities.**

---

## Status & Operational State

- **Status:** **LIVE & AUTOMATED** 🚀
- **Cron Schedule:** GitHub Actions runs `.github/workflows/hourly.yml` at **:17 every hour** to ingest rolling 7-day tenders, match filters, and dispatch notifications.
- **Nothing left to click** — core ingestion, matching, and API endpoints are operating automatically.

---

## Optional Extras (Whenever You Feel Like It)

Two optional post-deployment enhancements can be configured at any time:

### 1. 31-Day Backfill from Your Laptop

Deepen history beyond the default 7-day rolling window:

```bash
DATABASE_URL="postgresql://user:pass@ep-pooler.region.aws.neon.tech/neondb?sslmode=require" \
DIRECT_URL="postgresql://user:pass@ep-direct.region.aws.neon.tech/neondb?sslmode=require" \
npm run backfill:prod
```

- **Safe & Idempotent:** Uses `upsertTender` with SHA256 content hashes — running it multiple times writes zero duplicate entries and skips unchanged rows.
- **Why from laptop:** Sandboxed CI or cloud agent environments can hit egress or rate constraints. Running locally connects directly to Neon and backfills the full 31-day history (~5 weekly chunks, ~1,845 releases) reliably.

### 2. VAPID Keys for Web Push Notifications

Wire up browser Web Push notifications:

```bash
npx web-push generate-vapid-keys
```

Add the generated keys as repository secrets (**GitHub Settings → Secrets and variables → Actions**) and Render environment variables:
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` (e.g. `mailto:ops@tenderbase.example`)

When configured, matching tenders and 7-day expiry alerts will trigger real-time browser push notifications (iOS requires PWA added to Home Screen).

---

## Quickstart (local)

Requires Node 20+ and a local Postgres.

```bash
cp .env.example .env          # then point DATABASE_URL at your Postgres
npm install
npx prisma migrate deploy     # create the schema (+ the FTS index)
npm run backfill              # one-off: last 31 days from the live API
npm run serve                 # http://localhost:3000/health
```

Offline, without touching the network:

```bash
npm install && npx prisma migrate deploy
npm run ingest                # replays the 1,845 fixtures in fixtures/
npm run serve
```

### Local Postgres (Linux)

```bash
sudo service postgresql start
sudo -u postgres psql -c "CREATE ROLE tenderbase LOGIN PASSWORD 'tenderbase' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE tenderbase OWNER tenderbase;"
```

`CREATEDB` matters — Prisma creates a shadow database for `migrate dev`.

---

## Commands

| Command | What it does |
|---|---|
| `npm run serve` | Start the API (default port 3000, `PORT` to override) |
| `npm run hourly` | **The core loop:** ingest rolling window → match → dispatch |
| `npm run hourly -- --match-only` | Skip the network; match and dispatch only |
| `npm run build` | Compile TypeScript to `dist/` — used by production |
| `npm run start` | Run the **compiled** API (`node dist/cli/serve.js`) — what Render runs |
| `npm run hourly:prod` | Run the **compiled** hourly loop — what GitHub Actions runs |
| `npm run backfill:prod` | Compiled 31-day backfill (safe to run from laptop with Neon URLs) |
| `npm run backfill` | One-off 31-day backfill from the live API |
| `npm run ingest` | Replay cached fixtures (no network) |
| `npm run ingest -- --live --days 7` | Fetch a fresh window |
| `npm run notify` | Match + dispatch without ingesting |
| `npm run notify -- --seed` | Create a demo filter set and simulate arrivals |
| `npm run notify -- --stats` | Notification counts by type |
| `npm run check` | Probe the upstream feed's shape |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:contract` | Diff our response shape against the **live** app |
| `npm run notify:test` | Phase 4 acceptance tests (dedup, re-arm, backfill guard) |
| `npm run migrate` | `prisma migrate deploy` |

Every ingest command is idempotent — running it twice writes nothing the
second time, because `upsertTender` skips the write when the content hash is
unchanged.

---

## API

```
GET /health
GET /tenders
GET /tenders/:id
```

### `GET /tenders`

| Param | Notes |
|---|---|
| `page` | 1-based. `0` returns **400**. |
| `limit` / `perPage` | Aliases. **Clamped to 100**, never a 400. |
| `q` / `search` | Aliases. Full-text search, stemmed, `description` weighted highest. |
| `province` | e.g. `KwaZulu-Natal` |
| `category` | e.g. `Construction` |
| `status` | `active` (default) · `complete` · `cancelled` · `planning` |
| `closingBefore` | ISO timestamp |
| `constructionOnly` | `true` / `false` |
| `sort` | `latest` (default) · `closing` |

Response:

```json
{ "page": 1, "results": [ ... ], "source": "live", "total": 1831, "totalPages": 611 }
```

Each tender carries exactly the keys the live app expects:

```
category, closingDate, contactInformation, description, documents, id,
isSaved, location, matchScore, organisation, province, publishedDate,
savedAt, sourceUrl, tenderNumber, title, valueCents
```

`isSaved`, `savedAt` and `matchScore` belong to the app's auth layer and are
emitted as inert defaults; the API is read-only public data.

### Two compatibility rules worth knowing

- **`limit` is clamped, not rejected.** The live API silently caps it, so we
  must never 400 a request the app has always been allowed to send.
- **`perPage`, `search` and `status` are accepted as aliases** even though the
  live API ignores them, so no client breaks on a rename.

### Recipes

```bash
# "expiring soon" — closing soonest first
curl "$API/tenders?sort=closing&closingBefore=2026-09-15T00:00:00Z&limit=20"

# "latest tenders"
curl "$API/tenders?sort=latest&limit=20"

# KZN catering
curl "$API/tenders?province=KwaZulu-Natal&q=catering"
```

---

## Data source

`GET https://ocds-api.etenders.gov.za/api/OCDSReleases` — the National
Treasury's public OCDS feed, published under the
[PDDL licence](https://data.etenders.gov.za). PascalCase query params,
`dateFrom`/`dateTo` both required, paginated via `links.next`, and **slow**
(13–74 s per request measured during research).

Measured over a 31-day window (1,845 releases, committed as fixtures):

| Field | Finding |
|---|---|
| `closingDate` | usable **100%**; median lead time 21.4 days; 87.1% ≥ 7 days |
| categories | **79 distinct, 0% "Other"** |
| title / description / organisation / province / contactEmail | **100%** |
| documents | 99.9% (1,844 of 1,845) |
| `valueCents` | **0% populated** → never filter on value |
| CIDB grade | 2.3% → enrichment only, never a filter |
| titles that are bare reference codes | **92.9%** |
| arrival rate | ~6 new tenders/hour |
| status | active 1,311 · complete 473 · cancelled 57 · planning 4 |

Two consequences that shaped the design:

1. **Full-text search weights `description` highest (A), title second (B).**
   92.9% of titles are strings like `RFX 60000003542`, so a title-weighted
   index would search noise.
2. **Matching uses the union of category and keywords.** For "catering":
   category alone finds 42, keywords alone 38, the **union finds 54
   (+28.6%)** — the taxonomy and the free text each catch what the other
   misses.

Of the 1,845 rows in the fixture set the API lists **1,831**: 14 "Regret Letter"
/ cancellation entries are flagged `isOpportunity = false` and excluded. The
live database keeps growing from there.

---

## How the hourly loop works

`npm run hourly:prod` (GitHub Actions cron `.github/workflows/hourly.yml`, minute 17 every hour, UTC):

1. **Ingest** the rolling **7-day** window. Treasury occasionally publishes releases dated several days back. Upserts only; unchanged rows are skipped via content hash.
2. **Match** only tenders with `firstSeenAt > lastMatchedAt` — roughly 6–10 per hour.
3. **Dispatch** in-app + web push + email.

Backfill is a separate optional task (`npm run backfill:prod` from laptop, 31 days), never part of the hourly path.

### Why notifications don't spam

| Guard | Behaviour |
|---|---|
| `new_match` dedupe key | Fires **once, ever**, per (filter set, tender) |
| `expiring` dedupe key | Includes `closingDate`, so an **extended deadline re-arms** instead of going silent |
| `lastMatchedAt` cursor | **Is** the backfill guard — a brand-new filter set matches 0 historical tenders |
| Expiry sweep scope | Only tenders the user *already* got a `new_match` for — no burst of alerts the moment a filter set is created |
| Explicit `dedupeKey` column | Postgres treats NULLs as DISTINCT, so a plain unique `(filterSetId, tenderId, type, closingDate)` would let duplicate `new_match` rows through every hour |

Each filter set stores `provinces[] ∧ (categories[] ∨ keywords[])`,
`expiryLeadDays` (default 7) and `channels[]`.

---

## Notifications

Every channel is independently optional: **an unconfigured channel is skipped
and reported as 0**, never recorded as a false "sent".

**In-app** — always on. Rows in the `Notification` table; the app reads them.

**Web push (VAPID)**

```bash
npx web-push generate-vapid-keys
# set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT as repo secrets / env vars
```

The public key goes to the browser to create the subscription; the private key
stays server-side. Subscriptions that 404/410 are deleted automatically.
**iOS caveat:** the PWA must be added to the Home Screen before push works
(iOS 16.4+).

**Email (Resend)** — set `RESEND_API_KEY`, plus `EMAIL_FROM` on a domain you
have verified in Resend. Each notification also needs a destination address on
the filter set (`notifyEmail`).

---

## Deployment — free tier (Render + Neon + GitHub Actions)

Everything below runs at **$0/month**.

| Piece | Where | Why there |
|---|---|---|
| API | **Render** free web service | Free tier covers web services |
| Database | **Neon** free Postgres | Render's free Postgres is deleted after 30 days. Neon's free tier is permanent |
| Hourly job | **GitHub Actions** (`:17` every hour) | Render has no cron jobs on free tier |

### 1. Neon (database)

1. Create a free project at [neon.tech](https://neon.tech). Region: `eu-central-1` (Frankfurt).
2. From Console → **Connect**, copy **both** connection strings:
   - **pooled** (hostname contains `-pooler`) → `DATABASE_URL`
   - **direct** (no `-pooler`) → `DIRECT_URL`
3. Paste both into Render *and* GitHub Actions secrets.

### 2. Render (API)

Render Dashboard → Blueprints → New Blueprint Instance.
Fill in `DATABASE_URL` and `DIRECT_URL` (plus optional VAPID/Resend values).

### 3. GitHub Actions (hourly job)

`.github/workflows/hourly.yml` runs `npm run hourly:prod` at minute 17 of every hour. Secrets configured under **Settings → Secrets and variables → Actions**.

---

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | **yes** | — | Postgres connection string (pooled endpoint for app) |
| `DIRECT_URL` | **yes** | — | Postgres direct connection string (for migrations) |
| `PORT` | no | `3000` | API port (Render sets it) |
| `HOST` | no | `0.0.0.0` | Bind address |
| `NODE_ENV` | no | — | `production` quiets Prisma's query logging |
| `CORS_ORIGINS` | no | `*` | Comma-separated allow-list |
| `API_KEY` | no | — | When set, requires `X-API-Key` or `Authorization: Bearer` |
| `VAPID_PUBLIC_KEY` | no | — | Web push; unset ⇒ push skipped |
| `VAPID_PRIVATE_KEY` | no | — | Web push; unset ⇒ push skipped |
| `VAPID_SUBJECT` | no | `mailto:ops@tenderbase.example` | VAPID contact |
| `RESEND_API_KEY` | no | — | Email; unset ⇒ email skipped |
| `EMAIL_FROM` | no | `TenderBase <alerts@tenderbase.example>` | Must be a verified Resend domain |
| `DEMO_EMAIL` | no | — | Destination for `npm run notify -- --seed` |
| `INGEST_WINDOW_DAYS` | no | `7` | Days re-checked each hourly poll |

---

## Tests

```bash
npm run typecheck      # tsc --noEmit
npm run test:contract  # our response shape vs the LIVE app — must be identical
npm run notify:test    # notification behaviour
```

---

## Layout

```
src/
  config.ts            constants validated against the live feed
  sources/ocds.ts      HTTP client: retry/backoff, follows links.next
  normalise.ts         OCDS release -> app-contract tender
  load.ts              fixture loader + weekly-chunk window fetcher
  db/
    prisma.ts          shared PrismaClient
    upsert.ts          idempotent upsert (content-hash skip)
    search.ts          SEARCH_EXPR — must stay byte-identical to the migration
  pipeline/ingest.ts   fetch -> normalise -> upsert (shared by CLI + cron)
  api/
    server.ts          Fastify routes
    tenders.ts         parameterised SQL + batched document fetch
    serialise.ts       DB row -> live-app contract
  match/matcher.ts     filter-set matching + expiry sweep
  notify/
    dedupe.ts          dedupe key construction
    dispatch.ts        in-app + push + email delivery
  cli/                 serve | ingest | hourly | notify | check
prisma/migrations/     init, FTS index, matching tables, notify_email
fixtures/              1,845 real releases (31 days) for offline runs
scripts/               contract_test, notify_test, verify.sql, retry_test
```
