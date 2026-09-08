# TenderBase Pipeline — Build Progress

Update after every phase so work can resume cleanly after a timeout.

| Phase | Scope | Status |
|---|---|---|
| 1 | Data path: fetch + normalise + verify | ✅ DONE |
| 2 | Postgres + Prisma schema + idempotent upsert | ✅ DONE |
| 3 | Fastify API matching the TenderBase contract | ✅ DONE |
| 4 | Matching engine + notification dedup | ⬜ NEXT |
| 5 | Docker + render.yaml + README | ⬜ |

> **Dev-environment note:** processes do not survive between sessions.
> `sudo -n service postgresql start` if Postgres is down
> (DB `tenderbase`, user `tenderbase`, password `tenderbase`, port 5432).
> API: `npm run serve` → port 3000. Contract test: `npm run test:contract`.
> Notifications: `npm run notify` (match+dispatch), `npm run notify:test`.

**Current state:** API serves **1,831** tenders (1,845 ingested minus 14
"Regret Letter"/cancellation entries filtered by `isOpportunity`). The matching
and notification loop is built and its acceptance test passes on all four
sections (A dedup, B expiry re-arm, C backfill guard, D active-only expiry).

---

## Phase 1 — Data path (DONE)

- `src/config.ts`, `src/sources/ocds.ts` (retry/backoff, follows `links.next`,
  never stops on a small page), `src/normalise.ts`, `src/cli/check.ts`
- `fixtures/` — real 31-day sample (1,845 releases) committed for reproducible tests
- Verified: closingDate **100%** · categories **79 distinct, 0% "Other"** ·
  contactEmail **100%** · titles that are bare codes **92.9%** · CIDB grades 2.3%

## Phase 2 — Postgres + persistence (DONE)

- PostgreSQL 17.11 locally; Prisma **6.19.3** (not 7.x — v7 needs a config file + Node 22)
- `Tender`, `TenderDocument`, `ScraperRun`, `ScraperError`; unique `(source, ocid, releaseId)`
- GIN **expression** index weighted `description=A, title=B, organisation=C`
  (description highest because 92.9% of titles are meaningless codes)
- Idempotency proven: run 1 → 1,845 inserted; run 2 → **0 inserted, 0 updated, 1,845 unchanged**
- DB: **1,845 tenders / 1,844 documents** · expiring-soon pool **351**

## Phase 3 — API (DONE)

- `src/api/serialise.ts` — DB row → exact live-app contract
- `src/api/tenders.ts` — parameterised raw SQL (repeats the tsvector expression
  verbatim so the GIN index is used) + one batched document fetch
- `src/api/server.ts` — Fastify; helmet, CORS, optional API key, Zod validation
- `src/cli/serve.ts` — entrypoint
- `scripts/contract_test.ts` — compares our shape against the **live** app

**Contract test: ALL CHECKS PASSED**

```
live tender keys: category, closingDate, contactInformation, description, documents,
                  id, isSaved, location, matchScore, organisation, province,
                  publishedDate, savedAt, sourceUrl, tenderNumber, title, valueCents
ours tender keys: (identical)
```

Working endpoints:
```
GET /health
GET /tenders?page&limit&perPage&q|search&province&category&status&closingBefore&constructionOnly&sort
GET /tenders/:id
```

Measured: `province=KwaZulu-Natal` → 241 · `category=Construction` → 114 ·
`q=catering` → 34 · `constructionOnly=true` → 201 · listable total 1,831

**Compatibility decision:** `limit` is *clamped* to 100 rather than rejected,
because the live API silently caps it and we must never 400 a request the app
has always been allowed to send. `perPage`, `search` and `status` are accepted
as aliases even though the live API ignores them.

---

## Phase 4 — Matching + notifications (DONE) ← the core product

A user sets a filter set → a matching tender arrives → in-app + push + email,
plus a warning 1 week before expiry.

**Built**
- migrations `20260908170114_phase4_matching` (`FilterSet`, `Notification`,
  `PushSubscription`) and `…_add_notify_email` (`FilterSet.notifyEmail`)
