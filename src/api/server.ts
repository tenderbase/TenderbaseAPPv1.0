import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { listTenders, getCategories, getProvinces, getStats } from "./tenders.js";
import { toContractTender } from "./serialise.js";

/**
 * Query params schema. All original aliases and rules maintained, plus safe additive filters.
 */
const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).default(20),
  perPage: z.coerce.number().int().min(1).optional(),
  q: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  province: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  closingBefore: z.string().datetime().optional(),
  closingAfter: z.string().datetime().optional(),
  publishedAfter: z.string().datetime().optional(),
  publishedBefore: z.string().datetime().optional(),
  cidbGrade: z.string().trim().min(1).optional(),
  organisation: z.string().trim().min(1).optional(),
  constructionOnly: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((v) => v === true || v === "true"),
  sort: z.enum(["latest", "closing", "closing_desc", "published_asc"]).default("latest"),
});

function buildDashboardHtml(hostUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TenderBase — Public Tender API & Ingestion Engine</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --surface: #111827;
      --surface-border: #1f2937;
      --surface-hover: #1e293b;
      --primary: #38bdf8;
      --primary-glow: rgba(56, 189, 248, 0.15);
      --accent: #818cf8;
      --success: #34d399;
      --warning: #fbbf24;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --code-bg: #030712;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 0;
      min-height: 100vh;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2.5rem 1.5rem;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 2rem;
      border-bottom: 1px solid var(--surface-border);
      margin-bottom: 2.5rem;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .brand-icon {
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, var(--primary), var(--accent));
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      color: #000;
      font-size: 1.25rem;
      box-shadow: 0 0 20px var(--primary-glow);
    }
    .brand-text h1 { font-size: 1.5rem; font-weight: 800; letter-spacing: -0.02em; }
    .brand-text p { font-size: 0.875rem; color: var(--text-muted); }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(52, 211, 153, 0.1);
      border: 1px solid rgba(52, 211, 153, 0.2);
      color: var(--success);
      padding: 0.4rem 0.85rem;
      border-radius: 9999px;
      font-size: 0.8125rem;
      font-weight: 600;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      background-color: var(--success);
      border-radius: 50%;
      box-shadow: 0 0 10px var(--success);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(1.2); }
      100% { opacity: 1; transform: scale(1); }
    }
    .hero {
      margin-bottom: 3rem;
    }
    .hero h2 {
      font-size: 2.25rem;
      font-weight: 800;
      margin-bottom: 0.75rem;
      background: linear-gradient(to right, #ffffff, #94a3b8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.03em;
    }
    .hero p {
      font-size: 1.125rem;
      color: var(--text-muted);
      max-width: 750px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1.25rem;
      margin-bottom: 3rem;
    }
    .stat-card {
      background-color: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: 14px;
      padding: 1.25rem 1.5rem;
      transition: all 0.2s ease;
    }
    .stat-card:hover {
      border-color: var(--primary);
      transform: translateY(-2px);
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
    }
    .stat-label { font-size: 0.8125rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-value { font-size: 2rem; font-weight: 800; color: #fff; margin: 0.35rem 0; letter-spacing: -0.02em; }
    .stat-desc { font-size: 0.8125rem; color: var(--text-muted); }
    .section-title {
      font-size: 1.25rem;
      font-weight: 700;
      margin-bottom: 1.25rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .endpoints-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 1rem;
      margin-bottom: 3rem;
    }
    .endpoint-card {
      background-color: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: 12px;
      padding: 1.25rem 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      text-decoration: none;
      color: inherit;
      transition: all 0.2s;
    }
    .endpoint-card:hover {
      border-color: var(--primary);
      background-color: var(--surface-hover);
    }
    .endpoint-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .method-tag {
      background-color: rgba(56, 189, 248, 0.15);
      color: var(--primary);
      font-family: 'JetBrains Mono', monospace;
      font-weight: 700;
      font-size: 0.75rem;
      padding: 0.25rem 0.6rem;
      border-radius: 6px;
      border: 1px solid rgba(56, 189, 248, 0.3);
    }
    .endpoint-path {
      font-family: 'JetBrains Mono', monospace;
      font-size: 1rem;
      font-weight: 600;
      color: #fff;
    }
    .endpoint-desc { font-size: 0.9rem; color: var(--text-muted); }
    .cta-banner {
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.1), rgba(129, 140, 248, 0.1));
      border: 1px solid rgba(56, 189, 248, 0.2);
      border-radius: 16px;
      padding: 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1.5rem;
      margin-bottom: 3rem;
    }
    .cta-text h3 { font-size: 1.25rem; font-weight: 700; margin-bottom: 0.25rem; }
    .cta-text p { color: var(--text-muted); font-size: 0.95rem; }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: linear-gradient(135deg, var(--primary), var(--accent));
      color: #000;
      font-weight: 700;
      font-size: 0.9375rem;
      padding: 0.75rem 1.5rem;
      border-radius: 10px;
      text-decoration: none;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 20px -5px var(--primary-glow);
    }
    .code-box {
      background-color: var(--code-bg);
      border: 1px solid var(--surface-border);
      border-radius: 12px;
      padding: 1.25rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.875rem;
      color: #e2e8f0;
      overflow-x: auto;
      margin-bottom: 3rem;
    }
    footer {
      text-align: center;
      padding-top: 2rem;
      border-top: 1px solid var(--surface-border);
      color: var(--text-muted);
      font-size: 0.875rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <div class="brand-icon">TB</div>
        <div class="brand-text">
          <h1>TenderBase API</h1>
          <p>SA Public Procurement Data Feed</p>
        </div>
      </div>
      <div class="status-badge">
        <span class="status-dot"></span>
        <span>Pipeline Live — Hourly Cron active</span>
      </div>
    </header>

    <div class="hero">
      <h2>Powering Tender Base Applications</h2>
      <p>Clean, normalized, full-text searchable South African national and provincial tender feed. Mirrored to 100% app-compatible contract shapes.</p>
    </div>

    <div class="stats-grid" id="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Tenders</div>
        <div class="stat-value" id="stat-total">1,850+</div>
        <div class="stat-desc">Indexed OCDS Releases</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Active Opportunities</div>
        <div class="stat-value" id="stat-active" style="color: var(--success);">Active</div>
        <div class="stat-desc">Open for bidding</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Provinces Covered</div>
        <div class="stat-value" id="stat-provinces" style="color: var(--primary);">10</div>
        <div class="stat-desc">9 Provinces + National</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Taxonomy Categories</div>
        <div class="stat-value" id="stat-categories" style="color: var(--accent);">79</div>
        <div class="stat-desc">Normalized categories</div>
      </div>
    </div>

    <div class="cta-banner">
      <div class="cta-text">
        <h3>Interactive OpenAPI Documentation</h3>
        <p>Explore schemas, test parameters, and generate client SDKs via Swagger UI.</p>
      </div>
      <a href="/docs" class="btn">
        <span>Open Swagger Docs</span>
        <span>→</span>
      </a>
    </div>

    <div class="section-title">API Endpoint Reference</div>
    <div class="endpoints-grid">
      <a href="/tenders?limit=5" class="endpoint-card">
        <div class="endpoint-header">
          <span class="method-tag">GET</span>
          <span class="endpoint-path">/tenders</span>
        </div>
        <div class="endpoint-desc">List tenders with pagination, full-text search (q), province, category, status, construction filters, and custom sorting.</div>
      </a>

      <a href="/categories" class="endpoint-card">
        <div class="endpoint-header">
          <span class="method-tag">GET</span>
          <span class="endpoint-path">/categories</span>
        </div>
        <div class="endpoint-desc">Get pre-aggregated list of tender categories with counts to populate UI filter dropdowns.</div>
      </a>

      <a href="/provinces" class="endpoint-card">
        <div class="endpoint-header">
          <span class="method-tag">GET</span>
          <span class="endpoint-path">/provinces</span>
        </div>
        <div class="endpoint-desc">Get pre-aggregated list of provinces with counts for geographical filtering.</div>
      </a>

      <a href="/stats" class="endpoint-card">
        <div class="endpoint-header">
          <span class="method-tag">GET</span>
          <span class="endpoint-path">/stats</span>
        </div>
        <div class="endpoint-desc">Pipeline health and dataset metrics (active, completed, expiring soon, latest sync).</div>
      </a>

      <a href="/health" class="endpoint-card">
        <div class="endpoint-header">
          <span class="method-tag">GET</span>
          <span class="endpoint-path">/health</span>
        </div>
        <div class="endpoint-desc">Liveness probe returning server uptime and operational status.</div>
      </a>
    </div>

    <div class="section-title">Sample Integration Code</div>
    <div class="code-box">
<span style="color: #64748b;">// Fetch latest catering tenders in KwaZulu-Natal</span>
<span style="color: #38bdf8;">const</span> response = <span style="color: #38bdf8;">await</span> fetch(<span style="color: #34d399;">'/tenders?province=KwaZulu-Natal&q=catering&limit=10'</span>);
<span style="color: #38bdf8;">const</span> data = <span style="color: #38bdf8;">await</span> response.json();
console.log(<span style="color: #34d399;">\`Found \${data.total} tenders matching query\`</span>);
    </div>

    <footer>
      <p>TenderBase Pipeline &bull; Automated hourly OCDS ingestion &bull; PDDL 1.0 Licence</p>
    </footer>
  </div>

  <script>
    fetch('/stats')
      .then(res => res.json())
      .then(data => {
        if (data && data.stats) {
          document.getElementById('stat-total').innerText = data.stats.totalTenders.toLocaleString();
          document.getElementById('stat-active').innerText = data.stats.activeTenders.toLocaleString();
          document.getElementById('stat-provinces').innerText = data.stats.provincesCount.toLocaleString();
          document.getElementById('stat-categories').innerText = data.stats.categoriesCount.toLocaleString();
        }
      })
      .catch(() => {});
  </script>
</body>
</html>`;
}

export function buildServer() {
  const app = Fastify({ logger: false });

  app.register(helmet, { contentSecurityPolicy: false });
  app.register(cors, {
    origin: (process.env.CORS_ORIGINS ?? "*")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  });

  // OpenAPI Swagger Documentation
  app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "TenderBase API",
        description: "Ingestion pipeline & REST API for South African eTenders OCDS procurement data",
        version: "1.0.0",
      },
      servers: [{ url: "/", description: "Live TenderBase API" }],
    },
  });

  app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: false,
    },
  });

  // Optional API key hook. Skipped for /, /docs, /health so public UI & healthchecks work.
  const apiKey = process.env.API_KEY;
  if (apiKey) {
    app.addHook("onRequest", async (req, reply) => {
      const url = req.url;
      if (url === "/" || url.startsWith("/health") || url.startsWith("/docs")) return;
      const provided =
        (req.headers["x-api-key"] as string | undefined) ??
        (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      if (provided !== apiKey) {
        reply.code(401).send({ error: "Unauthorized" });
      }
    });
  }

  // Visual UI Landing Page on GET /
  app.get("/", async (req, reply) => {
    const accept = req.headers.accept ?? "";
    if (accept.includes("text/html") || !accept.includes("application/json")) {
      return reply.type("text/html").send(buildDashboardHtml(""));
    }
    return {
      name: "TenderBase API",
      status: "ok",
      docs: "/docs",
      endpoints: ["/tenders", "/categories", "/provinces", "/stats", "/health"],
    };
  });

  app.get("/health", async () => ({
    status: "ok",
    source: "live",
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.get("/stats", async () => {
    const stats = await getStats();
    return {
      stats: {
        ...stats,
        uptimeSeconds: Math.round(process.uptime()),
      },
      source: "live",
    };
  });

  app.get("/categories", async () => {
    const categories = await getCategories();
    return {
      categories,
      total: categories.length,
      source: "live",
    };
  });

  app.get("/provinces", async () => {
    const provinces = await getProvinces();
    return {
      provinces,
      total: provinces.length,
      source: "live",
    };
  });

  app.get("/tenders", async (req, reply) => {
    try {
      const parsed = QuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid query",
          issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        });
      }
      const qp = parsed.data;
      const limit = Math.min(100, qp.perPage ?? qp.limit);
      const q = qp.q ?? qp.search;

      const { rows, documentsByTender, total } = await listTenders({
        page: qp.page,
        limit,
        q,
        province: qp.province,
        category: qp.category,
        status: qp.status,
        closingBefore: qp.closingBefore ? new Date(qp.closingBefore) : undefined,
        closingAfter: qp.closingAfter ? new Date(qp.closingAfter) : undefined,
        publishedAfter: qp.publishedAfter ? new Date(qp.publishedAfter) : undefined,
        publishedBefore: qp.publishedBefore ? new Date(qp.publishedBefore) : undefined,
        cidbGrade: qp.cidbGrade,
        organisation: qp.organisation,
        constructionOnly: qp.constructionOnly,
        sort: qp.sort,
      });

      return {
        results: rows.map((r) =>
          toContractTender(r as any, documentsByTender.get(r.id) ?? [])
        ),
        total,
        page: qp.page,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        source: "live",
      };
    } catch (err) {
      console.error("Error in GET /tenders:", err);
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.get<{ Params: { id: string } }>("/tenders/:id", async (req, reply) => {
    const tender = await prisma.tender.findUnique({ where: { id: req.params.id } });
    if (!tender) return reply.code(404).send({ error: "Tender not found" });
    const docs = await prisma.tenderDocument.findMany({
      where: { tenderId: tender.id },
    });
    return {
      tender: { ...toContractTender(tender, docs), amendments: [] },
      source: "live",
    };
  });

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  return app;
}
