import { buildServer } from "../api/server.js";
import { apiConsoleHtml } from "../api/api-console.js";
import { apiConsoleJs } from "../api/api-console-js.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

const app = buildServer();

// First-party API console. Swagger/OpenAPI remains available independently.
app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/docs" || req.url === "/docs/") {
    return reply.type("text/html; charset=utf-8").send(apiConsoleHtml);
  }
  if (req.url === "/docs/console.js") {
    return reply.type("application/javascript; charset=utf-8").send(apiConsoleJs);
  }
  if (req.url === "/swagger" || req.url === "/swagger/") {
    return reply.redirect("/docs");
  }
});

app.listen({ port, host }).then(() => {
  console.log(`TenderBase API listening on http://${host}:${port}`);
  console.log(`  GET /health`);
  console.log(`  GET /tenders?page=1&limit=20&province=…&category=…&q=…`);
  console.log(`  GET /tenders/:id`);
  console.log(`  GET /docs`);
  console.log(`  GET /docs/json`);
  console.log(`  GET /swagger`);
});
