# CIDB Tender Scraper + Neon Postgres + Render: Architecture Blueprint

**Executive Summary:** This blueprint outlines a robust architecture for scraping the CIDB tenders site, storing data in a Neon Postgres database, and deploying both the scraper and API on Render.com. We propose two services: a **Render Cron job** running a Node.js/Playwright scraper at a regular schedule (e.g. every 6 hours), and a **Render Web service** providing a REST API for querying the tender data. The scraper uses Playwright in a single browser context with rate limiting to navigate listing and detail pages, extracting fields into a PostgreSQL schema (via Prisma ORM) designed for efficient queries and full-text search. Deduplication is handled by unique IDs and content hashes, with upsert logic for change detection. Logging and metrics (e.g. run counts, error counts, pages fetched) are stored in auxiliary tables. Security measures include an API key and CORS restrictions, and secrets (DB URL, API keys) are managed via Render environment variables. The CI/CD pipeline uses a multi-stage Dockerfile and Render `render.yaml` to orchestrate builds, migrations (`prisma migrate deploy`), and deployment. Key design defaults: scrape every 6 hours (`0 */6 * * *`), `REQUEST_DELAY_MS=1500ms` between page fetches, and container launch flags (`--disable-dev-shm-usage`) to support Playwright. The report covers data models, API routes, scraping logic, error handling, and more, with tables comparing trade-offs and a development timeline in a Mermaid Gantt chart. 

## Architecture Overview  

