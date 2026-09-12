export type FetchPage = {
  url: string;
  records: unknown[];
  nextUrl?: string;
};

export async function fetchJson(url: string, timeoutMs = 30_000): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "TenderBase/2.0 (+https://tenderbase.co.za)",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OCDS request failed: HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchOcdsPage(url: string): Promise<FetchPage> {
  const payload = await fetchJson(url);
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const releases = Array.isArray(root.releases) ? root.releases : [];
  const next = root.links && typeof root.links === "object"
    ? (root.links as Record<string, unknown>).next
    : undefined;
  return {
    url,
    records: releases,
    nextUrl: typeof next === "string" && next.length > 0 ? next : undefined,
  };
}
