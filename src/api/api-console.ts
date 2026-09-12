export const apiConsoleHtml = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>TenderBase API Console</title>
<style>
:root{font-family:Inter,Segoe UI,system-ui,sans-serif;color:#142033;background:#f4f7fb;line-height:1.45}
*{box-sizing:border-box}body{margin:0}.hero{background:linear-gradient(135deg,#07101f,#10243d 60%,#0b6b49);color:#fff;padding:32px 5% 28px}.hero h1{margin:0 0 8px;font-size:32px}.hero p{margin:0;color:#c9d7e8}.wrap{max-width:1180px;margin:0 auto;padding:24px 20px 60px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}@media(max-width:800px){.grid{grid-template-columns:1fr}}
.card{background:#fff;border:1px solid #dbe3ee;border-radius:16px;padding:20px;box-shadow:0 8px 24px rgba(15,23,42,.05);margin-bottom:18px}.card h2{margin:0 0 6px;font-size:20px}.muted{color:#6b7a90;font-size:14px}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.method{display:inline-block;border-radius:7px;padding:5px 9px;color:#fff;font-size:12px;font-weight:800}.get{background:#0ea5e9}.post{background:#16a34a}.admin{border-left:4px solid #0f172a}.field{display:grid;gap:6px;margin:10px 0}.field label{font-size:13px;font-weight:700;color:#34445c}input,select,textarea{width:100%;border:1px solid #cbd5e1;border-radius:9px;padding:10px 11px;font:inherit;background:#fff}textarea{min-height:150px;resize:vertical}button{border:0;border-radius:9px;padding:10px 14px;font:inherit;font-weight:800;cursor:pointer;background:#0f172a;color:#fff}button.secondary{background:#e8eef6;color:#1b2a40}button.green{background:#16a34a}.endpoint{border:1px solid #e0e7f0;border-radius:13px;padding:14px;margin:12px 0;background:#fbfcfe}.endpoint h3{margin:0;font-size:15px}.endpoint code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:#334155}.result{background:#0b1220;color:#d7e4f4;border-radius:12px;padding:14px;white-space:pre-wrap;overflow:auto;max-height:360px;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}.status{padding:8px 10px;border-radius:8px;background:#eef3f9;color:#35455c;font-size:13px}.links a{color:#0f766e;text-decoration:none;font-weight:700}.links{display:flex;gap:16px;flex-wrap:wrap}
</style>
</head>
<body>
<header class="hero"><h1>TenderBase API Console</h1><p>Live procurement API with tender search, municipal coverage, ingestion controls and manual tender management.</p></header>
<main class="wrap">
<div class="card"><h2>Connection</h2><p class="muted">Use the keys configured on the API. Public requests use <code>x-api-key</code>. Admin operations use <code>x-admin-key</code>.</p><div class="grid"><div class="field"><label>Public API key</label><input id="publicKey" type="password" placeholder="Optional unless API_KEY is configured" /></div><div class="field"><label>Admin API key</label><input id="adminKey" type="password" placeholder="Required for admin operations" /></div></div><div class="links"><a href="/docs/json" target="_blank">OpenAPI JSON</a><a href="/swagger" target="_blank">Swagger reference</a></div></div>
<div class="card"><h2>Public API</h2><div id="publicEndpoints"></div></div>
<div class="card admin"><h2>Admin API</h2><p class="muted">Protected dataset controls are callable directly from this page.</p><div id="adminEndpoints"></div></div>
<div class="card"><h2>Response</h2><div id="status" class="status">Ready</div><pre id="result" class="result">Run an operation to see the live response here.</pre></div>
</main>
<script>
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
async function call(path,opts={},admin=false){
 const headers={'Accept':'application/json',...(opts.headers||{})};
 const key=admin?$('adminKey').value:$('publicKey').value;if(key) headers[admin?'x-admin-key':'x-api-key']=key;
 $('status').textContent=opts.method?opts.method+' '+path:'GET '+path;
 try{const r=await fetch(path,{...opts,headers});const text=await r.text();let body;try{body=JSON.parse(text)}catch{body=text};$('status').textContent=r.status+' '+r.statusText; $('result').textContent=typeof body==='string'?body:JSON.stringify(body,null,2)}catch(e){$('status').textContent='Request failed';$('result').textContent=String(e)}
}
function getEndpoint(title,path,action,extra=''){return '<div class="endpoint"><div class="row"><span class="method get">GET</span><h3>'+esc(title)+'</h3></div><code>'+esc(path)+'</code>'+extra+'<div style="margin-top:10px"><button onclick="'+action+'">Run</button></div></div>'}
function postEndpoint(title,path,action,extra=''){return '<div class="endpoint"><div class="row"><span class="method post">POST</span><h3>'+esc(title)+'</h3></div><code>'+esc(path)+'</code>'+extra+'<div style="margin-top:10px"><button class="green" onclick="'+action+'">Run</button></div></div>'}
$('publicEndpoints').innerHTML=
 getEndpoint('Health check','/health',"call('/health')")+
 getEndpoint('Dataset statistics','/stats',"call('/stats')")+
 getEndpoint('Categories','/categories',"call('/categories')")+
 getEndpoint('Provinces','/provinces',"call('/provinces')")+
 getEndpoint('Municipalities','/municipalities',"call('/municipalities')")+
 getEndpoint('Procurement types','/procurement-types',"call('/procurement-types')")+
 '<div class="endpoint"><div class="row"><span class="method get">GET</span><h3>Tender search</h3></div><code>/tenders</code><div class="grid">'+
 '<div class="field"><label>Search</label><input id="q" placeholder="road, construction, cleaning..." /></div><div class="field"><label>Municipality code</label><input id="municipality" placeholder="ETHEKWINI" /></div>'+ 
 '<div class="field"><label>Procurement type</label><select id="ptype"><option value="">Any</option><option>TENDER</option><option>RFQ</option><option>QUOTATION</option><option>EOI</option><option>ADDENDUM</option><option>AWARD</option><option>CANCELLATION</option><option>NOTICE</option></select></div>'+ 
 '<div class="field"><label>Limit</label><input id="limit" type="number" min="1" max="100" value="20" /></div></div><button onclick="runSearch()">Search tenders</button></div>'+
 '<div class="endpoint"><div class="row"><span class="method get">GET</span><h3>Get tender by ID</h3></div><code>/tenders/{id}</code><div class="field"><label>Tender ID</label><input id="tid" placeholder="cuid / database ID" /></div><button onclick="call('/tenders/'+encodeURIComponent($('tid').value))">Run</button></div>';
$('adminEndpoints').innerHTML=
 getEndpoint('Admin dashboard','/admin/dashboard',"call('/admin/dashboard',{},true)")+
 getEndpoint('Registered municipality adapters','/admin/municipalities',"call('/admin/municipalities',{},true)")+
 postEndpoint('Run municipality ingestion','/admin/municipalities/{code}/ingest',"runIngest()",'<div class="grid"><div class="field"><label>Municipality code</label><input id="ingestCode" value="ETHEKWINI" /></div><div class="field"><label>Backfill</label><select id="backfill"><option value="false">false</option><option value="true">true</option></select></div></div>')+
 postEndpoint('Relink existing tenders','/admin/municipalities/{code}/relink',"runRelink()",'<div class="grid"><div class="field"><label>Municipality code</label><input id="relinkCode" value="ETHEKWINI" /></div><div class="field"><label>Existing source</label><input id="relinkSource" value="ETHEKWINI" /></div></div>')+
 postEndpoint('Manual tender ingestion','/admin/tenders',"runManual()",'<div class="field"><label>JSON payload</label><textarea id="manualJson">'+esc(JSON.stringify({source:'MANUAL',sourceUrl:'https://example.gov.za/tender',ocid:'manual:example:001',releaseId:'manual-release-001',tenderNumber:'RFQ-001',procurementType:'RFQ',municipalityCode:'ETHEKWINI',title:'Example municipal RFQ',description:null,organisation:'eThekwini Municipality',category:'CONSTRUCTION',province:'KwaZulu-Natal',location:'Durban',isOpportunity:true},null,2))+'</textarea></div>');
function runSearch(){const p=new URLSearchParams();p.set('page','1');p.set('limit',$('limit').value||'20');if($('q').value)p.set('q',$('q').value);if($('municipality').value)p.set('municipality',$('municipality').value);if($('ptype').value)p.set('procurementType',$('ptype').value);call('/tenders?'+p.toString())}
function runIngest(){const c=$('ingestCode').value.trim();call('/admin/municipalities/'+encodeURIComponent(c)+'/ingest?backfill='+$('backfill').value,{method:'POST'},true)}
function runRelink(){const c=$('relinkCode').value.trim();call('/admin/municipalities/'+encodeURIComponent(c)+'/relink',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:$('relinkSource').value.trim()})},true)}
function runManual(){let body;try{body=JSON.parse($('manualJson').value)}catch(e){$('status').textContent='Invalid JSON';$('result').textContent=String(e);return}call('/admin/tenders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},true)}
</script>
</body></html>`;