We deploy two Render services: **`cidb-scraper` (type: cron)** and **`cidb-api` (type: web)**, plus a Neon Postgres database. The cron job periodically runs the Playwright scraper which navigates the CIDB site, parses listings and detail pages, and upserts records into the database. The API service (Node.js + Fastify/Express) queries this database to serve clients. All components run in Render’s cloud and use environment variables for configuration. Render guarantees **at most one cron job instance at a time**, preventing overlapping scrapes. The database is Neon Postgres (with Neon's pooled connection proxy), accessed via Prisma ORM. The web service exposes REST endpoints for listing and searching tenders, with pagination and filtering. Logging and metrics (HTTP statuses, record counts, run durations, etc.) are captured both in structured logs and in special tables (e.g. `scraper_runs`, `scraper_errors`). CI/CD uses Docker (multi-stage build with Playwright dependencies) and Render’s blueprint (`render.yaml`) to automate building, migrations, and deployment. 

## Data Model (Prisma Schema)  

A PostgreSQL schema models tenders, related documents, and monitoring tables. Below is a simplified Prisma schema snippet:

```prisma
model Tender {
  id           String   @id @default(cuid())
  source       String   // e.g. "CIDB"
  externalId   String   // official tender ID or generated slug
  title        String
  description  String?
  status       String   // e.g. "OPEN", "CLOSED"
  startDate    DateTime?
  endDate      DateTime?
  province     String?
  url          String   // detail page URL
  contentHash  String?  // e.g. SHA256 of main content for change detection
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  documents    TenderDocument[] 
  @@unique([source, externalId])
  @@index([status])
  @@index([province])
  @@index([createdAt])
}

model TenderDocument {
  id        String   @id @default(cuid())
  tenderId  String
  type      String   // e.g. "pdf", "image", etc.
  filename  String
  url       String   // link to stored file or source URL
  tender    Tender   @relation(fields: [tenderId], references: [id])
}

model ScraperRun {
  id          String   @id @default(cuid())
  startedAt   DateTime @default(now())
  finishedAt  DateTime?
  status      String   // e.g. "SUCCESS", "ERROR"
  pageCount   Int      // how many list pages scraped
  itemCount   Int      // total tenders found
  errorsCount Int
}

model ScraperError {
  id         String   @id @default(cuid())
  run        ScraperRun @relation(fields: [runId], references: [id])
  runId      String
  url        String   // page or resource URL where error occurred
  message    String
  createdAt  DateTime @default(now())
}

model EnvVarGroup { /* optional if using Render env groups */ }
```

- **Indexes:** We add an index on `(source, externalId)` for fast upserts and lookups, and individual indexes on filterable columns (`status`, `province`, `createdAt`). For full-text search over `title` and `description`, we plan to add a generated `tsvector` column and a GIN index manually via SQL (Prisma currently lacks first-class support). For example:

```sql
ALTER TABLE "Tender" ADD COLUMN ts tsvector 
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,''))
  ) STORED;
CREATE INDEX tender_ts_idx ON "Tender" USING GIN(ts);
```

This allows queries like `WHERE ts @@ to_tsquery('english', 'road & construction')`. We will embed such commands in a migration script (via `prisma migrate` custom SQL).

## API Design (Endpoints & Schemas)  

The web API will use Fastify or Express with JSON. Key endpoints include:

- `GET /health`: returns status (e.g. `{ status: "ok" }`).  
- `GET /tenders`: list tenders with pagination and filtering. Query parameters: `page` (int, default 1), `perPage` (int, default 20), optional `search` (full-text string), `status`, `province`, date ranges, etc. Response: `{ total: Int, tenders: Tender[] }` with fields like `id, externalId, title, status, startDate, province`.  
- `GET /tenders/:id`: get one tender by internal ID or by `(source,externalId)`.  
- `GET /tenders/:id/documents`: list associated document URLs or metadata.  
- `GET /search`: alias for /tenders with just `search` param (optional).  

All requests require an API key (e.g. passed as `Authorization: Bearer <API_KEY>` or `x-api-key` header) and enforce CORS policy (only allow trusted origins). The API uses Zod for input validation. For example, in Express:

```js
import { z } from "zod";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.enum(['OPEN','CLOSED']).optional(),
});

app.get("/tenders", (req, res) => {
  const q = querySchema.parse(req.query);
  // Use q.page, q.perPage, q.search, q.status...
  const offset = (q.page-1)*q.perPage;
  const query = prisma.tender.findMany({
    where: {
      status: q.status,
      OR: q.search ? [{ title: { contains: q.search, mode: 'insensitive' }}, { description: { contains: q.search, mode: 'insensitive' }}] : [],
    },
    skip: offset, take: q.perPage,
    orderBy: { createdAt: 'desc' },
  });
  // Return JSON...
});
```

Response schemas follow JSON conventions. Pagination metadata (e.g. `X-Total-Count` or in JSON body) should be included. For full-text search, we rely on PostgreSQL as above, using raw queries or Prisma’s `$queryRaw` if needed. The API should protect secrets and return sanitized data (no internal hashes). Rate limiting on the API can be enforced separately if needed.

## Scraper Flow (Playwright)  

The scraper uses Playwright’s Chromium in headless mode. We follow a **single-browser-context** pattern:

```js
import { chromium } from 'playwright';

async function scrapeTenderList() {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox','--disable-dev-shm-usage']  // required in Docker
  });
  const page = await browser.newPage();
  let pageNum = 1;
  let hasNext = true;
  while (hasNext) {
    await page.goto(`https://cidb.org.za/cidb-tenders?page=${pageNum}`, {
      waitUntil: 'domcontentloaded', timeout: 20000
    });
    const tenderLinks = await page.$$eval('CSS_SELECTOR_FOR_TENDER_LINKS', els => els.map(e => e.href));
    for (const detailUrl of tenderLinks) {
      try {
        await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        // Extract fields using selectors (TODO: inspect actual page)
        const title = await page.textContent('CSS_SELECTOR_TITLE');
        const description = await page.textContent('CSS_SELECTOR_DESC');
        // ... other fields ...
        // Compute a hash of the page content for change detection:
        const html = await page.content();
        const contentHash = crypto.createHash('sha256').update(html).digest('hex');
        // Upsert into DB (Prisma or raw INSERT ... ON CONFLICT)
        // await prisma.tender.upsert({ where: { source_externalId: { source: "CIDB", externalId }}, create: {...}, update: {...} });
      } catch (err) {
        // Log error to database or monitoring
      }
      // Rate-limit between detail pages:
      await page.waitForTimeout(REQUEST_DELAY_MS);  // e.g. 1500ms default
    }
    // Check for pagination:
    const nextButton = await page.$('CSS_SELECTOR_NEXT_PAGE');
    hasNext = nextButton != null;
    if (hasNext) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }),
        nextButton.click()
      ]);
      pageNum++;
    }
  }
  await browser.close();
}
```

- **Selectors Strategy:** Use stable CSS selectors or XPath for list items and fields. Avoid loading all assets (use `waitUntil: 'domcontentloaded'`, not `networkidle`) to reduce time. For each row on a listing page, extract the hyperlink to the tender detail. On the detail page, wait for each needed selector (e.g. `await page.waitForSelector(...)`) before reading text. 
- **Rate limiting:** Insert a delay (`REQUEST_DELAY_MS`, e.g. 1500ms) between requests. Use an exponential backoff if a `429 Too Many Requests` is encountered, reading `Retry-After` headers when present. This honors polite scraping: as Context.dev notes, “polite scraping is not just ethics” – implement base delays + jitter.
- **Retries & Timeouts:** On transient errors (network timeout, occasional 5xx), retry a few times with backoff. E.g. wrap each navigation in a try/catch, and on failure retry up to 3 times with a backoff delay. Typical Playwright options: `{ timeout: 20000 }` on `goto`, and `page.waitForSelector` with timeouts (e.g. 5000ms). 
- **Concurrency:** Run in one context/one page to avoid spamming the site. As advised, “no parallel contexts unless you’ve actually measured you need them”. If throughput later requires it, scale by running multiple independent instances via separate workers or Render instances, but start simple (parallelizing a headless browser is expensive and riskier).
- **Content Hashing:** Compute a SHA256 hash of key fields or the entire HTML to detect changes. For example, after scraping a detail page’s HTML, do `crypto.createHash('sha256').update(html).digest('hex')`. This matches [Context.dev’s example of `hash_html(html)` in Python. Store this hash in the DB; if it differs from the existing hash for that tender, mark the record as updated. 

## Deduplication & Change Detection  

Each tender has a unique *externalId* (e.g. the official tender number or a composite key). The Prisma model enforces `@@unique([source, externalId])`, so upserting on this key avoids duplicates. Use Prisma’s `upsert` or raw SQL `INSERT ... ON CONFLICT(source, externalId) DO UPDATE` to insert new tenders and update existing ones atomically. For example:

```sql
INSERT INTO "Tender"(source, externalId, title, description, contentHash, ...) VALUES
 ('CIDB','EXT123','Road Upgrade','Desc...', 'abcd1234', ...)
