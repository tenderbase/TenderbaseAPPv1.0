import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { getMunicipalityAdapter, listMunicipalityAdapters } from "../municipalities/registry.js";
import { runMunicipalityIngest } from "../pipeline/municipality.js";
import { listTenders, getCategories, getProvinces, getMunicipalities, getProcurementTypes, getStats } from "./tenders.js";
import { toContractTender } from "./serialise.js";
import { getAdminDashboard, manualUpsertTender, relinkMunicipality } from "./admin.js";
import type { ManualTenderInput } from "./admin.js";

const ProcurementTypeSchema = z.enum(["TENDER", "RFQ", "QUOTATION", "EOI", "ADDENDUM", "AWARD", "CANCELLATION", "NOTICE", "OTHER"]);
const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).default(20), perPage: z.coerce.number().int().min(1).optional(),
  q: z.string().trim().min(1).optional(), search: z.string().trim().min(1).optional(), source: z.string().trim().min(1).optional(), province: z.string().trim().min(1).optional(), category: z.string().trim().min(1).optional(), status: z.string().trim().min(1).optional(), municipality: z.string().trim().min(1).optional(), municipalityCode: z.string().trim().min(1).optional(), procurementType: z.string().trim().min(1).transform((v) => v.toUpperCase()).optional(),
  closingBefore: z.string().datetime().optional(), closingAfter: z.string().datetime().optional(), publishedAfter: z.string().datetime().optional(), publishedBefore: z.string().datetime().optional(), cidbGrade: z.string().trim().min(1).optional(), organisation: z.string().trim().min(1).optional(),
  constructionOnly: z.union([z.boolean(), z.enum(["true", "false"])]).optional().transform((v) => v === true || v === "true"),
  sort: z.enum(["latest", "closing", "closing_desc", "published_asc"]).default("latest"),
});
const ManualTenderSchema = z.object({
  source: z.string().trim().min(1).max(100).default("MANUAL"), sourceUrl: z.string().url(), ocid: z.string().trim().min(1).max(300), releaseId: z.string().trim().min(1).max(300), tenderNumber: z.string().trim().min(1).max(300), procurementType: ProcurementTypeSchema.default("TENDER"), municipalityCode: z.string().trim().min(1).max(50).nullable().optional(), title: z.string().max(1000).nullable().optional(), description: z.string().max(20000).nullable().optional(), organisation: z.string().max(500).nullable().optional(), category: z.string().max(300).nullable().optional(), province: z.string().max(100).nullable().optional(), location: z.string().max(500).nullable().optional(), valueCents: z.number().int().nonnegative().nullable().optional(), publishedDate: z.string().datetime().nullable().optional(), closingDate: z.string().datetime().nullable().optional(), status: z.string().max(100).nullable().optional(), contactName: z.string().max(300).nullable().optional(), contactEmail: z.string().email().nullable().optional(), contactPhone: z.string().max(100).nullable().optional(), cidbGrade: z.string().max(50).nullable().optional(), cidbGradeRaw: z.string().max(500).nullable().optional(), documents: z.array(z.object({ name: z.string().max(500).nullable(), url: z.string().url(), fileType: z.string().max(150).nullable(), isAddendum: z.boolean() })).max(100).default([]), isOpportunity: z.boolean().default(true),
});
const RelinkSchema = z.object({ source: z.string().trim().min(1).max(100) });

