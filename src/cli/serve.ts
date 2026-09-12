import { buildServer, config } from "../v2/server.js";

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
