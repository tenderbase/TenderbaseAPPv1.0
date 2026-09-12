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

const tenderQueryOpenApi = {
  type: "object",
  properties: {
    page: { type: "integer", minimum: 1, default: 1, description: "Page number." },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 20, description: "Results per page." },
    perPage: { type: "integer", minimum: 1, maximum: 100, description: "Alias for limit." },
    q: { type: "string", description: "Full-text tender search." },
    search: { type: "string", description: "Alias for q." },
    source: { type: "string", description: "Source code." },
    province: { type: "string" }, category: { type: "string" }, status: { type: "string" },
    municipality: { type: "string", description: "Municipality name or code." },
    municipalityCode: { type: "string", description: "Registered municipality code, e.g. ETHEKWINI." },
    procurementType: { type: "string", enum: ["TENDER", "RFQ", "QUOTATION", "EOI", "ADDENDUM", "AWARD", "CANCELLATION", "NOTICE", "OTHER"] },
    closingBefore: { type: "string", format: "date-time" }, closingAfter: { type: "string", format: "date-time" },
    publishedAfter: { type: "string", format: "date-time" }, publishedBefore: { type: "string", format: "date-time" },
    cidbGrade: { type: "string" }, organisation: { type: "string" },
    constructionOnly: { type: "boolean", description: "Return construction-related opportunities only." },
    sort: { type: "string", enum: ["latest", "closing", "closing_desc", "published_asc"], default: "latest" },
  },
};

const manualTenderOpenApi = {
  body: { type: "object", required: ["sourceUrl", "ocid", "releaseId", "tenderNumber"], properties: {
    source: { type: "string", default: "MANUAL", description: "Origin label, e.g. MANUAL or a municipality/source code." }, sourceUrl: { type: "string", format: "uri", description: "Official source page for the tender." }, ocid: { type: "string", description: "Stable procurement identifier." }, releaseId: { type: "string", description: "Release identifier for this record." }, tenderNumber: { type: "string", description: "Tender, RFQ or quotation number." },
    procurementType: { type: "string", enum: ["TENDER", "RFQ", "QUOTATION", "EOI", "ADDENDUM", "AWARD", "CANCELLATION", "NOTICE", "OTHER"], default: "TENDER" }, municipalityCode: { type: "string", nullable: true, description: "Registered municipality code, e.g. ETHEKWINI." }, title: { type: "string", nullable: true }, description: { type: "string", nullable: true }, organisation: { type: "string", nullable: true }, category: { type: "string", nullable: true }, province: { type: "string", nullable: true }, location: { type: "string", nullable: true }, valueCents: { type: "integer", minimum: 0, nullable: true, description: "Value in cents." }, publishedDate: { type: "string", format: "date-time", nullable: true }, closingDate: { type: "string", format: "date-time", nullable: true }, status: { type: "string", nullable: true }, contactName: { type: "string", nullable: true }, contactEmail: { type: "string", format: "email", nullable: true }, contactPhone: { type: "string", nullable: true }, cidbGrade: { type: "string", nullable: true }, cidbGradeRaw: { type: "string", nullable: true }, documents: { type: "array", items: { type: "object", required: ["url", "isAddendum"], properties: { name: { type: "string", nullable: true }, url: { type: "string", format: "uri" }, fileType: { type: "string", nullable: true }, isAddendum: { type: "boolean" } } } }, isOpportunity: { type: "boolean", default: true }
  } }
};

