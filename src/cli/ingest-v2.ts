import pg from "pg";
import { runOcdsIngestion } from "../api-v2/ingestion/run.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const startUrl = process.env.OCDS_API_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!startUrl) throw new Error("OCDS_API_URL is required");

const maxPages = Math.min(10000, Math.max(1, Number(process.env.OCDS_MAX_PAGES ?? 100) || 100));
const pool = new Pool({ connectionString: databaseUrl, max: 5 });

try {
  const summary = await runOcdsIngestion(pool, startUrl, maxPages);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.status === "failed") process.exitCode = 1;
} finally {
  await pool.end();
}