const manualTenderOpenApi = {
  body: { type: "object", required: ["sourceUrl", "ocid", "releaseId", "tenderNumber"], properties: {
    source: { type: "string", default: "MANUAL", description: "Origin label, e.g. MANUAL or a municipality/source code." }, sourceUrl: { type: "string", format: "uri", description: "Official source page for the tender." }, ocid: { type: "string", description: "Stable procurement identifier." }, releaseId: { type: "string", description: "Release identifier for this record." }, tenderNumber: { type: "string", description: "Tender, RFQ or quotation number." },
    procurementType: { type: "string", enum: ["TENDER", "RFQ", "QUOTATION", "EOI", "ADDENDUM", "AWARD", "CANCELLATION", "NOTICE", "OTHER"], default: "TENDER" }, municipalityCode: { type: "string", nullable: true, description: "Registered municipality code, e.g. ETHEKWINI." }, title: { type: "string", nullable: true }, description: { type: "string", nullable: true }, organisation: { type: "string", nullable: true }, category: { type: "string", nullable: true }, province: { type: "string", nullable: true }, location: { type: "string", nullable: true }, valueCents: { type: "integer", minimum: 0, nullable: true, description: "Value in cents." }, publishedDate: { type: "string", format: "date-time", nullable: true }, closingDate: { type: "string", format: "date-time", nullable: true }, status: { type: "string", nullable: true }, contactName: { type: "string", nullable: true }, contactEmail: { type: "string", format: "email", nullable: true }, contactPhone: { type: "string", nullable: true }, cidbGrade: { type: "string", nullable: true }, cidbGradeRaw: { type: "string", nullable: true }, documents: { type: "array", items: { type: "object", required: ["url", "isAddendum"], properties: { name: { type: "string", nullable: true }, url: { type: "string", format: "uri" }, fileType: { type: "string", nullable: true }, isAddendum: { type: "boolean" } } } }, isOpportunity: { type: "boolean", default: true }
  } }
};

const swaggerUiExpandAll = function () {
  const expand = () => {
    document.querySelectorAll('.opblock-tag[aria-expanded="false"]').forEach((tag) => (tag as HTMLElement).click());
  };
  expand();
  window.setTimeout(expand, 100);
  window.setTimeout(expand, 500);
};