- `src/notify/dedupe.ts` — `buildDedupeKey()`
- `src/db/search.ts` — shared `SEARCH_EXPR` (must stay byte-identical to the FTS migration)
- `src/match/matcher.ts` — `buildMatchConditions()`, `matchNewTenders()`, `matchExpiring()`
- `src/notify/dispatch.ts` — `buildPayload()`, `sendPush()`, `sendEmail()`, `dispatchPending()`
- `src/cli/notify.ts` — `--seed`, `--stats`, default match+dispatch
- scripts: `notify`, `notify:test`

**Acceptance test — ALL PHASE 4 CHECKS PASSED**

```
A. REPEATED RUNS NEVER RE-NOTIFY
   PASS  second run creates no new notifications — before=5 after=5 created=0
B. EXTENDED CLOSING DATE RE-ARMS THE EXPIRY ALERT
   PASS  extension produces a new expiry alert (new dedupe key) — before=1 after=2
   PASS  the re-armed alert does not repeat — after=2 third=2 (created 0)
C. BACKFILL GUARD — new filter set must not match history
   PASS  a brand-new filter set matches 0 of 1845 historical tenders — created=0
D. EXPIRY ALERTS ONLY COVER ACTIVE, REAL OPPORTUNITIES
   PASS  no expiry alert points at a closed or non-opportunity tender — found 0
```

**A real payload the test produced** (not synthetic — an ATNS airport catering
tender, and the four airports named are all in KZN):

```json
{"title":"Tender closing soon",
 "body":"SUPPLY AND DELIVERY OF AD HOC CATERING SERVICES FOR FALE (KING SHAKA), FAVG (VIRGINIA), FAPM (PIETERMARITZBURG), AND FARB (RICHARDS BAY) ATS — closes 2026-09-13 17:05",
 "tag":"expiring-cmtswma9k01senzru2kfxfakj",
 "data":{"tenderId":"cmtswma9k01senzru2kfxfakj","type":"expiring","closingDate":"2026-09-13T17:05:46.549Z"}}
```

**Design decisions (locked)**
- match = **province** ∧ (**category** ∨ **keywords**) — union measured +28.6% recall
- `new_match` dedupe key fires **once, ever**; `expiring` key **includes
  `closingDate`** so an extended deadline re-arms instead of going silent
- the `lastMatchedAt ?? createdAt` cursor **is** the backfill guard; it advances
  to the newest processed `firstSeenAt`, not `now()` (so no tender is skipped)
- the expiry sweep only covers tenders the user **already** got a `new_match`
  for — prevents an alert burst the moment a filter set is created
- explicit `dedupeKey String @unique` because Postgres treats NULLs as DISTINCT,
  so a plain unique `(filterSetId, tenderId, type, closingDate)` would let
  duplicate `new_match` rows through every hour

**Live run log**
```
npm run notify -- --seed  -> filter set "KZN catering & food service", 4 simulated arrivals
npm run notify   run 1    -> new:+4 (4 matched)  expiring:+1 (1 in window)
                             processed 5 | in-app 5 | push 0 | email 0
npm run notify   run 2    -> new:+0  expiring:+0  duplicates skipped: 1   <-- dedup proven
npm run notify -- --stats -> 6 notifications (4 new_match / 2 expiring), 5 in-app, 1 filter set
```

Push/email report 0 because `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` and
`RESEND_API_KEY` are unset; both senders return `false` rather than recording a
false "sent". To light them up: `npx web-push generate-vapid-keys`.

---

## Phase 5 — Deploy packaging (DONE)

**Built**
- `src/pipeline/ingest.ts` — ingest extracted out of the CLI so the hourly cron
  and the manual backfill share **one** code path. `src/cli/ingest.ts` is now a
  thin wrapper; the refactor was verified by re-running it (0 inserted /
  1,845 unchanged, identical to before).
- `src/cli/hourly.ts` — the loop: ingest rolling window → match → dispatch.
  `--match-only` and `--days N` for debugging. Fails loudly if a live window
  returns 0 releases (that means upstream changed shape).
