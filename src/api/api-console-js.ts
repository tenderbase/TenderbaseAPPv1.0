export const apiConsoleJs = String.raw`(() => {
  const $ = (id) => document.getElementById(id);

  function setResult(status, body) {
    const statusEl = $("status");
    const resultEl = $("result");
    if (statusEl) statusEl.textContent = status;
    if (resultEl) resultEl.textContent = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  }

  function authHeaders(admin = false) {
    const headers = { Accept: "application/json" };
    const key = $(admin ? "adminKey" : "publicKey")?.value?.trim();
    if (key) headers[admin ? "x-admin-key" : "x-api-key"] = key;
    return headers;
  }

  async function request(path, { method = "GET", body, admin = false } = {}) {
    const headers = authHeaders(admin);
    if (body !== undefined) headers["Content-Type"] = "application/json";
    setResult(method + " " + path, "Loading...");
    try {
      const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text();
      let payload = text;
      try { payload = JSON.parse(text); } catch {}
      setResult(response.status + " " + response.statusText, payload);
      return { ok: response.ok, status: response.status, payload };
    } catch (error) {
      setResult("Request failed", String(error));
      return { ok: false, status: 0, payload: String(error) };
    }
  }

  function bindSimpleButtons() {
    document.querySelectorAll("[data-run-path]").forEach((button) => {
      button.addEventListener("click", () => request(button.dataset.runPath, { admin: button.dataset.admin === "true" }));
    });
  }

  $("searchButton")?.addEventListener("click", () => {
    const params = new URLSearchParams({ page: "1", limit: $("limit")?.value || "20" });
    const q = $("q")?.value?.trim();
    const municipality = $("municipality")?.value?.trim();
    const procurementType = $("procurementType")?.value;
    if (q) params.set("q", q);
    if (municipality) params.set("municipalityCode", municipality);
    if (procurementType) params.set("procurementType", procurementType);
    request("/tenders?" + params.toString());
  });

  $("tenderButton")?.addEventListener("click", () => {
    const id = $("tenderId")?.value?.trim();
    if (!id) return setResult("Validation", "Enter a tender ID first.");
    request("/tenders/" + encodeURIComponent(id));
  });

  $("ingestButton")?.addEventListener("click", () => {
    const code = $("ingestCode")?.value?.trim();
    if (!code) return setResult("Validation", "Enter a municipality code.");
    const backfill = $("backfill")?.value || "false";
    request("/admin/municipalities/" + encodeURIComponent(code) + "/ingest?backfill=" + backfill, { method: "POST", admin: true });
  });

  $("relinkButton")?.addEventListener("click", () => {
    const code = $("relinkCode")?.value?.trim();
    const source = $("relinkSource")?.value?.trim();
    if (!code || !source) return setResult("Validation", "Enter both municipality code and source.");
    request("/admin/municipalities/" + encodeURIComponent(code) + "/relink", { method: "POST", admin: true, body: { source } });
  });

  $("manualButton")?.addEventListener("click", () => {
    let payload;
    try { payload = JSON.parse($("manualJson")?.value || "{}"); }
    catch (error) { return setResult("Validation", "Invalid JSON: " + error); }
    request("/admin/tenders", { method: "POST", admin: true, body: payload });
  });

  $("etenderButton")?.addEventListener("click", () => {
    let payload;
    try { payload = JSON.parse($("etenderJson")?.value || "{}"); }
    catch (error) { return setResult("Validation", "Invalid eTender JSON: " + error); }
    if (Array.isArray(payload)) return setResult("Validation", "Use Import eTender batch for an array.");
    payload.source = "ETENDERS";
    request("/admin/tenders", { method: "POST", admin: true, body: payload });
  });

  $("etenderBatchButton")?.addEventListener("click", async () => {
    let payload;
    try { payload = JSON.parse($("etenderBatchJson")?.value || "[]"); }
    catch (error) { return setResult("Validation", "Invalid eTender batch JSON: " + error); }
    if (!Array.isArray(payload) || payload.length === 0) return setResult("Validation", "Paste a JSON array containing at least one eTender record.");
    if (payload.length > 100) return setResult("Validation", "Maximum batch size is 100 records per import.");

    const results = [];
    for (let i = 0; i < payload.length; i += 1) {
      const record = { ...payload[i], source: "ETENDERS" };
      setResult("Importing eTender " + (i + 1) + " of " + payload.length, "Saving...");
      const result = await request("/admin/tenders", { method: "POST", admin: true, body: record });
      results.push({ index: i + 1, tenderNumber: record.tenderNumber ?? null, ...result });
    }
    const succeeded = results.filter((r) => r.ok).length;
    setResult("eTender batch complete — " + succeeded + "/" + results.length + " saved", results);
  });

  bindSimpleButtons();
})();`; 
