# TenderBase — tender pipeline & API

Ingests **every** South African national/provincial tender published on the
eTenders OCDS feed into Postgres, serves them through an API that mirrors the
contract the live app already consumes, and notifies users when a tender
matching their saved filters arrives — or a week before it expires.

```
eTenders OCDS API ──hourly──▶ Postgres ──▶ Fastify API ──▶ tenderbase-web
                                  │
                                  └──▶ matcher ──▶ in-app + push + email
```

The point of the product: **stop people missing out on tender opportunities.**

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
| `npm run backfill:prod` | Compiled 31-day backfill |
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
live database keeps growing from there — the first live hourly poll took it to
1,856 rows, 1,842 of them listable.

---

## How the hourly loop works

`npm run hourly` (Render cron, minute 17 every hour, UTC):

1. **Ingest** the rolling **7-day** window. Not 1 day — Treasury occasionally
   publishes releases dated several days back. Upserts only; unchanged rows
   are skipped via a content hash.
2. **Match** only tenders with `firstSeenAt > lastMatchedAt` — roughly 6–10
   per hour, not all 1,800+.
3. **Dispatch** in-app + web push + email.

Backfill is a separate one-off (`npm run backfill`, 31 days, ~5 weekly chunks),
never part of the hourly path.

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
# set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
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
| Database | **Neon** free Postgres | Render's free Postgres is **deleted after 30 days** — that would take the whole tender history with it. Neon's free tier is permanent |
| Hourly job | **GitHub Actions** | Render has **no cron jobs on the free tier** (billed from $1/month) |

### 1. Neon (database)