- scripts: `hourly`, `backfill`, `migrate`, `start`. **`tsx` moved to
  `dependencies`** — it is a runtime dependency, so `npm ci --omit=dev` keeps it.
- `Dockerfile` + `.dockerignore` — 2-stage `node:20-slim`; migrations run at
  container **start**, not build, because the DB may not exist at build time.
- `render.yaml` — API web service + hourly cron + Postgres 16.
- `.env.example`, `.gitignore`, `README.md`.

**Verified**
```
npm ci --omit=dev -> prisma generate -> app runs
    tsx present (good), typescript not a direct dep (comes via prisma)
prisma migrate deploy   -> "No pending migrations to apply" (idempotent)

LIVE hourly run (real upstream API, 7-day window, 80s):
    fetched 413 | inserted 11 | updated 2 | unchanged 400 | errors 0
    DB 1,845 -> 1,856

cursor correctness: 11 tenders newer than lastMatchedAt; the matcher saw all 11
    (they genuinely were not KZN catering, so +0 matched was correct, not a bug)

REAL end-to-end notification, no simulation:
    a filter set created 90 min earlier caught 3 of the 11 live arrivals
      2 by category  (Services: Professional)
      1 by keyword   (Waste collection... tender, whose category is different)
    + 2 expiry alerts, 5 dispatched in-app
```

That last one is the product working on live data, and the third match is
exactly the category-OR-keyword union earning its +28.6% recall: the waste
tender would have been missed by category matching alone.

**Deployment decisions (REVISED — see below for the free-tier switch)**

Deliverables: `Dockerfile` + `.dockerignore`, `render.yaml`, `.env.example`,
`.gitignore`, `README.md`, `src/pipeline/ingest.ts`, `src/cli/hourly.ts`.

---

## Revision — switched to free Render + Neon (user request)

The user asked to **stay on Render's free tier and use Neon for the database**.
That forces two changes, because of two hard limits found by research:

| Limit | Consequence |
|---|---|
| Render's **free Postgres is deleted after 30 days** | Database must live on Neon — correct call, Neon's free tier is permanent |
| Render **has no cron jobs on the free tier** (billed from $1/month) | The hourly job had to move off Render entirely |

**New shape (all $0/month):**

| Piece | Where |
|---|---|
| API | Render free web service (`plan: free`) |
| Database | Neon free Postgres |
| Hourly job | **GitHub Actions** (`.github/workflows/hourly.yml`) |

**What changed in the repo**
- `render.yaml` — one free web service, **no `databases:` block**, no cron
  service. `DATABASE_URL` and `DIRECT_URL` are now `sync: false` secrets.
- `.github/workflows/hourly.yml` — **new**. Hourly at `:17` UTC, `npm ci` +
  `prisma generate` + `tsc` + `prisma migrate deploy` + `npm run hourly:prod`.
  Has `workflow_dispatch`, a 20-min timeout, and a `concurrency` group with
  `cancel-in-progress: false` so a slow run is never killed mid-ingest.
- `prisma/schema.prisma` — added **`directUrl = env("DIRECT_URL")`**. Neon puts
  PgBouncer in front of pooled connections, and its transaction mode does not
  preserve the session state DDL needs, so migrations must use the direct
  (non-`-pooler`) endpoint. Verified locally: `prisma generate` and
  `prisma migrate deploy` both work, and the client still queries.
- **Production now runs compiled JS, not tsx.** Free instances get 512 MB RAM,
  so shipping the TypeScript transform machinery is memory better spent on
  Prisma. `npm run build` → `node dist/cli/serve.js` / `node dist/cli/hourly.js`.
  `tsx` moved back to `devDependencies`. Verified: `tsc -p tsconfig.json` builds,
  and both `node dist/cli/serve.js` and `node dist/cli/hourly.js --match-only`
  run correctly (served requests, FTS returned a real catering tender).
- `Dockerfile` — rewritten to 3 stages (build → deps → release) so the released
  image carries **no** TypeScript toolchain.
- Scripts: `build`, `start`, `hourly:prod`, `backfill:prod` added.
- `.env.example` and README rewritten around Neon's two connection strings.

