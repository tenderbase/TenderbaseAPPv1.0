import json, time, urllib.request, datetime

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
BASE = "https://ocds-api.etenders.gov.za/api/OCDSReleases"


def fetch(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            print("   retry %d: %s" % (i + 1, e), flush=True)
            time.sleep(4 * (i + 1))
    return None


# --- Test 1: is a single-day query complete on page 1, or paginated? ---
url = "%s?PageNumber=1&PageSize=1000&dateFrom=2026-09-08&dateTo=2026-09-08" % BASE
allr, pages, seen = [], 0, set()
t0 = time.time()
while url and url not in seen:
    seen.add(url)
    pages += 1
    d = fetch(url)
    if d is None:
        break
    rels = d.get("releases", []) or []
    allr.extend(rels)
    print("  page %d: %d releases" % (pages, len(rels)), flush=True)
    url = (d.get("links") or {}).get("next")
    if pages > 15:
        break
print("  SINGLE-DAY 2026-09-08: %d releases across %d pages (%.0fs)" % (len(allr), pages, time.time() - t0), flush=True)
json.dump(allr, open("check_day.json", "w"))

# --- Test 2: compare against what the earlier backfill stored for the same day ---
rows = []
import glob
for f in sorted(glob.glob("ocds_*.json")):
    rows.extend(json.load(open(f))["releases"])
prev = {r["ocid"] for r in rows if str(r.get("date"))[:10] == "2026-09-08"}
now = {r["ocid"] for r in allr}
print("\n  backfill had for 2026-09-08 : %d" % len(prev))
print("  fresh fetch now             : %d" % len(now))
print("  in fresh but NOT in backfill: %d   <- late-arriving releases" % len(now - prev))
print("  in backfill but NOT in fresh: %d" % len(prev - now))
if now - prev:
    print("\n  sample late arrivals:")
    for r in allr:
        if r["ocid"] in (now - prev):
            tt = r.get("tender", {}) or {}
            print("    %-22s %-26s %s" % (r["ocid"], str(tt.get("title"))[:26], str(tt.get("description"))[:50]))

# --- Test 3: weekend vs weekday publishing ---
import collections
byday = collections.Counter(str(r.get("date"))[:10] for r in rows)
print("\n  publishing by weekday (from 31-day backfill):")
dow = collections.Counter()
for d, n in byday.items():
    try:
        wd = datetime.date.fromisoformat(d).strftime("%a")
    except Exception:
        wd = "?"
    dow[wd] += n
for wd in ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]:
    if wd in dow:
        print("    %s  %5d" % (wd, dow[wd]))
