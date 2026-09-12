import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { z } from "zod";
import { config, corsOrigins } from "./config.js";
import { ensureSchema, pool } from "./db.js";
import { runOcdsIngestion } from "../api-v2/ingestion/run.js";

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().optional(),
  province: z.string().trim().optional(),
  municipality: z.string().trim().optional(),
  category: z.string().trim().optional(),
  status: z.string().trim().optional(),
  procurementType: z.string().trim().optional(),
});

export async function buildServer() {
  await ensureSchema();

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: corsOrigins });
  await app.register(helmet);
  await app.register(swagger, {
    openapi: {
      info: { title: "TenderBase API V2", version: "2.0.0", description: "South African public procurement API" },
      servers: [{ url: "https://tenderbaseapiv2-0.onrender.com" }],
      components: { securitySchemes: { ingestApiKey: { type: "apiKey", in: "header", name: "x-api-key" } } },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.get("/health", async (_request, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ok", service: "tenderbaseapiv2.0", database: "ok", version: "2.0.0" };
    } catch {
      return reply.code(503).send({ status: "degraded", service: "tenderbaseapiv2.0", database: "error", version: "2.0.0" });
    }
  });

  app.get("/tenders", async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    const { page, limit, q, province, municipality, category, status, procurementType } = parsed.data;
    const offset = (page - 1) * limit;
    const values: unknown[] = [];
    const where: string[] = [];
    const add = (sql: string, value: unknown) => { values.push(value); where.push(`${sql} $${values.length}`); };

    if (q) add("(t.title ILIKE '%' ||", q + "%");
    if (province) add("t.province =", province);
    if (category) add("t.category =", category);
    if (status) add("t.status =", status);
    if (procurementType) add("t.procurement_type =", procurementType);
    if (municipality) add("m.code =", municipality);
    if (q) where[where.length - 1] = `(t.title ILIKE '%' || $${values.length} || '%' OR t.description ILIKE '%' || $${values.length} || '%')`;

    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const countResult = await pool.query(`SELECT count(*)::int AS count FROM tenders t LEFT JOIN municipalities m ON m.id=t.municipality_id ${clause}`, values);
    const dataValues = [...values, limit, offset];
    const result = await pool.query(`
      SELECT t.id, t.source, t.source_url AS "sourceUrl", t.ocid, t.release_id AS "releaseId",
             t.tender_number AS "tenderNumber", t.procurement_type AS "procurementType",
             t.title, t.description, t.category, t.province, t.location,
             t.value_cents AS "valueCents", t.currency, t.published_date AS "publishedDate",
             t.closing_date AS "closingDate", t.status, t.contact_name AS "contactName",
             t.contact_email AS "contactEmail", t.contact_phone AS "contactPhone",
             t.municipality_id AS "municipalityId", m.name AS "municipalityName"
      FROM tenders t LEFT JOIN municipalities m ON m.id=t.municipality_id
      ${clause} ORDER BY t.published_date DESC NULLS LAST, t.id DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `, dataValues);

    return { data: result.rows, meta: { page, limit, total: countResult.rows[0].count, pages: Math.ceil(countResult.rows[0].count / limit) } };
  });

  app.post("/admin/ingest/ocds", {
    schema: {
      security: [{ ingestApiKey: [] }],
    },
  }, async (request, reply) => {
    const configuredKey = process.env.INGEST_API_KEY?.trim();
    const providedKey = String(request.headers["x-api-key"] ?? "").trim();
    if (!configuredKey || !providedKey || providedKey !== configuredKey) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    if (!process.env.OCDS_API_URL) {
      return reply.code(503).send({ error: "OCDS_API_URL is not configured" });
    }
    const maxPages = Math.min(100, Math.max(1, Number(process.env.OCDS_MAX_PAGES ?? 1) || 1));
    return runOcdsIngestion(pool, process.env.OCDS_API_URL, maxPages);
  });

  app.get("/tenders/:id", async (request, reply) => {
    const id = String((request.params as { id: string }).id);
    const result = await pool.query(`SELECT * FROM tenders WHERE id=$1 LIMIT 1`, [id]);
    if (!result.rowCount) return reply.code(404).send({ error: "Tender not found" });
    const documents = await pool.query(`SELECT id, name, url, file_type AS "fileType", is_addendum AS "isAddendum" FROM tender_documents WHERE tender_id=$1 ORDER BY id`, [id]);
    return { data: { ...result.rows[0], documents: documents.rows } };
  });

  app.get("/organizations", async () => {
    const result = await pool.query(`SELECT id, name, external_id AS "externalId", source, province_id AS "provinceId", municipality_id AS "municipalityId" FROM organizations ORDER BY name`);
    return { data: result.rows };
  });

  app.get("/municipalities", async () => {
    const result = await pool.query(`SELECT m.id, m.code, m.name, m.type, m.website_url AS "websiteUrl", m.enabled, p.name AS province FROM municipalities m LEFT JOIN provinces p ON p.id=m.province_id WHERE m.enabled=true ORDER BY m.name`);
    return { data: result.rows };
  });

  app.get("/provinces", async () => {
    const result = await pool.query(`SELECT id, name, code FROM provinces ORDER BY name`);
    return { data: result.rows };
  });

  app.get("/stats", async () => {
    const [total, open, municipalities, sources] = await Promise.all([
      pool.query(`SELECT count(*)::int AS count FROM tenders`),
      pool.query(`SELECT count(*)::int AS count FROM tenders WHERE lower(coalesce(status,'')) IN ('active','open','published')`),
      pool.query(`SELECT count(*)::int AS count FROM municipalities WHERE enabled=true`),
      pool.query(`SELECT source, count(*)::int AS count FROM tenders GROUP BY source ORDER BY count DESC`),
    ]);
    return { data: { totalTenders: total.rows[0].count, openTenders: open.rows[0].count, municipalities: municipalities.rows[0].count, sources: sources.rows } };
  });

  app.addHook("onClose", async () => { await pool.end(); });
  return app;
}

export { config };
