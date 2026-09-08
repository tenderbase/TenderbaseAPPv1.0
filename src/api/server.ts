import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { listTenders } from "./tenders.js";
import { toContractTender } from "./serialise.js";

/**
 * Query params. Note the aliases: the LIVE TenderBase API silently ignores
 * `perPage`, `search` and `status`. We accept them anyway so that behaviour
 * changes if the app ever starts sending them.
 */
const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // No max here: the live API silently clamps to 100, so we clamp in the handler
  // rather than 400-ing a limit the app has always been allowed to send.
  limit: z.coerce.number().int().min(1).default(20),
  perPage: z.coerce.number().int().min(1).optional(),
  q: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  province: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  closingBefore: z.string().datetime().optional(),
  constructionOnly: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((v) => v === true || v === "true"),
  sort: z.enum(["latest", "closing"]).default("latest"),
});

export function buildServer() {
  const app = Fastify({ logger: false });

  app.register(helmet, { contentSecurityPolicy: false });
  app.register(cors, {
    origin: (process.env.CORS_ORIGINS ?? "*")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  });

  // Optional API key. Skipped for /health so Render's healthcheck works.
  const apiKey = process.env.API_KEY;
  if (apiKey) {
    app.addHook("onRequest", async (req, reply) => {
      if (req.url.startsWith("/health")) return;
      const provided =
        (req.headers["x-api-key"] as string | undefined) ??
        (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      if (provided !== apiKey) {
        reply.code(401).send({ error: "Unauthorized" });
      }
    });
  }

  app.get("/health", async () => ({
    status: "ok",
    source: "live",
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.get("/tenders", async (req, reply) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid query",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    const qp = parsed.data;
    const limit = Math.min(100, qp.perPage ?? qp.limit); // perPage alias + clamp
    const q = qp.q ?? qp.search; // search alias

    const { rows, documentsByTender, total } = await listTenders({
      page: qp.page,
      limit,
      q,
      province: qp.province,
      category: qp.category,
      status: qp.status,
      closingBefore: qp.closingBefore ? new Date(qp.closingBefore) : undefined,
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
