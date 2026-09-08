import { buildServer } from "../api/server.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

const app = buildServer();
app.listen({ port, host }).then(() => {
  console.log(`TenderBase API listening on http://${host}:${port}`);
  console.log(`  GET /health`);
  console.log(`  GET /tenders?page=1&limit=20&province=…&category=…&q=…`);
  console.log(`  GET /tenders/:id`);
});