**Numbers that justify the free tier**
```
database size today   12 MB   (1,856 tenders, ~6.5 KB each)
Neon free storage     512 MB  -> ~3 years of headroom at ~60 tenders/day
Neon free compute     100 CU-hours/month
  hourly job          ~730 runs x 2 min x 0.25 CU  = ~6 CU-hours  (6%)
```

**The one trap worth remembering:** do **not** add a keep-alive pinger to dodge
Render's cold starts. Keeping Neon awake 24/7 is ~730 h × 0.25 CU ≈ 182
CU-hours/month — nearly double the 100 CU-hour budget, and Neon's limits are
hard cutoffs, so the database would suspend mid-cycle and the app would break.
The two free tiers pull in opposite directions here; take the 30-60s cold start.

**Also verified:** npm 10 installs devDependencies even when
`NODE_ENV=production` (which Render sets by default), so `tsc` is available in
the build step without `--include=dev`.

**NOT verified (honest)**
- No Render account, no Neon account, no GitHub Actions run — none of it has
  been executed. Field names were checked against Render's spec, but the first
  real deploy may still surface a typo.
- The Dockerfile has never been built (no Docker in this sandbox); its riskiest
  assumption — running with production dependencies only — was verified directly.
- GitHub Actions has two known behaviours to plan around: scheduled runs can be
  delayed a few minutes under load, and **scheduled workflows are disabled after
  60 days of repository inactivity**.

---

## Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Data path: fetch + normalise + verify | ✅ |
| 2 | Postgres + Prisma + idempotent upsert | ✅ |
| 3 | Fastify API matching the TenderBase contract | ✅ |
| 4 | Matching engine + notification dedup | ✅ |
| 5 | Docker + render.yaml + README + hourly cron | ✅ |
| 5b | Free-tier rework: free Render + Neon + GitHub Actions cron | ✅ code-complete, undeployed |

**Remaining to go live:** create the Neon project (region matching Frankfurt),
push to GitHub, apply the Blueprint in Render, add the same two Neon URLs as
GitHub Actions secrets, then trigger the hourly workflow once (or run
`npm run backfill:prod`) to load the first 31 days. Optional: VAPID keys via
`npx web-push generate-vapid-keys` and a Resend key to switch on push + email.

---

## 2026-09-08 · Live — and hardened against SITA DNS flaps

**Went live.** Render service + Neon DB + GitHub Actions cron, all on free
tiers. First successful hourly run took ~5 min (migrate + 7-day ingest + match
+ dispatch) and the API immediately served real data: 50 KwaZulu-Natal tenders,
7 full-text hits for `q=catering`.

**Incident worth remembering.** One run failed with `TypeError: fetch failed` —
undici's wrapper around `ENOTFOUND`. Root cause: the authoritative nameservers
for `etenders.gov.za` (SITA, `164.151.132.39/.40`) flap — Google DNS logged
"Name servers did not respond" at 21:08 UTC, and the same server answered
cleanly at 21:12. The old retry schedule (3 attempts, 1-2s apart) burned every
attempt inside one bad moment. Verified by querying `dns.google/resolve`
during the outage; the API host itself (`164.151.136.188`) was never down.

Fix (`src/sources/ocds.ts` + `src/config.ts`):

- Two-tier retries — HTTP errors keep the fast 3x1-2s schedule; network errors
  (DNS/TCP/TLS/timeout) get up to 6 attempts spread over ~2.5 minutes, inside a
  9-minute per-page deadline that protects the job's 20-minute budget.
- `describeError()` flattens the error chain, so logs now read
  `ENOTFOUND: getaddrinfo ...` instead of the useless wrapper.
- `npm run test:retry` (scripts/retry_test.ts) pins the behaviour with a
  stubbed fetch: recovery after transient DNS failures, fast-fail on HTTP
  errors, and correct tier accounting when both occur.
- The workflow gained a `push: [main]` trigger so every merge self-validates
  with a real pipeline run.

**Not done:** the 31-day backfill (`npm run backfill:prod` from a laptop —
the eTenders API is unreachable from sandboxed CI/agent environments that
don't allow arbitrary egress).
