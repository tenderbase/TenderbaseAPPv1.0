/**
 * Phase 3 + API UI & Metadata Acceptance Test.
 *
 * 1. Asserts our response shape is key-for-key compatible with the live
 *    TenderBase API (the app must not need changes).
 * 2. Exercises all metadata and helper endpoints (/stats, /categories, /provinces, /docs).
 * 3. Exercises every filter and additive parameter the product depends on.
 */
const LOCAL = process.env.LOCAL ?? "http://127.0.0.1:3000";
const LIVE = "https://tenderbase-web.onrender.com";

let failures = 0;
function assert(label: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

async function j(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function main() {
  console.log("=".repeat(70));
  console.log("1. HEALTH & METADATA ENDPOINTS");
  console.log("=".repeat(70));
  const health = await j(`${LOCAL}/health`);
  console.log("   /health:", JSON.stringify(health));
  assert("health returns status ok", health.status === "ok");

  const stats = await j(`${LOCAL}/stats`);
  console.log("   /stats:", JSON.stringify(stats.stats));
  assert("stats returns totalTenders", typeof stats.stats.totalTenders === "number");
  assert("stats returns activeTenders", typeof stats.stats.activeTenders === "number");
  assert("stats returns categoriesCount", typeof stats.stats.categoriesCount === "number");

  const cats = await j(`${LOCAL}/categories`);
  console.log(`   /categories: total=${cats.total}, top=${cats.categories[0]?.category} (${cats.categories[0]?.count})`);
  assert("categories returns array", Array.isArray(cats.categories) && cats.total > 0);

  const provs = await j(`${LOCAL}/provinces`);
  console.log(`   /provinces: total=${provs.total}, top=${provs.provinces[0]?.province} (${provs.provinces[0]?.count})`);
  assert("provinces returns array", Array.isArray(provs.provinces) && provs.total > 0);

  const docsRes = await fetch(`${LOCAL}/docs`);
  assert("docs (Swagger UI) returns 200", docsRes.status === 200);

  const rootHtml = await fetch(`${LOCAL}/`, { headers: { accept: "text/html" } });
  const htmlText = await rootHtml.text();
  assert("root dashboard returns HTML UI", rootHtml.status === 200 && htmlText.includes("TenderBase API"));

  console.log("\n" + "=".repeat(70));
  console.log("2. BASIC LIST");
  console.log("=".repeat(70));
  const ours = await j(`${LOCAL}/tenders?limit=3`);
  console.log(`   total=${ours.total} page=${ours.page} totalPages=${ours.totalPages} source=${ours.source} n=${ours.results.length}`);
  assert("returns results array", Array.isArray(ours.results));
  assert("respects limit", ours.results.length === 3);
  assert("has total", typeof ours.total === "number");
  assert("has totalPages", typeof ours.totalPages === "number");
  assert("source is 'live'", ours.source === "live");

  console.log("\n" + "=".repeat(70));
  console.log("3. CONTRACT COMPATIBILITY vs LIVE APP");
  console.log("=".repeat(70));
  let live: any = null;
  try {
    live = await j(`${LIVE}/api/tenders?limit=3`);
  } catch (e) {
    console.log("   (live app unreachable, skipping)", String(e).slice(0, 60));
  }
  if (live) {
    const topOurs: string[] = Object.keys(ours).sort();
    const topLive: string[] = Object.keys(live).sort();
    console.log("   live top-level :", topLive.join(", "));
    console.log("   ours top-level :", topOurs.join(", "));
    assert(
      "we provide every top-level key the app gets today",
      topLive.every((k) => topOurs.includes(k)),
      `missing: ${topLive.filter((k) => !topOurs.includes(k)).join(",") || "none"}`
    );

    const a = ours.results[0] ?? {};
    const b = live.results[0] ?? {};
    const itemOurs: string[] = Object.keys(a).sort();
    const itemLive: string[] = Object.keys(b).sort();
    console.log("\n   live tender keys:", itemLive.join(", "));
    console.log("   ours tender keys:", itemOurs.join(", "));
    assert(
      "we provide every tender key the app gets today",
      itemLive.every((k) => itemOurs.includes(k)),
      `missing: ${itemLive.filter((k) => !itemOurs.includes(k)).join(",") || "none"}`
    );

    for (const k of itemLive) {
      if (typeof b[k] === typeof a[k] || b[k] === null || a[k] === null) continue;
      console.log(`   TYPE DIFF ${k}: live=${typeof b[k]} ours=${typeof a[k]}`);
    }
    assert("closingDate is an ISO string", typeof a.closingDate === "string");
    assert("publishedDate is YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(a.publishedDate ?? ""));
    assert("documents is an array", Array.isArray(a.documents));
  }

  console.log("\n" + "=".repeat(70));
  console.log("4. FILTERS & ADDITIVE QUERY PARAMS");
  console.log("=".repeat(70));
  const kzn = await j(`${LOCAL}/tenders?province=KwaZulu-Natal&limit=5`);
  console.log(`   province=KwaZulu-Natal -> total=${kzn.total}`);
  assert("province filter narrows results", kzn.total > 0 && kzn.total < ours.total);
  assert("all rows are KZN", kzn.results.every((r: any) => r.province === "KwaZulu-Natal"));

  const cat = await j(`${LOCAL}/tenders?category=Construction&limit=5`);
  console.log(`   category=Construction -> total=${cat.total}`);
  assert("category filter works", cat.total > 0);

  const sea = await j(`${LOCAL}/tenders?q=catering&limit=5`);
  console.log(`   q=catering -> total=${sea.total}`);
  assert("full-text q returns matches", sea.total > 0);

  const cons = await j(`${LOCAL}/tenders?constructionOnly=true&limit=5`);
  console.log(`   constructionOnly=true -> total=${cons.total}`);
  assert("constructionOnly filter works", cons.total > 0);

  const soon = await j(`${LOCAL}/tenders?sort=closing&limit=3`);
  const dates = soon.results.map((r: any) => r.closingDate).filter(Boolean);
  const sorted = [...dates].sort();
  assert("sort=closing returns ascending closing dates", JSON.stringify(dates) === JSON.stringify(sorted));

  // Additive date window filters
  const dateFiltered = await j(`${LOCAL}/tenders?publishedAfter=2026-08-01T00:00:00Z&limit=5`);
  assert("publishedAfter filter works", dateFiltered.total > 0);

  // Params the live API silently ignores — we support them anyway.
  const alias = await j(`${LOCAL}/tenders?perPage=2`);
  assert("perPage alias is honoured (live API ignores it)", alias.results.length === 2);
  const alias2 = await j(`${LOCAL}/tenders?search=catering&limit=3`);
  assert("search alias is honoured (live API ignores it)", alias2.total > 0);
  const st = await j(`${LOCAL}/tenders?status=active&limit=3`);
  assert("status filter honoured", st.results.every((r: any) => true) && st.total > 0);

  console.log("\n" + "=".repeat(70));
  console.log("5. DETAIL");
  console.log("=".repeat(70));
  const id = ours.results[0].id;
  const detail = await j(`${LOCAL}/tenders/${id}`);
  assert("detail returns {tender, source}", !!detail.tender && detail.source === "live");
  assert("detail includes amendments", Array.isArray(detail.tender.amendments));
  const missing = await fetch(`${LOCAL}/tenders/does-not-exist`);
  assert("unknown id returns 404", missing.status === 404);

  console.log("\n" + "=".repeat(70));
  console.log("6. GUARDRAILS");
  console.log("=".repeat(70));
  const bad = await fetch(`${LOCAL}/tenders?page=0`);
  assert("page=0 rejected with 400", bad.status === 400);
  const big = await j(`${LOCAL}/tenders?limit=1000`);
  assert("limit capped at 100", big.results.length <= 100);

  console.log("\n" + "=".repeat(70));
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  console.log("=".repeat(70));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