export function buildServer() {
  const app = Fastify({ logger: false });
  app.register(helmet, { contentSecurityPolicy: false });
  app.register(cors, { origin: (process.env.CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()).filter(Boolean) });
  app.register(fastifySwagger, { openapi: { info: { title: "TenderBase API", description: "South African public procurement data API. Use the interactive operations below to inspect data, test filters and run protected ingestion controls.", version: "1.5.0" }, servers: [{ url: "/", description: "Live TenderBase API" }], tags: [{ name: "public", description: "Tender search, statistics, metadata and individual tender records" }, { name: "admin", description: "Protected dataset management, municipality ingestion, manual tender entry and relinking" }], components: { securitySchemes: { AdminApiKey: { type: "apiKey", in: "header", name: "x-admin-key", description: "Admin key used for protected ingestion and dataset controls." }, PublicApiKey: { type: "apiKey", in: "header", name: "x-api-key", description: "Public API key, when configured." } } } } });
  app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "full",
      deepLinking: true,
      filter: true,
      displayRequestDuration: true,
      tryItOutEnabled: true,
      persistAuthorization: true,
      displayOperationId: false,
      defaultModelsExpandDepth: 2,
      defaultModelExpandDepth: 2,
      hideUntagged: false,
      tagsSorter: "alpha",
      operationsSorter: "alpha",
      onComplete: swaggerUiExpandAll,
    },
    theme: {
      js: [{
        filename: "tenderbase-swagger.js",
        content: `(() => { const expand = () => document.querySelectorAll('.opblock-tag[aria-expanded="false"]').forEach((tag) => tag.click()); window.addEventListener('load', expand); setTimeout(expand, 100); setTimeout(expand, 500); })();`,
      }],
    },
  });

  const apiKey = process.env.API_KEY;
  if (apiKey) app.addHook("onRequest", async (req, reply) => { const url = req.url; if (url.startsWith("/admin")) return; if (url === "/" || url.startsWith("/health") || url.startsWith("/docs")) return; const provided = (req.headers["x-api-key"] as string | undefined) ?? (req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""); if (provided !== apiKey) return reply.code(401).send({ error: "Unauthorized" }); });
  const requireAdmin = async (req: any, reply: any) => { const adminKey = process.env.ADMIN_API_KEY ?? process.env.API_KEY; if (!adminKey) return reply.code(503).send({ error: "Admin API is not configured" }); const provided = (req.headers["x-admin-key"] as string | undefined) ?? (req.headers["x-api-key"] as string | undefined) ?? (req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""); if (provided !== adminKey) return reply.code(401).send({ error: "Admin authorization required" }); };

  app.get("/", { schema: { tags: ["public"], summary: "Swagger documentation", description: "The API root redirects to the interactive Swagger UI." } }, async (_req, reply) => reply.redirect("/docs"));
  app.get("/health", { schema: { tags: ["public"], summary: "Health check" } }, async () => ({ status: "ok", source: "live", uptimeSeconds: Math.round(process.uptime()) }));
  app.get("/stats", { schema: { tags: ["public"], summary: "Dataset statistics", description: "Returns live TenderBase dataset and service statistics." } }, async () => ({ stats: { ...(await getStats()), uptimeSeconds: Math.round(process.uptime()) }, source: "live" }));
  app.get("/categories", { schema: { tags: ["public"], summary: "List tender categories" } }, async () => { const categories = await getCategories(); return { categories, total: categories.length, source: "live" }; });
  app.get("/provinces", { schema: { tags: ["public"], summary: "List provinces" } }, async () => { const provinces = await getProvinces(); return { provinces, total: provinces.length, source: "live" }; });
  app.get("/municipalities", { schema: { tags: ["public"], summary: "List municipalities", description: "Returns municipalities known to TenderBase and their current tender coverage." } }, async () => { const municipalities = await getMunicipalities(); return { municipalities, total: municipalities.length, source: "live" }; });
  app.get("/procurement-types", { schema: { tags: ["public"], summary: "List procurement types" } }, async () => { const procurementTypes = await getProcurementTypes(); return { procurementTypes, total: procurementTypes.length, source: "live" }; });
  app.get("/tenders", { schema: { tags: ["public"], summary: "Search and filter tenders", description: "Search live tender records. Supports municipality, procurement type, province, CIDB grade, construction-only, date and text filters." } }, async (req, reply) => { const parsed = QuerySchema.safeParse(req.query); if (!parsed.success) return reply.code(400).send({ error: "Invalid query", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }); try { const qp = parsed.data; const limit = Math.min(100, qp.perPage ?? qp.limit); const { rows, documentsByTender, total } = await listTenders({ page: qp.page, limit, q: qp.q ?? qp.search, source: qp.source, province: qp.province, category: qp.category, status: qp.status, municipality: qp.municipality, municipalityCode: qp.municipalityCode, procurementType: qp.procurementType, closingBefore: qp.closingBefore ? new Date(qp.closingBefore) : undefined, closingAfter: qp.closingAfter ? new Date(qp.closingAfter) : undefined, publishedAfter: qp.publishedAfter ? new Date(qp.publishedAfter) : undefined, publishedBefore: qp.publishedBefore ? new Date(qp.publishedBefore) : undefined, cidbGrade: qp.cidbGrade, organisation: qp.organisation, constructionOnly: qp.constructionOnly, sort: qp.sort }); return { results: rows.map((r) => toContractTender(r, documentsByTender.get(r.id) ?? [])), total, page: qp.page, totalPages: Math.max(1, Math.ceil(total / limit)), filters: { municipality: qp.municipality ?? qp.municipalityCode ?? null, procurementType: qp.procurementType ?? null }, source: "live" }; } catch (err) { console.error("Error in GET /tenders:", err); return reply.code(503).send({ error: "Tender data is temporarily unavailable" }); } });
  app.get<{ Params: { id: string } }>("/tenders/:id", { schema: { tags: ["public"], summary: "Get a tender by ID" } }, async (req, reply) => { try { const tender = await prisma.tender.findUnique({ where: { id: req.params.id } }); if (!tender) return reply.code(404).send({ error: "Tender not found" }); const docs = await prisma.tenderDocument.findMany({ where: { tenderId: tender.id } }); return { tender: { ...toContractTender(tender, docs), amendments: [] }, source: "live" }; } catch (err) { console.error("Error in GET /tenders/:id:", err); return reply.code(503).send({ error: "Tender data is temporarily unavailable" }); } });

  app.get("/admin/dashboard", { preHandler: requireAdmin, schema: { tags: ["admin"], security: [{ AdminApiKey: [] }], summary: "Admin dashboard", description: "View ingestion activity, source coverage, municipality counts and dataset health." } }, async () => ({ ...(await getAdminDashboard()), source: "live" }));
  app.get("/admin/municipalities", { preHandler: requireAdmin, schema: { tags: ["admin"], security: [{ AdminApiKey: [] }], summary: "List registered municipality adapters", description: "Shows the municipality adapters currently registered in the ingestion pipeline." } }, async () => ({ adapters: listMunicipalityAdapters().map((a) => ({ id: a.id, name: a.name, province: a.province, sourceUrl: a.sourceUrl })) }));
  app.get("/admin/municipalities/", { preHandler: requireAdmin, schema: { tags: ["admin"], security: [{ AdminApiKey: [] }], summary: "List registered municipality adapters (trailing slash)" } }, async () => ({ adapters: listMunicipalityAdapters().map((a) => ({ id: a.id, name: a.name, province: a.province, sourceUrl: a.sourceUrl })) }));
  app.post("/admin/tenders", { preHandler: requireAdmin, schema: { tags: ["admin"], security: [{ AdminApiKey: [] }], summary: "Manually create or update a tender", description: "Enter a tender, RFQ, EOI, award or other procurement record directly into TenderBase. Use municipalityCode to associate it with a registered municipality.", ...manualTenderOpenApi } }, async (req, reply) => { const parsed = ManualTenderSchema.safeParse(req.body); if (!parsed.success) return reply.code(400).send({ error: "Invalid tender payload", issues: parsed.error.issues }); try { const result = await manualUpsertTender(parsed.data as ManualTenderInput); return reply.code(result.outcome === "inserted" ? 201 : 200).send({ ...result, source: "live" }); } catch (err) { console.error("Manual tender ingestion failed:", err); return reply.code(400).send({ error: err instanceof Error ? err.message : "Manual ingestion failed" }); } });
  app.post<{ Params: { code: string }; Querystring: { backfill?: string } }>("/admin/municipalities/:code/ingest", { preHandler: requireAdmin, schema: { tags: ["admin"], security: [{ AdminApiKey: [] }], summary: "Run municipality ingestion", description: "Run the registered adapter for a municipality. For the current adapter enter ETHEKWINI. Set backfill to true when historical records should also be fetched.", params: { type: "object", required: ["code"], properties: { code: { type: "string", description: "Registered municipality adapter code, e.g. ETHEKWINI" } } }, querystring: { type: "object", properties: { backfill: { type: "string", enum: ["true", "false"], default: "false", description: "Fetch historical/backfill records when true" } } }, response: { 200: { description: "Ingestion completed" }, 404: { description: "Municipality adapter not registered" }, 502: { description: "Ingestion failed" } } } }, async (req, reply) => { const adapter = getMunicipalityAdapter(req.params.code); if (!adapter) return reply.code(404).send({ error: `No municipality adapter registered for ${req.params.code}` }); try { const result = await runMunicipalityIngest(adapter, { backfill: req.query.backfill === "true" }); return { ...result, source: "live" }; } catch (err) { console.error("Municipality ingestion failed:", err); return reply.code(502).send({ error: err instanceof Error ? err.message : "Municipality ingestion failed" }); } });
  app.post<{ Params: { code: string } }>("/admin/municipalities/:code/relink", { preHandler: requireAdmin, schema: { tags: ["admin"], security: [{ AdminApiKey: [] }], summary: "Relink existing tenders to a municipality", description: "Link existing tender records from a source to the selected municipality without re-scraping the source.", params: { type: "object", required: ["code"], properties: { code: { type: "string", description: "Registered municipality code, e.g. ETHEKWINI" } } }, body: { type: "object", required: ["source"], properties: { source: { type: "string", description: "Existing tender source code, e.g. ETHEKWINI" } } } } }, async (req, reply) => { const parsed = RelinkSchema.safeParse(req.body); if (!parsed.success) return reply.code(400).send({ error: "source is required" }); try { return { ...(await relinkMunicipality(req.params.code, parsed.data.source)), source: "live" }; } catch (err) { return reply.code(400).send({ error: err instanceof Error ? err.message : "Municipality relink failed" }); } });

  app.addHook("onClose", async () => { await prisma.$disconnect(); });
  return app;
}
