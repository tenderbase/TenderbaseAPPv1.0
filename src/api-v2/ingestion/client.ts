import { URL } from "node:url";

export type FetchPage = { url: string; records: unknown[]; nextUrl?: string };

export async function fetchJson(url: string, timeoutMs = 30_000): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "TenderBase/2.0 (+https://tenderbase.co.za)" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OCDS request failed: HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timeout); }
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
