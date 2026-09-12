import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import pg from "pg";

const { Pool } = pg;

export function buildV2Server() {
  const app = Fastify({ logger: true });
  const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: 5 }) : null;

  app.register(helmet, { contentSecurityPolicy: false });
  app.register(cors, {
    origin: (process.env.CORS_ORIGINS ?? "*").split(",").map((value) => value.trim()).filter(Boolean),
  });

  app.addHook("onClose", async () => {
    if (pool) await pool.end();
  });

  app.get("/", async (_request, reply) => reply.redirect("/docs"));

  app.get("/health", async (_request, reply) => {
    let database: "ok" | "not_configured" | "error" = "not_configured";
    if (pool) {
      try {
        await pool.query("select 1");
        database = "ok";
      } catch {
        database = "error";
      }
    }
    const healthy = database !== "error";
    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? "ok" : "degraded",
      api: "tenderbase-api-v2",
      version: "2.0.0",
      database,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.get("/docs", async (_request, reply) => reply.type("text/html; charset=utf-8").send(`<!doctype html><html><head><title>TenderBase API V2</title><meta charset="utf-8"></head><body style="font-family:system-ui;max-width:900px;margin:40px auto;padding:0 20px"><h1>TenderBase API V2</h1><p>Clean API foundation for South African public procurement data.</p><ul><li><a href="/docs/json">OpenAPI JSON</a></li><li><a href="/health">Health</a></li><li><a href="/tenders">Tenders</a></li><li><a href="/organizations">Organizations</a></li><li><a href="/municipalities">Municipalities</a></li></ul></body></html>`));

  app.get("/docs/json", async () => ({
    openapi: "3.0.3",
    info: { title: "TenderBase API V2", version: "2.0.0", description: "Clean South African public procurement API." },
    paths: {
      "/health": { get: { summary: "API and database health" } },
      "/tenders": { get: { summary: "List tenders" } },
      "/tenders/{id}": { get: { summary: "Get a tender" } },
      "/organizations": { get: { summary: "List organizations" } },
      "/municipalities": { get: { summary: "List municipalities" } },
    },
  }));

  app.get("/tenders", async (request) => {
    const query = request.query as { page?: string; limit?: string };
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20) || 20));
    if (!pool) return { data: [], pagination: { page, limit, total: 0 } };
    const result = await pool.query("select * from \"Tender\" order by \"publishedDate\" desc nulls last limit $1 offset $2", [limit, (page - 1) * limit]);
    return { data: result.rows, pagination: { page, limit, returned: result.rowCount ?? 0 } };
  });

  app.get("/tenders/:id", async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: "Database is not configured" });
    const { id } = request.params as { id: string };
    const result = await pool.query("select * from \"Tender\" where id = $1 limit 1", [id]);
    if (!result.rowCount) return reply.code(404).send({ error: "Tender not found" });
    return { data: result.rows[0] };
  });

  app.get("/organizations", async (_request, reply) => {
    if (!pool) return reply.code(503).send({ error: "Database is not configured" });
    const result = await pool.query("select * from \"Organization\" order by name asc limit 100");
    return { data: result.rows };
  });

  app.get("/municipalities", async (_request, reply) => {
    if (!pool) return reply.code(503).send({ error: "Database is not configured" });
    const result = await pool.query("select * from \"Municipality\" order by name asc");
    return { data: result.rows };
  });

  return app;
}