ON CONFLICT (source, externalId) DO UPDATE 
  SET title = EXCLUDED.title,
      description = EXCLUDED.description,
      contentHash = EXCLUDED.contentHash,
      updatedAt = NOW();
```

Change detection can rely on comparing the new `contentHash` to the stored one. If unchanged, skip updates. For new records, the UPSERT will create them. 

## Error Handling and Observability  

Implement detailed logging and metrics for reliability. As advised in scraping best practices, “log the URL, status code, elapsed time, content size, and parser errors” for each fetch. Example log entry:  
```
fetched url=/tenders?page=1 status=200 elapsed_ms=532 bytes=20480
```
Track metrics per run: success count, failure count, average latency, etc. Store summary in the `ScraperRun` table (one record per cron run) and individual errors in `ScraperError`. For instance, a 403 Forbidden likely means being blocked (check robots/CAPTCHA), while a 429 means we hit a rate limit. We should handle 429 by reading `Retry-After` and backing off. 

On unexpected failures, always save the raw HTML of the page (or at least the snippet around the failure) for debugging. This mirrors [Context.dev’s advice] that “the fastest way to answer ‘Did fetching fail, or did parsing fail?’” is to inspect the saved HTML. In production, integrate logs with a monitoring system (e.g. Grafana or LogDNA) and emit metrics (Scraper runs, errors, records fetched) to detect anomalies (e.g. “records per page dropped to zero” can signal selector drift).

## Security  

- **Authentication:** All API routes require a secret API key (e.g. a Bearer token) checked in middleware. Reject unauthorized requests (HTTP 401). Store the API key as a secret environment variable in Render, not in code.  
- **CORS:** Configure CORS to allow only trusted origins (or none for a purely server-to-server API).  
- **Secrets Management:** Use Render’s environment variables for all secrets (`DATABASE_URL`, `DIRECT_URL`, API keys). For local development, use a `.env` file (excluded from Git). Prisma and Node should load these via `process.env`. Render supports referencing the Neon's `DATABASE_URL` directly via the Blueprint or through env groups.  
- **HTTPS:** Render provides TLS for `*.onrender.com` domains automatically; ensure HTTP to HTTPS redirection on the API.  
- **Other Hardening:** In Express/Fastify, use helmet middleware to set safe HTTP headers (CSP, HSTS, XSS protection). Sanitize any user input on query parameters. No file uploads are expected, so file-handling risks are minimal. 

## Testing Strategy  

- **Unit tests:** Test data-parsing logic in isolation using sample HTML fixtures. Save representative HTML pages (list pages and detail pages) under `tests/fixtures`. Write parser tests that feed these fixtures and assert expected fields are extracted. As suggested: “The most valuable fixtures are not perfect pages… edge cases (missing fields, changed layouts, etc.)”. Use Jest or Vitest for testing. For example, a test could load `fixtures/tenders-list-page.html` and verify that the scraper code returns the correct number of links and fields.  
- **Integration tests:** Use an isolated Neon database (or a local Postgres) for integration tests. For example, before API tests, run `prisma migrate dev` against a test DB, seed known data, then call endpoints (using `supertest`) to verify responses. Use Docker Compose or GitHub Actions with `pnpm playwright install` to ensure browsers are available in the test image.  
- **Scraper tests:** Consider mocking HTTP responses or using a local HTML snapshot server to test the scraper logic without hitting the real site. You can also use Playwright test harnesses to load static HTML.  
- **Continuous testing:** In CI (GitHub Actions), run `npm test` and also `npx prisma migrate deploy` against a test DB to catch migration issues. 

## CI/CD and Dockerfile  

**Dockerfile (multi-stage):** We use a multi-stage build. Example (simplified):

```dockerfile
# Stage 1: builder
FROM node:20-bullseye AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate  # generates Prisma client
COPY . .
RUN npm run build  # build TypeScript into dist

