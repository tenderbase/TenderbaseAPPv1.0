/**
 * Regression test for the two-tier retry in src/sources/ocds.ts.
 *
 * Motivation (2026-09-08 incident): the etenders.gov.za nameservers flap in
 * bursts, and the old 3x1-2s schedule burned every attempt inside one bad
 * DNS moment. Network failures now retry over ~2.5 minutes.
 *
 * Stubs globalThis.fetch — no network, no database.
 *
 *   npm run test:retry          (~20s: two of the waits are real 5s/10s sleeps)
 */
import { fetchRange } from "../src/sources/ocds.js";

let failures = 0;
function assert(label: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const realFetch = globalThis.fetch;
function stubFetch(impl: typeof fetch) {
  (globalThis as any).fetch = impl;
}
function restoreFetch() {
  (globalThis as any).fetch = realFetch;
}

const okPage = (releases: any[]) =>
  new Response(JSON.stringify({ releases }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** Looks exactly like what undici throws when DNS fails. */
const netErr = () => {
  const e = new TypeError("fetch failed") as any;
  e.cause = Object.assign(
    new Error("getaddrinfo ENOTFOUND ocds-api.etenders.gov.za"),
    { code: "ENOTFOUND" }
  );
  return e;
};

async function main() {
  console.log("=".repeat(70));
  console.log("1. Network tier outlasts a DNS flap");
  console.log("=".repeat(70));
  {
    let calls = 0;
    stubFetch(async () => {
      calls++;
      if (calls <= 2) throw netErr(); // two bad DNS moments...
      return okPage([{ ocid: "ocds-x1", id: "r1" }]); // ...then recovery
    });
    try {
      const t0 = Date.now();
      const { releases, pages } = await fetchRange("2026-09-01", "2026-09-08");
      const took = Date.now() - t0;
      assert("recovers after transient DNS failures", releases.length === 1 && pages === 1);
      assert("used exactly 3 attempts", calls === 3, `calls=${calls}`);
      assert("waited out the 5s+10s network backoff", took >= 15_000, `${(took / 1000).toFixed(1)}s`);
    } finally {
      restoreFetch();
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("2. HTTP tier fails fast (3 attempts)");
  console.log("=".repeat(70));
  {
    let calls = 0;
    stubFetch(async () => {
      calls++;
      return new Response("Service Unavailable", { status: 503 });
    });
    try {
      let msg = "";
      try {
        await fetchRange("2026-09-01", "2026-09-08");
      } catch (e: any) {
        msg = e.message;
      }
      console.log(`   error: ${msg}`);
      assert("gives up after 3 HTTP attempts", calls === 3, `calls=${calls}`);
      assert("message names the HTTP status", /HTTP 503/.test(msg));
      assert("message counts the tiers", /\(3 http, 0 network\)/.test(msg));
    } finally {
      restoreFetch();
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("3. Error chain is surfaced, not the undici wrapper");
  console.log("=".repeat(70));
  {
    let calls = 0;
    stubFetch(async () => {
      calls++;
      if (calls === 1) throw netErr();
      return new Response("boom", { status: 500 });
    });
    try {
      let msg = "";
      try {
        await fetchRange("2026-09-01", "2026-09-08");
      } catch (e: any) {
        msg = e.message;
      }
      console.log(`   error: ${msg}`);
      assert("used exactly 4 attempts", calls === 4, `calls=${calls}`);
      assert("mixing tiers keeps both counts", /\(3 http, 1 network\)/.test(msg));
      assert("mentions ENOTFOUND via the cause chain", /ENOTFOUND/.test(msg));
      assert("mentions the HTTP 500 too", /HTTP 500/.test(msg));
    } finally {
      restoreFetch();
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
