import { buildServer } from "../api/server.js";
import { apiConsoleHtml } from "../api/api-console.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

const app = buildServer();

// Use a first-party API console at /docs. Keep Swagger's generated UI/assets
// available under /docs/json and /docs/static for compatibility.
app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/docs" || req.url === "/docs/") {
    return reply.type("text/html; charset=utf-8").send(apiConsoleHtml);
  }
});

app.listen({ port, host }).then(() => {
  console.log(`TenderBase API listening on http://${host}:${port}`);
  console.log(`  GET /health`);
  console.log(`  GET /tenders?page=1&limit=20&province=…&category=…&q=…`);
  console.log(`  GET /tenders/:id`);
  console.log(`  GET /docs`);
  console.log(`  GET /docs/json`);
});