# Stage 2: runner
FROM node:20-bullseye
WORKDIR /app
ENV NODE_ENV=production
# Install Playwright dependencies and browsers
RUN apt-get update && apt-get install -y libnss3 libatk1.0-0 libgtk-3-0 libxss1 libasound2 && \
    npm i -g npm
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY package.json ./
RUN npx playwright install --with-deps  # install browser binaries
CMD ["node", "dist/api/server.js"]
```

Key points:
- Install Playwright browsers with `--with-deps` to get Chromium and libs in the image.
- Use `--no-sandbox --disable-dev-shm-usage` flags (in code) to prevent sandbox crashes in Docker.
- Run `npm prune --production` in the runner stage if needed to strip dev deps (not shown above).
- In CI, build this Docker and run tests inside it. 

**Render Build & Deploy:**  
In `render.yaml`, configure each service. For example:
```yaml
services:
  - name: tender-api
    type: web
    env: node
    repo: <git-url>
    branch: main
    buildCommand: npm run build
    preDeployCommand: npx prisma migrate deploy  # run migrations
    startCommand: node dist/api/server.js
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: tenderbase-db
          property: connectionString
      - key: DIRECT_URL
        fromEnvironment: DIRECT_URL  # if needed for Prisma CLI
      - key: API_KEY
        fromEnvironment: API_KEY
      - key: REQUEST_DELAY_MS
        fromEnvironment: REQUEST_DELAY_MS
    cors:
      origins: ["https://mydomain.com"]
  - name: tender-scraper
    type: cron
    env: node
    repo: <git-url>
    branch: main
    schedule: "0 */6 * * *"   # every 6 hours
    runCommand: "node dist/scraper/index.js"  # assuming scraper entry
    envVars:
      - key: DATABASE_URL
        fromDatabase: { name: tenderbase-db, property: connectionString }
      - key: REQUEST_DELAY_MS
        value: "1500"
  # Database definition
databases:
  - name: tenderbase-db
    provider: postgresql
    plan: starter  # or larger if needed
    region: oregon
    branch: main
