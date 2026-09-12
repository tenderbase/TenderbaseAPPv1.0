import { URL } from "node:url";

export type FetchPage = { url: string; records: unknown[]; nextUrl?: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJson(url: string, timeoutMs = 120_000): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json, text/json, */*",
          "user-agent": "TenderBase/2.0 (+https://tenderbase.co.za)",
          connection: "keep-alive",
        },
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`OCDS request failed: HTTP ${response.status} ${response.statusText} - ${body.slice(0, 500)}`);
      }
      try {
        return JSON.parse(body);
      } catch (error) {
        throw new Error(`OCDS API returned invalid JSON: ${error instanceof Error ? error.message : String(error)} - ${body.slice(0, 500)}`);
      }
    } catch (error) {
      lastError = error instanceof Error && error.name === "AbortError"
        ? new Error(`OCDS request timed out after ${timeoutMs}ms (attempt ${attempt}/3)`)
        : error;
      if (attempt < 3) await sleep(attempt * 1500);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function isSameOrigin(candidate: string, trustedOrigin: string): boolean {
  try {
    const a = new URL(candidate), b = new URL(trustedOrigin);
    return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port;
  } catch { return false; }
}

export async function fetchOcdsPage(url: string, trustedOrigin = url): Promise<FetchPage> {
  if (!isSameOrigin(url, trustedOrigin)) throw new Error("OCDS pagination URL is outside the configured trusted origin");
  const payload = await fetchJson(url);
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const releases = Array.isArray(root.releases) ? root.releases : [];
  const links = root.links && typeof root.links === "object" ? root.links as Record<string, unknown> : {};
  const next = typeof links.next === "string" && links.next.length > 0 ? links.next : undefined;
  if (next && !isSameOrigin(next, trustedOrigin)) throw new Error("OCDS API returned an untrusted pagination URL");
  return { url, records: releases, nextUrl: next };
}
