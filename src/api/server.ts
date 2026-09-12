import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import {
  listTenders,
  getCategories,
  getProvinces,
  getMunicipalities,
  getProcurementTypes,
  getStats,
} from "./tenders.js";
import { toContractTender } from "./serialise.js";

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).default(20),
  perPage: z.coerce.number().int().min(1).optional(),
  q: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  province: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  municipality: z.string().trim().min(1).optional(),
  municipalityCode: z.string().trim().min(1).optional(),
  procurementType: z.string().trim().min(1).transform((v) => v.toUpperCase()).optional(),
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

function buildDashboardHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TenderBase API</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#090d16;color:#f3f4f6;max-width:1000px;margin:0 auto;padding:40px;line-height:1.6}a{color:#38bdf8}code,pre{background:#111827;padding:4px 8px;border-radius:6px}section{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:20px;margin:18px 0}h1{margin-bottom:4px}p{color:#9ca3af}</style></head><body><h1>TenderBase API</h1><p>South African public procurement data feed.</p><section><h2>Documentation</h2><p><a href="/docs">Open Swagger / OpenAPI documentation →</a></p></section><section><h2>Core endpoints</h2><p><code>GET /tenders</code> — searchable tender feed</p><p><code>GET /municipalities</code> — enabled municipality filter options</p><p><code>GET /procurement-types</code> — procurement type options</p><p><code>GET /categories</code> — category counts</p><p><code>GET /provinces</code> — province counts</p><p><code>GET /stats</code> — dataset health metrics</p><p><code>GET /health</code> — liveness</p></section><section><h2>Municipal RFQ example</h2><pre>/tenders?municipality=ETHEKWINI&amp;procurementType=RFQ</pre></section></body></html>`;
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

  app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "TenderBase API",
        description: "South African public procurement data API",
        version: "1.0.0",
      },
      servers: [{ url: "/", description: "Live TenderBase API" }],
    },
  });

  app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: false },
  });

  const apiKey = process.env.API_KEY;
  if (apiKey) {
    app.addHook("onRequest", async (req, reply) => {
      const url = req.url;
      if (url === "/" || url.startsWith("/health") || url.startsWith("/docs")) return;
      const provided =
        (req.headers["x-api-key"] as string | undefined) ??
        (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      if (provided !== apiKey) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
    });
  }

  app.get("/", async (req, reply) => {
    const accept = req.headers.accept ?? "";
    if (accept.includes("text/html") || !accept.includes("application/json")) {
      return reply.type("text/html").send(buildDashboardHtml());
    }
    return {
      name: "TenderBase API",
      status: "ok",
      docs: "/docs",
      endpoints: ["/tenders", "/municipalities", "/procurement-types", "/categories", "/provinces", "/stats", "/health"],
    };
  });

  app.get("/health", async () => ({
    status: "ok",
    source: "live",
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.get("/stats", async () => {
    const stats = await getStats();
    return { stats: { ...stats, uptimeSeconds: Math.round(process.uptime()) }, source: "live" };
  });

  app.get("/categories", async () => {
    const categories = await getCategories();
    return { categories, total: categories.length, source: "live" };
  });

  app.get("/provinces", async () => {
    const provinces = await getProvinces();
    return { provinces, total: provinces.length, source: "live" };
  });

  app.get("/municipalities", async () => {
    const municipalities = await getMunicipalities();
    return { municipalities, total: municipalities.length, source: "live" };
  });

  app.get("/procurement-types", async () => {
    const procurementTypes = await getProcurementTypes();
    return { procurementTypes, total: procurementTypes.length, source: "live" };
  });

  app.get("/tenders", async (req, reply) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid query",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }

    try {
      const qp = parsed.data;
      const limit = Math.min(100, qp.perPage ?? qp.limit);
      const { rows, documentsByTender, total } = await listTenders({
        page: qp.page,
        limit,
        q: qp.q ?? qp.search,
        province: qp.province,
        category: qp.category,
        status: qp.status,
        municipality: qp.municipality,
        municipalityCode: qp.municipalityCode,
        procurementType: qp.procurementType,
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
        results: rows.map((r) => toContractTender(r, documentsByTender.get(r.id) ?? [])),
        total,
        page: qp.page,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        filters: {
          municipality: qp.municipality ?? qp.municipalityCode ?? null,
          procurementType: qp.procurementType ?? null,
        },
        source: "live",
      };
    } catch (err) {
      console.error("Error in GET /tenders:", err);
      return reply.code(503).send({ error: "Tender data is temporarily unavailable" });
    }
  });

  app.get<{ Params: { id: string } }>("/tenders/:id", async (req, reply) => {
    try {
      const tender = await prisma.tender.findUnique({ where: { id: req.params.id } });
      if (!tender) return reply.code(404).send({ error: "Tender not found" });
      const docs = await prisma.tenderDocument.findMany({ where: { tenderId: tender.id } });
      return { tender: { ...toContractTender(tender, docs), amendments: [] }, source: "live" };
    } catch (err) {
      console.error("Error in GET /tenders/:id:", err);
      return reply.code(503).send({ error: "Tender data is temporarily unavailable" });
    }
  });

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  return app;
}