const tenderBaseCss = `
:root{--tb-navy:#0b1220;--tb-panel:#111a2b;--tb-border:#26344d;--tb-text:#e8eef8;--tb-muted:#91a0b8;--tb-accent:#22c55e;--tb-blue:#38bdf8}
html,body{background:#f5f7fb!important;color:#172033!important;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important}
body:before{content:"TenderBase API";display:block;background:linear-gradient(135deg,#07101f,#10243d 60%,#0d5f43);color:#fff;font-size:24px;font-weight:800;letter-spacing:-.04em;padding:20px 5%;box-shadow:0 8px 30px rgba(7,16,31,.16)}
.swagger-ui{max-width:1180px;margin:0 auto;padding:18px 22px 70px!important}
.swagger-ui .topbar{display:none!important}
.swagger-ui .information-container{margin:0 0 18px!important;background:#fff;border:1px solid #e4e9f1;border-radius:18px;padding:28px 30px;box-shadow:0 10px 30px rgba(15,23,42,.06)}
.swagger-ui .info .title{font-size:32px!important;color:#101827!important;font-weight:800!important;letter-spacing:-.03em}
.swagger-ui .info p,.swagger-ui .info li{color:#66748a!important;font-size:14px!important}
.swagger-ui .scheme-container{background:#fff!important;border:1px solid #e4e9f1;border-radius:16px;box-shadow:0 8px 24px rgba(15,23,42,.05);padding:18px 22px!important}
.swagger-ui .btn.authorize{border:0!important;border-radius:10px!important;background:#0f172a!important;color:#fff!important;font-weight:700!important}
.swagger-ui .opblock-tag{margin:18px 0 0!important;border:1px solid #dce3ed!important;border-radius:15px!important;background:#fff!important;padding:16px 18px!important;box-shadow:0 6px 18px rgba(15,23,42,.04)}
.swagger-ui .opblock-tag .nostyle{font-size:18px!important;font-weight:800!important;color:#172033!important}
.swagger-ui .opblock-tag small{color:#718096!important}
.swagger-ui .opblock-tag-section{display:block!important;margin:0!important;padding:0!important}
.swagger-ui .opblock-tag-section .opblock{display:block!important;visibility:visible!important;opacity:1!important}
.swagger-ui .opblock{margin:10px 0!important;border-radius:14px!important;border:1px solid #dce3ed!important;box-shadow:0 5px 16px rgba(15,23,42,.04)!important;overflow:hidden}
.swagger-ui .opblock .opblock-summary{padding:13px 15px!important}
.swagger-ui .opblock .opblock-summary-description{font-weight:600!important;color:#46556c!important}
.swagger-ui .opblock .opblock-summary-method{border-radius:7px!important;min-width:72px!important;font-weight:800!important;box-shadow:none!important}
.swagger-ui .opblock.opblock-get .opblock-summary-method{background:#0ea5e9!important}.swagger-ui .opblock.opblock-post .opblock-summary-method{background:#16a34a!important}.swagger-ui .opblock.opblock-delete .opblock-summary-method{background:#dc2626!important}.swagger-ui .opblock.opblock-put .opblock-summary-method{background:#d97706!important}
.swagger-ui .opblock-body{background:#fafbfd!important}
.swagger-ui .btn{border-radius:8px!important;font-weight:700!important}
.swagger-ui input,.swagger-ui textarea,.swagger-ui select{border-radius:8px!important;border:1px solid #cbd5e1!important;box-shadow:none!important}
.swagger-ui .model-box{border-radius:10px!important;background:#111a2b!important}
.swagger-ui section.models{border:1px solid #dce3ed!important;border-radius:14px!important;background:#fff!important}
.swagger-ui .filter-container{background:#fff!important;padding:10px 0!important}
.swagger-ui .filter .operation-filter-input{border-radius:10px!important;padding:10px 14px!important}
.swagger-ui .response-col_status{font-weight:800!important}
@media(max-width:700px){.swagger-ui{padding:10px!important}.swagger-ui .information-container{padding:20px}.swagger-ui .info .title{font-size:25px!important}}
`;