1. Create a free project at [neon.tech](https://neon.tech). Pick the region
   closest to your Render region — `eu-central-1` pairs with Frankfurt.
2. From the Console → **Connect**, copy **both** connection strings:
   - **pooled** (hostname contains `-pooler`) → `DATABASE_URL`
   - **direct** (no `-pooler`) → `DIRECT_URL`
3. Both already carry `sslmode=require`. Paste them into Render *and* into
   GitHub Actions secrets.

**Why two strings?** Neon routes pooled connections through PgBouncer in
transaction mode, which does not preserve the session state that DDL needs, so
`prisma migrate deploy` has to run against the direct endpoint. `schema.prisma`
declares `directUrl = env("DIRECT_URL")` for exactly this reason; locally both
point at the same database and that is harmless.

**Storage headroom:** the database is **12 MB** today (1,856 tenders, ~6.5 KB
each). At the observed ~60 new tenders/day that is ~2.7 MB/week, so Neon's
0.5 GB free tier is roughly three years of headroom.

### 2. Render (API)

Push to GitHub, then **Render Dashboard → Blueprints → New Blueprint Instance**
and pick the repo. `render.yaml` creates one free web service. Fill in the
`sync: false` secrets when prompted (the two Neon URLs, plus the optional
VAPID/Resend values).

Deploy pipeline: `npm ci` → `prisma generate` → `prisma migrate deploy` →
`tsc` build → `node dist/cli/serve.js`. Migrations run inside the build
command because `preDeployCommand` is a paid-plan feature (free tier rejects
a blueprint that sets one); that is safe — the migrate is idempotent,
advisory-locked, and a failed migration fails the build before the new code
is served.

### 3. GitHub Actions (hourly job)

`.github/workflows/hourly.yml` runs `npm run hourly:prod` at minute 17 of every
hour. Add `DATABASE_URL` and `DIRECT_URL` (and any notification keys) under
**Settings → Secrets and variables → Actions**.

Free for public repositories. Private repositories get 2000 minutes/month and
this job takes ~2 minutes, so ~730 runs/month lands around 1500.

Two honest caveats:

- Scheduled runs **can be delayed a few minutes** when GitHub is busy. Nothing
  is lost — the 7-day ingest window means a late run still catches every tender
  — but a notification can arrive a few minutes late.
- **GitHub disables scheduled workflows after 60 days of repository
  inactivity.** A quiet repo would silently stop the hourly poll. Push
  occasionally, or move to Render's $1/month cron job.

### 4. First data

Trigger the workflow manually (**Actions → Hourly tender ingest → Run
workflow**), or run a backfill once from Render Shell:

```bash
npm run backfill:prod      # 31 days, compiled output
```

### 5. Point the app at it

Add your API's Render URL to `CORS_ORIGINS` and use it in
`https://tenderbase-web.onrender.com`.

---

### Free-tier trade-offs worth knowing

- **Render free web services spin down after 15 minutes idle**, so the first
  request after a quiet period takes 30–60 s.
- **Do not add a keep-alive pinger.** It is the standard fix for Render's cold
  starts, but here it would keep Neon's compute awake around the clock:
  ~730 h/month × 0.25 CU ≈ **182 CU-hours against a 100 CU-hour budget**. Neon's
  limits are *hard cutoffs*, not throttles — the database would suspend
  mid-cycle and the app would break. These two free tiers pull in opposite
  directions; take the cold start.
- **Neon suspends after 5 minutes idle**; the first query after that wakes it in
  roughly 300–500 ms.
- **Free instances get 512 MB RAM / 0.1 CPU.** That is why production runs the
  compiled output (`node dist/...`) instead of `tsx`, keeping memory for Prisma.
  Local development still runs TypeScript directly.

### Upgrading later

| Cost | What it buys |
|---|---|
| $1/month | Render **cron job** — on-time hourly runs, no 60-day inactivity trap |
| $7/month | Always-on Render web service — no cold starts |
| Neon Launch | Beyond 0.5 GB storage, configurable scale-to-zero, 7-day PITR |

### Self-hosting with Docker

A `Dockerfile` is included; it builds a dist-only image with no TypeScript
toolchain:

```bash
docker build -t tenderbase .
docker run --rm -p 3000:10000 --env-file .env tenderbase

# the hourly job from the same image
docker run --rm --env-file .env \
  tenderbase sh -c "npx prisma migrate deploy && node dist/cli/hourly.js"
```

Migrations run at container **start**, not build, because the database (and its
connection strings) may not exist at build time. `prisma migrate deploy` is
idempotent and advisory-locked, so it is safe when several instances start
together.

---

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | **yes** | — | Postgres connection string |
| `PORT` | no | `3000` | API port (Render sets it) |
| `HOST` | no | `0.0.0.0` | Bind address |
| `NODE_ENV` | no | — | `production` quiets Prisma's query logging |
| `CORS_ORIGINS` | no | `*` | Comma-separated allow-list |
| `API_KEY` | no | — | When set, requires `X-API-Key` or `Authorization: Bearer` (except `/health`) |
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

`scripts/contract_test.ts` fetches both the live app and our API and diffs the
key sets, so a drift in either direction fails loudly. Current status:
**ALL CHECKS PASSED**, zero missing keys.

`scripts/notify_test.ts` covers four behaviours that matter for a
notifications product:

```
A. repeated runs never re-notify          — before=5 after=5 created=0
B. an extended closing date re-arms       — before=1 after=2, then stable at 2
C. a brand-new filter set matches 0 of 1845 historical tenders
D. no expiry alert points at a closed or non-opportunity tender
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
scripts/               contract_test, notify_test, verify.sql
```

---

## Known limitations

- **`valueCents` is empty** for essentially every tender in the source feed,
  so the field is emitted but no filtering or sorting uses it.
- **Titles are uninformative** (92.9% are reference codes). Notification copy
  leads with the *description* for this reason.
- **The feed is slow** (up to 74 s per request). The hourly job takes a couple
  of minutes; it is not suited to sub-minute polling.
- **Sources covered** are those published to the national eTenders OCDS feed.
  Municipal tenders published only on their own portals are out of scope.
- Push on **iOS** requires the user to add the PWA to their Home Screen first.