```
This blueprint ensures: the API service runs `prisma migrate deploy` before start (per Render docs recommendation), uses the Neon database’s connection string from `tenderbase-db`, and the Cron job runs every 6 hours using the `runCommand`. Render’s docs note that `schedule` (a cron expression) is required for cron jobs, and only one job instance runs at a time. 

## Neon PostgreSQL Considerations  

- **Connection Strings:** Neon provides two URLs: a *pooled* (`DATABASE_URL`) and an *unpooled* direct URL (`DIRECT_URL`). For regular app runtime, use the pooled URL; for migrations, seeding or Prisma CLI tasks, use the direct URL. In `.env`/Render, set:
  ```
  DATABASE_URL="postgresql://...@xyz-neon.neon.tech/...pooler...&sslmode=require"    # for Node runtime
  DIRECT_URL="postgresql://...@xyz-neon.neon.tech/...direct...&sslmode=require"     # for migrations
  ```
  In `schema.prisma`, point the datasource to `env("DIRECT_URL")` so that `prisma migrate deploy` uses the direct connection. Prisma on Node will then automatically use the default (pooled) URL for queries, or we can configure the `@prisma/adapter-neon` as shown in docs when using Edge/serverless environments. Neon requires SSL (`?sslmode=require`); Prisma needs `sslaccept=strict` if connecting via HTTPS.  
- **Migrations:** Use `npx prisma migrate dev` during development (targets direct URL) and `npx prisma migrate deploy` in production (also uses direct URL from env) to apply schema changes. Render’s `preDeployCommand` can run the `migrate deploy` step each deploy.  
- **Direct vs Pooled:** As a Neon/Prisma guide notes, configure both env vars and use `url = env("DIRECT_URL")` in schema for CLI actions, while the app’s runtime pool uses `DATABASE_URL`. This avoids “prepared statement already exists” errors when seeding through the pooler.  
- **Connection Pooling:** Neon’s proxy handles pool sizing; Prisma’s `datasource.connection_limit` setting can align with Render plans. Ensure the adapter is installed (`@prisma/adapter-neon`) if deploying on serverless platforms.  

## Scheduling and Concurrency Control  

The scraper runs on a fixed schedule. Using Render Cron, we set `schedule: "0 */6 * * *"` for every 6 hours (UTC). This interval balances freshness with load; a shorter interval (e.g. 1–2h) would increase DB and target load, a longer interval (e.g. daily) might miss timely updates. Trade-offs are discussed below. Render guarantees only one instance of the job is active at any given time, so explicit locking is not needed on Render. If not using Render Cron, one would use a distributed lock or DB flag to prevent overlapping runs. We also plan to timestamp each `ScraperRun` and avoid re-scraping recent pages redundantly (incremental crawling). 

## Data Retention and Archival  

Tenders should generally be retained for historical reference. Instead of deleting old/cancelled tenders, mark them with a status like `CLOSED` or `ARCHIVED`. Optionally, partition the `Tender` table by date or move old data to a separate archive schema yearly. This allows keeping long-term data without bloating the main index. For example, a daily job could move tenders older than N years to a read-only archive table (or export to CSV). In general, avoid deleting data: “removed pages are marked inactive instead of immediately deleted” is a recommended pattern. Retention periods should align with business/legal requirements for tender records. 

## Legal and Robots.txt Considerations  

Before crawling, check `robots.txt` on the CIDB domain. If access to the tender pages is disallowed, either obtain permission or avoid scraping. Given tender data is public and likely updated for transparency, it’s probably allowed but we must confirm. In all cases, identify the scraper with a custom User-Agent and obey `robots.txt` and any “Crawl-delay” rules. Use the recommended delay (`REQUEST_DELAY_MS=1500ms` default) and backoff on `429` to avoid hammering the site. Keep an eye on frequency and volume; if CIDB publishes an API or data dump in future, prefer those official channels. 

## Deployment Checklist  

Before final deployment, ensure:  
- [ ] The `.env` (or Render secrets) includes `DATABASE_URL`, `DIRECT_URL`, `API_KEY`, `REQUEST_DELAY_MS`, etc.  
- [ ] `npm ci && npm run build` succeeds locally.  
- [ ] `npx prisma migrate deploy` applies migrations to Neon DB with no errors.  
- [ ] Unit and integration tests all pass (Jest coverage).  
- [ ] Lint/format checks pass.  
- [ ] Docker image builds (`docker build .`) and starts (`docker run`) with correct entrypoints.  
- [ ] In Render Dashboard or CLI: create the `tenderbase-db` database (Neon) and link service env.  
- [ ] `render.yaml` is valid (`render validate blueprint`).  
- [ ] Cron schedule set (6h) and run command tested (`node dist/scraper/index.js`).  
- [ ] CORS and API key configs are set and tested with curl (valid vs invalid key).  
- [ ] Logging is configured (errors appear in Render logs), and any dashboards/alerts set up.  
- [ ] Security review: no secrets in code, dependencies are up-to-date, enabling HTTPS.  
- [ ] Documentation (README) is written.  

## Trade-Off Tables  

**Document Storage:**  
| Option                | Pros                                         | Cons                                   |
|-----------------------|----------------------------------------------|----------------------------------------|
| Download & store files| Offline access; easier parsing of text/PDF.  | More storage; files may change or expire. Requires job to re-fetch to update. |  
| Store URLs only       | Minimal storage, always fetch latest.        | Slower reads (need HTTP fetch on demand), risk of link rot. Harder to index content. |  

**Polling Interval:**  
| Interval | Pros                        | Cons                           |
|----------|-----------------------------|--------------------------------|
| Every 1h | Very fresh data; quick alert | High load on target and DB; likely redundant runs |
| Every 6h (default) | Good balance of freshness and load | Might miss very short-lived tenders (but unlikely for long tender periods) |
| Daily    | Low load; simple            | Data may be stale up to a day; slower to catch new entries |

**Concurrency Model:**  
| Model                    | Pros                                           | Cons                               |
|--------------------------|------------------------------------------------|------------------------------------|
| Single-thread sequential | Simplest, respects politeness, easier to debug | Slow for many pages; long runs |
| Multi-context parallel   | Faster throughput if many pages; can use more CPUs | Harder to rate-limit; risk of being blocked; more resource usage |

*(Concurrent orchestration stacks exist, but a single Playwright context is recommended as a starting point.)*

## Development Timeline (Mermaid Gantt)  

```mermaid
gantt
  title CIDB Scraper-API Development Timeline
  dateFormat  YYYY-MM-DD
  section Preparation
  Project setup and Neon DB config       :a1, 2026-09-01, 1w
  Prisma schema & migrations             :a2, after a1, 1w
  section Scraper Development
  Playwright prototype scraper           :b1, after a1, 2w
  Enhance scraping (selectors, pagination):b2, after b1, 2w
  Scraper logging & retries              :b3, after b2, 1w
  Scraper unit tests (fixtures)          :b4, after b2, 1w
  section API Development
  API endpoints & routes                 :c1, after a2, 2w
  Query/pagination logic                 :c2, after c1, 1w
  Full-text search integration           :c3, after c2, 1w
  API tests (unit/integration)           :c4, after c3, 1w
  section Deployment
  Dockerfile & local Docker tests        :d1, after b3,c4, 1w
  CI pipeline & Prisma migrations test   :d2, after d1, 1w
  Render.yaml config & preview deploy    :d3, after d2, 1w
  Full end-to-end testing & launch       :d4, after d3, 1w
