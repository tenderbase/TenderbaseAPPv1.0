export const apiConsoleHtml = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>TenderBase API Console</title>
<style>
:root{font-family:Inter,Segoe UI,system-ui,sans-serif;color:#142033;background:#f4f7fb;line-height:1.45}*{box-sizing:border-box}body{margin:0}.hero{background:linear-gradient(135deg,#07101f,#10243d 60%,#0b6b49);color:#fff;padding:32px 5% 28px}.hero h1{margin:0 0 8px;font-size:32px}.hero p{margin:0;color:#c9d7e8}.wrap{max-width:1200px;margin:0 auto;padding:24px 20px 70px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}@media(max-width:800px){.grid{grid-template-columns:1fr}}
.card{background:#fff;border:1px solid #dbe3ee;border-radius:16px;padding:20px;box-shadow:0 8px 24px rgba(15,23,42,.05);margin-bottom:18px}.card h2{margin:0 0 6px;font-size:20px}.muted{color:#667892;font-size:14px}.field{display:grid;gap:6px;margin:10px 0}.field label{font-size:13px;font-weight:800;color:#34445c}input,select,textarea{width:100%;border:1px solid #cbd5e1;border-radius:9px;padding:10px 11px;font:inherit;background:#fff}textarea{min-height:170px;resize:vertical}button{border:0;border-radius:9px;padding:10px 14px;font:inherit;font-weight:800;cursor:pointer;background:#0f172a;color:#fff}button:hover{filter:brightness(1.08)}button.green{background:#16a34a}button.blue{background:#0ea5e9}.endpoint{border:1px solid #dbe3ee;border-radius:13px;padding:15px;margin:12px 0;background:#fbfcfe}.endpoint h3{margin:0;font-size:15px}.endpoint code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:#334155}.badge{display:inline-block;border-radius:7px;padding:4px 8px;color:#fff;font-size:11px;font-weight:900;margin-right:8px}.get{background:#0ea5e9}.post{background:#16a34a}.links{display:flex;gap:18px;flex-wrap:wrap;margin-top:14px}.links a{color:#0f766e;text-decoration:none;font-weight:800}.admin{border-left:4px solid #0f172a}.status{padding:9px 11px;border-radius:8px;background:#eef3f9;color:#35455c;font-size:13px}.result{background:#0b1220;color:#d7e4f4;border-radius:12px;padding:14px;white-space:pre-wrap;overflow:auto;max-height:420px;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}.notice{padding:12px 14px;border-radius:10px;background:#eff8f3;color:#14532d;border:1px solid #cdebd9;font-size:13px}
</style>
</head>
<body>
<header class="hero"><h1>TenderBase API Console</h1><p>Live procurement API with tender search, municipal coverage, ingestion controls and manual tender management.</p></header>
<main class="wrap">
<section class="card"><h2>Connection</h2><p class="muted">Public operations use <code>x-api-key</code> when configured. Admin operations use <code>x-admin-key</code>. Keys remain in your browser and are only sent to this API.</p><div class="grid"><div class="field"><label for="publicKey">Public API key</label><input id="publicKey" type="password" placeholder="Optional if public auth is disabled" /></div><div class="field"><label for="adminKey">Admin API key</label><input id="adminKey" type="password" placeholder="Required for protected actions" /></div></div><div class="links"><a href="/docs/json" target="_blank" rel="noreferrer">OpenAPI JSON</a><a href="/swagger" target="_blank" rel="noreferrer">Swagger reference</a></div></section>
<section class="card"><h2>Public API</h2>
<div class="endpoint"><span class="badge get">GET</span><h3>Health check</h3><code>/health</code><div><button class="blue" data-run-path="/health">Run</button></div></div>
<div class="endpoint"><span class="badge get">GET</span><h3>Dataset statistics</h3><code>/stats</code><div><button class="blue" data-run-path="/stats">Run</button></div></div>
<div class="grid">
<div class="endpoint"><span class="badge get">GET</span><h3>Categories</h3><code>/categories</code><div><button class="blue" data-run-path="/categories">Run</button></div></div>
<div class="endpoint"><span class="badge get">GET</span><h3>Provinces</h3><code>/provinces</code><div><button class="blue" data-run-path="/provinces">Run</button></div></div>
<div class="endpoint"><span class="badge get">GET</span><h3>Municipalities</h3><code>/municipalities</code><div><button class="blue" data-run-path="/municipalities">Run</button></div></div>
<div class="endpoint"><span class="badge get">GET</span><h3>Procurement types</h3><code>/procurement-types</code><div><button class="blue" data-run-path="/procurement-types">Run</button></div></div>
</div>
<div class="endpoint"><span class="badge get">GET</span><h3>Tender search</h3><code>/tenders</code><div class="grid"><div class="field"><label for="q">Search</label><input id="q" placeholder="road, construction, cleaning..." /></div><div class="field"><label for="municipality">Municipality code</label><input id="municipality" placeholder="ETHEKWINI" /></div><div class="field"><label for="procurementType">Procurement type</label><select id="procurementType"><option value="">Any</option><option>TENDER</option><option>RFQ</option><option>QUOTATION</option><option>EOI</option><option>ADDENDUM</option><option>AWARD</option><option>CANCELLATION</option><option>NOTICE</option></select></div><div class="field"><label for="limit">Limit</label><input id="limit" type="number" min="1" max="100" value="20" /></div></div><button class="blue" id="searchButton">Search tenders</button></div>
<div class="endpoint"><span class="badge get">GET</span><h3>Get tender by ID</h3><code>/tenders/{id}</code><div class="field"><label for="tenderId">Tender ID</label><input id="tenderId" placeholder="Database tender ID" /></div><button class="blue" id="tenderButton">Run</button></div>
</section>
<section class="card admin"><h2>Admin API</h2><p class="muted">Protected dataset controls are callable directly from this console.</p>
<div class="grid">
<div class="endpoint"><span class="badge get">GET</span><h3>Admin dashboard</h3><code>/admin/dashboard</code><div><button data-run-path="/admin/dashboard" data-admin="true">Run</button></div></div>
<div class="endpoint"><span class="badge get">GET</span><h3>Registered municipality adapters</h3><code>/admin/municipalities</code><div><button data-run-path="/admin/municipalities" data-admin="true">Run</button></div></div>
</div>
<div class="endpoint"><span class="badge post">POST</span><h3>Run municipality ingestion</h3><code>/admin/municipalities/{code}/ingest</code><div class="grid"><div class="field"><label for="ingestCode">Municipality code</label><input id="ingestCode" value="ETHEKWINI" /></div><div class="field"><label for="backfill">Backfill</label><select id="backfill"><option value="false">false</option><option value="true">true</option></select></div></div><button class="green" id="ingestButton">Run ingestion</button></div>
<div class="endpoint"><span class="badge post">POST</span><h3>Relink existing tenders</h3><code>/admin/municipalities/{code}/relink</code><div class="grid"><div class="field"><label for="relinkCode">Municipality code</label><input id="relinkCode" value="ETHEKWINI" /></div><div class="field"><label for="relinkSource">Existing source</label><input id="relinkSource" value="ETHEKWINI" /></div></div><button class="green" id="relinkButton">Relink tenders</button></div>
<div class="endpoint"><span class="badge post">POST</span><h3>Manual tender ingestion</h3><code>/admin/tenders</code><div class="field"><label for="manualJson">JSON payload</label><textarea id="manualJson">{
  "source": "MANUAL",
  "sourceUrl": "https://example.gov.za/tender",
  "ocid": "manual:example:001",
  "releaseId": "manual-release-001",
  "tenderNumber": "RFQ-001",
  "procurementType": "RFQ",
  "municipalityCode": "ETHEKWINI",
  "title": "Example municipal RFQ",
  "organisation": "eThekwini Municipality",
  "category": "CONSTRUCTION",
  "province": "KwaZulu-Natal",
  "location": "Durban",
  "isOpportunity": true
}</textarea></div><button class="green" id="manualButton">Save tender</button></div>
</section>
<section class="card"><h2>Live response</h2><div id="status" class="status">Ready — choose an operation above.</div><pre id="result" class="result">No request has been made yet.</pre><p class="notice">The API console is separate from Swagger. The Swagger compatibility link is now available at <code>/swagger</code>.</p></section>
</main>
<script src="/docs/console.js"></script>
</body>
</html>`;
