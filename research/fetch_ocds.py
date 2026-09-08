import json, time, urllib.request, os

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
BASE = "https://ocds-api.etenders.gov.za/api/OCDSReleases"


def fetch(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            print("    retry %d: %s" % (i + 1, e), flush=True)
            time.sleep(4 * (i + 1))
    return None


def fetch_range(dfrom, dto, out):
    if os.path.exists(out):
        print("  %s exists - skipping" % out, flush=True)
        return
    allr, pages, seen = [], 0, set()
    url = "%s?PageNumber=1&PageSize=1000&dateFrom=%s&dateTo=%s" % (BASE, dfrom, dto)
    t0 = time.time()
    while url and url not in seen:
        seen.add(url)
        pages += 1
        d = fetch(url)
        if d is None:
            print("    fetch failed, stopping range", flush=True)
            break
        rels = d.get("releases", []) or []
        allr.extend(rels)
        print("    page %d: %d releases (%.0fs)" % (pages, len(rels), time.time() - t0), flush=True)
        url = (d.get("links") or {}).get("next")
        if pages > 30:
            print("    safety cap hit", flush=True)
            break
    json.dump({"range": [dfrom, dto], "pages": pages, "releases": allr}, open(out, "w"))
    print("  SAVED %s: %d releases / %d pages / %.0fs" % (out, len(allr), pages, time.time() - t0), flush=True)


RANGES = [
    ("2026-08-09", "2026-08-15"),
    ("2026-08-16", "2026-08-22"),
    ("2026-08-23", "2026-08-29"),
    ("2026-08-30", "2026-09-05"),
    ("2026-09-06", "2026-09-08"),
]

for i, (a, b) in enumerate(RANGES):
    print("=== RANGE %d: %s -> %s ===" % (i + 1, a, b), flush=True)
    fetch_range(a, b, "ocds_%s_%s.json" % (a, b))

print("DONE", flush=True)
