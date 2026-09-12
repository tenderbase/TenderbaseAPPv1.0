import { buildV2Server } from "../api-v2/server.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

const app = buildV2Server();

app.listen({ port, host }).then(() => {
  console.log(`TenderBase API V2 listening on http://${host}:${port}`);
  console.log(`  GET /health`);
  console.log(`  GET /tenders?page=1&limit=20`);
  console.log(`  GET /tenders/:id`);
  console.log(`  GET /organizations`);
  console.log(`  GET /municipalities`);
  console.log(`  GET /docs`);
});
