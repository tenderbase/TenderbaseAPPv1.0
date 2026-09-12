import { buildServer, config } from "../v2/server.js";
import { pool } from "../v2/db.js";
import { runOcdsIngestion } from "../api-v2/ingestion/run.js";

const app = await buildServer();

await app.listen({ port: config.PORT, host: config.HOST });

console.log(`TenderBase API V2 listening on http://${config.HOST}:${config.PORT}`);
console.log("  GET /health");
console.log("  GET /tenders?page=1&limit=20&province=…&category=…&q=…");
console.log("  GET /tenders/:id");
console.log("  GET /organizations");
console.log("  GET /municipalities");
console.log("  GET /provinces");
console.log("  GET /stats");
console.log("  GET /docs");

// Bootstrap the live V2 database from the official OCDS API when explicitly enabled.
// The count check makes this a one-time bootstrap rather than an ingestion on every restart.
if (process.env.OCDS_AUTO_INGEST === "true" && process.env.OCDS_API_URL) {
  try {
    const result = await pool.query("SELECT count(*)::int AS count FROM tenders");
    if (result.rows[0].count === 0) {
      const maxPages = Math.min(100, Math.max(1, Number(process.env.OCDS_MAX_PAGES ?? 1) || 1));
      console.log(`OCDS bootstrap starting (maxPages=${maxPages})`);
      const summary = await runOcdsIngestion(pool, process.env.OCDS_API_URL, maxPages);
      console.log(`OCDS bootstrap finished: ${JSON.stringify(summary)}`);
    } else {
      console.log(`OCDS bootstrap skipped: ${result.rows[0].count} tenders already present`);
    }
  } catch (error) {
    console.error("OCDS bootstrap failed", error);
  }
}