export function buildServer() {
  const app = Fastify({ logger: false });
  app.register(helmet, { contentSecurityPolicy: false });
  app.register(cors, { origin: (process.env.CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()).filter(Boolean) });
  app.register(fastifySwagger, { openapi: { openapi: "3.0.3", info: { title: "TenderBase API", description: "South African public procurement intelligence API. Search live tender data, inspect municipal coverage, run ingestion controls and manage tender records.", version: "1.6.0" }, servers: [{ url: "/", description: "Live TenderBase API" }], tags: [{ name: "public", description: "Search, statistics, metadata and tender records" }, { name: "admin", description: "Protected ingestion, municipality controls and manual tender management" }], components: { securitySchemes: { AdminApiKey: { type: "apiKey", in: "header", name: "x-admin-key", description: "Admin key for protected dataset controls." }, PublicApiKey: { type: "apiKey", in: "header", name: "x-api-key", description: "Public API key, when configured." } } } } });
  app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    uiConfig: { url: "/docs/json", docExpansion: "full", deepLinking: true, filter: true, displayRequestDuration: true, tryItOutEnabled: true, persistAuthorization: true, displayOperationId: false, defaultModelsExpandDepth: 2, defaultModelExpandDepth: 2, tagsSorter: "alpha", operationsSorter: "alpha" },
    theme: { title: "TenderBase API Reference", css: [{ filename: "tenderbase-api.css", content: tenderBaseCss }] },
  });

  const apiKey = process.env.API_KEY;
  if (apiKey) app.addHook("onRequest", async (req, reply) => { const url = req.url; if (url.startsWith("/admin")) return; if (url === "/" || url.startsWith("/health") || url.startsWith("/docs")) return; const provided = (req.headers["x-api-key"] as string | undefined) ?? (req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""); if (provided !== apiKey) return reply.code(401).send({ error: "Unauthorized" }); });
  const requireAdmin = async (req: any, reply: any) => { const adminKey = process.env.ADMIN_API_KEY ?? process.env.API_KEY; if (!adminKey) return reply.code(503).send({ error: "Admin API is not configured" }); const provided = (req.headers["x-admin-key"] as string | undefined) ?? (req.headers["x-api-key"] as string | undefined) ?? (req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""); if (provided !== adminKey) return reply.code(401).send({ error: "Admin authorization required" }); };

  app.get("/", { schema: { tags: ["public"], summary: "API documentation", description: "Redirects to the TenderBase interactive API reference." } }, async (_req, reply) => reply.redirect("/docs"));
  app.get("/health", { schema: { tags: ["public"], summary: "Health check", response: { 200: { type: "object", properties: { status: { type: "string" }, source: { type: "string" }, uptimeSeconds: { type: "integer" } } } } } }, async () => ({ status: "ok", source: "live", uptimeSeconds: Math.round(process.uptime()) }));
  app.get("/stats", { schema: { tags: ["public"], summary: "Dataset statistics", description: "Returns live TenderBase dataset and service statistics." } }, async () => ({ stats: { ...(await getStats()), uptimeSeconds: Math.round(process.uptime()) }, source: "live" }));
  app.get("/categories", { schema: { tags: ["public"], summary: "List tender categories" } }, async () => { const categories = await getCategories(); return { categories, total: categories.length, source: "live" }; });
  app.get("/provinces", { schema: { tags: ["public"], summary: "List provinces" } }, async () => { const provinces = await getProvinces(); return { provinces, total: provinces.length, source: "live" }; });
  app.get("/municipalities", { schema: { tags: ["public"], summary: "List municipalities", description: "Returns municipalities known to TenderBase and their current tender coverage." } }, async () => { const municipalities = await getMunicipalities(); return { municipalities, total: municipalities.length, source: "live" }; });
  app.get("/procurement-types", { schema: { tags: ["public"], summary: "List procurement types" } }, async () => { const procurementTypes = await getProcurementTypes(); return { procurementTypes, total: procurementTypes.length, source: "live" }; });
  app.get("/tenders", { schema: { tags: ["public"], summary: "Search and filter tenders", description: "Search live tender records using text, municipality, procurement type, province, CIDB grade, construction and date filters.", querystring: tenderQueryOpenApi } }, async (req, reply) => { const parsed = QuerySchema.safeParse(req.query); if (!parsed.success) return reply.code(400).send({ error: "Invalid query", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }); try { const qp = parsed.data; const limit = Math.min(100, qp.perPage ?? qp.limit); const { rows, documentsByTender, total } = await listTenders({ page: qp.page, limit, q: qp.q ?? qp.search, source: qp.source, province: qp.province, category: qp.category, status: qp.status, municipality: qp.municipality, municipalityCode: qp.municipalityCode, procurementType: qp.procurementType, closingBefore: qp.closingBefore ? new Date(qp.closingBefore) : undefined, closingAfter: qp.closingAfter ? new Date(qp.closingAfter) : undefined, publishedAfter: qp.publishedAfter ? new Date(qp.publishedAfter) : undefined, publishedBefore: qp.publishedBefore ? new Date(qp.publishedBefore) : undefined, cidbGrade: qp.cidbGrade, organisation: qp.organisation, constructionOnly: qp.constructionOnly, sort: qp.sort }); return { results: rows.map((r) => toContractTender(r, documentsByTender.get(r.id) ?? [])), total, page: qp.page, totalPages: Math.max(1, Math.ceil(total / limit)), filters: { municipality: qp.municipality ?? qp.municipalityCode ?? null, procurementType: qp.procurementType ?? null }, source: "live" }; } catch (err) { console.error("Error in GET /tenders:", err); return reply.code(503).send({ error: "Tender data is temporarily unavailable" }); } });
  app.get<{ Params: { id: string } }>("/tenders/:id", { schema: { tags: ["public"], summary: "Get a tender by ID", params: { type: "object", required: ["id"], properties: { id: { type: "string", description: "Tender database ID." } } } } }, async (req, reply) => { try { const tender = await prisma.tender.findUnique({ where: { id: req.params.id } }); if (!tender) return reply.code(404).send({ error: "Tender not found" }); const docs = await prisma.tenderDocument.findMany({ where: { tenderId: tender.id } }); return { tender: { ...toContractTender(tender, docs), amendments: [] }, source: "live" }; } catch (err) { console.error("Error in GET /tenders/:id:", err); return reply.code(503).send({ error: "Tender data is temporarily unavailable" }); } });

  app.get("/admin/dashboard", { preHandler: requireAdmin, schema: { tags: ["admin"], security: [{ AdminApiKey: [] }], summary: "Admin dashboard", description: "View ingestion activity, source coverage, municipality counts and dataset health." } }, async () => ({ ...(await getAdminDashboard()), source: "live" }));
  app.get("/admin/municipalities", { preHandler: requireAdmin, schema: { tags: ["admin"], security: [{ AdminApiKey: [] }], summary: "List registered municipality adapters", description: "Shows municipality adapters currently registered in the ingestion pipeline." } }, async () => ({ adapters: listMunicipalityAdapters().map((a) => ({ id: a.id, name: a.name, province: a.province, sourceUrl: a.sourceUrl })) }));
  app.get("/admin/municipalities/", { preHandler: requireAdmin, schema: { tags: ["admin"], security: [{ AdminApiKey: [] }], summary: "List registered municipality adapters (trailing slash)" } }, async () => ({ adapters: listMunicipalityAdapters().map((a) => ({ id: a.id, name: a.name, province: a.province, sourceUrl: a.sourceUrl })) }));
  app.post("/admin/tenders", { preHandler: requireAdmin, schema: { tags: ["admin"], security: [{ AdminApiKey: [] }], summary: "Manually create or update a tender", description: "Enter a tender, RFQ, EOI, award or other procurement record directly into TenderBase. Use municipalityCode to associate it with a registered municipality.", ...manualTenderOpenApi } }, async (req, reply) => { const parsed = ManualTenderSchema.safeParse(req.body); if (!parsed.success) return reply.code(400).send({ error: "Invalid tender payload", issues: parsed.error.issues }); try { const result = await manualUpsertTender(parsed.data as ManualTenderInput); return reply.code(result.outcome === "inserted" ? 201 : 200).send({ ...result, source: "live" }); } catch (err) { console.error("Manual tender ingestion failed:", err); return reply.code(400).send({ error: err instanceof Error ? err.message : "Manual ingestion failed" }); } });
  app.post<{ Params: { code: string }; Querystring: { backfill?: string } }>("/admin/municipalities/:code/ingest", { preHandler: requireAdmin, schema: { tags: ["admin"], security: [{ AdminApiKey: [] }], summary: "Run municipality ingestion", description: "Run the registered adapter for a municipality. For the current adapter enter ETHEKWINI. Set backfill to true when historical records should also be fetched.", params: { type: "object", required: ["code"], properties: { code: { type: "string", description: "Registered municipality adapter code, e.g. ETHEKWINI" } } }, querystring: { type: "object", properties: { backfill: { type: "string", enum: ["true", "false"], default: "false", description: "Fetch historical/backfill records when true" } } }, response: { 200: { description: "Ingestion completed" }, 404: { description: "Municipality adapter not registered" }, 502: { description: "Ingestion failed" } } } }, async (req, reply) => { const adapter = getMunicipalityAdapter(req.params.code); if (!adapter) return reply.code(404).send({ error: `No municipality adapter registered for ${req.params.code}` }); try { const result = await runMunicipalityIngest(adapter, { backfill: req.query.backfill === "true" }); return { ...result, source: "live" }; } catch (err) { console.error("Municipality ingestion failed:", err); return reply.code(502).send({ error: err instanceof Error ? err.message : "Municipality ingestion failed" }); } });
  app.post<{ Params: { code: string } }>("/admin/municipalities/:code/relink", { preHandler: requireAdmin, schema: { tags: ["admin"], security: [{ AdminApiKey: [] }], summary: "Relink existing tenders to a municipality", description: "Link existing tender records from a source to the selected municipality without re-scraping the source.", params: { type: "object", required: ["code"], properties: { code: { type: "string", description: "Registered municipality code, e.g. ETHEKWINI" } } }, body: { type: "object", required: ["source"], properties: { source: { type: "string", description: "Existing tender source code, e.g. ETHEKWINI" } } } } }, async (req, reply) => { const parsed = RelinkSchema.safeParse(req.body); if (!parsed.success) return reply.code(400).send({ error: "source is required" }); try { return { ...(await relinkMunicipality(req.params.code, parsed.data.source)), source: "live" }; } catch (err) { return reply.code(400).send({ error: err instanceof Error ? err.message : "Municipality relink failed" }); } });

  app.addHook("onClose", async () => { await prisma.$disconnect(); });
  return app;
}