```

This timeline spans approximately 8–10 weeks, with parallel streams for scraper and API development, followed by containerization, CI/CD, and deployment phases.

## README Outline  

A concise README might include:  
- **Project Overview:** Purpose and high-level architecture.  
- **Tech Stack:** Node.js, Playwright, Prisma, Neon Postgres, Render.  
- **Getting Started:** Prerequisites (Node, npm).  
- **Local Setup:** Steps to clone, `npm ci`, `.env` file (describe vars).  
- **Database:** Neon setup instructions (create DB, set URLs, run `prisma migrate dev`).  
- **Scraper:** How to run the scraper locally (`npm run scrape`).  
- **API:** How to start the API (`npm run start`), list of endpoints.  
- **Testing:** Running tests (`npm test`).  
- **Docker:** Build and run Docker image.  
- **Deployment:** Overview of Render setup (render.yaml), how to trigger cron, domain.  
- **Environment Variables:** Table of required vars (DATABASE_URL, DIRECT_URL, API_KEY, etc).  
- **Usage Examples:** Sample curl or Postman requests.  

## References  

- Render Cron & Blueprint docs  
- Prisma + Neon guides  
- Playwright Docker dependencies  
- PostgreSQL full-text search (GIN indexes)  
- Scraper logging & retry best practices  
- Test fixtures for scraping  

This comprehensive design should equip the engineer to implement a production-ready CIDB tender scraper with a Neon-backed API on Render, covering data modeling, crawling logic, system monitoring, and deployment details in full. All configurations and code snippets provided here are actionable starting points.