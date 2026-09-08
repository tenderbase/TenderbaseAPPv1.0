import json, glob, re, datetime, collections

rows = []
for f in sorted(glob.glob("ocds_*.json")):
    rows.extend(json.load(open(f))["releases"])

t = lambda r: (r.get("tender", {}) or {})
def blob(r):
    tt = t(r)
    return " ".join(str(tt.get(k) or "") for k in ("title", "description", "specialConditions"))

NOW = datetime.datetime(2026, 9, 8, tzinfo=datetime.timezone.utc)
def parse(d):
    if not d: return None
    try: return datetime.datetime.fromisoformat(d.replace("Z", "+00:00"))
    except Exception: return None

print("=" * 72)
print("A. 'EXPIRING SOON' POOL SIZE  (closing within 7 days of 2026-09-08)")
buckets = collections.Counter()
for r in rows:
    cd = parse((t(r).get("tenderPeriod") or {}).get("endDate"))
    if not cd: continue
    d = (cd - NOW).total_seconds() / 86400.0
    if d < 0: buckets["already closed"] += 1
    elif d <= 7: buckets["closing in 0-7 days"] += 1
    elif d <= 14: buckets["closing in 7-14 days"] += 1
    elif d <= 30: buckets["closing in 14-30 days"] += 1
    else: buckets["closing >30 days"] += 1
for k in ["already closed", "closing in 0-7 days", "closing in 7-14 days",
          "closing in 14-30 days", "closing >30 days"]:
    print("    %-24s %5d" % (k, buckets[k]))
active = sum(1 for r in rows if t(r).get("status") == "active")
print("    status=active total: %d / %d" % (active, len(rows)))
print("    NOTE: 'expiring soon' should filter status=active AND closing in 0-7d")

print("\n" + "=" * 72)
print("B. KEYWORD RECALL — does exact-match miss real opportunities?")
# snowball-english-ish: cater matches catering/caterer/caterers/catered
variants = {
    "exact 'catering'":      r"catering",
    "stem 'cater\\w*'":      r"\bcater\w*",
    "canteen":               r"canteen",
    "meals":                 r"\bmeals?\b",
    "food service/provision":r"food (?:service|provision|suppl)|provision of food",
}
seen = {k: set() for k in variants}
for r in rows:
    b = blob(r).lower()
    for k, pat in variants.items():
        if re.search(pat, b):
            seen[k].add(r["ocid"])

for k in variants:
    print("    %-24s %4d" % (k, len(seen[k])))

union = set().union(*seen.values())
exact = seen["exact 'catering'"]
print("\n    exact-match only          : %d tenders" % len(exact))
print("    stem + variants (union)   : %d tenders" % len(union))
print("    MISSED by exact match     : %d tenders (%.0f%% more recall)"
      % (len(union - exact), 100.0 * len(union - exact) / max(len(exact), 1)))

print("\n    --- the misses (real food-service tenders exact match would skip) ---")
for r in rows:
    if r["ocid"] in (union - exact):
        tt = t(r)
        print("      %-34s | %s" % (str(tt.get("title"))[:34], str(tt.get("description"))[:70]))

print("\n" + "=" * 72)
print("C. CATEGORY vs KEYWORD for food service")
fb = [r for r in rows if "Food and beverage" in str(t(r).get("category"))]
print("    category='Food and beverage service activities': %d" % len(fb))
print("    keyword union: %d" % len(union))
print("    BOTH: %d   | category-only: %d   | keyword-only: %d"
      % (len(set(r['ocid'] for r in fb) & union),
         len(set(r['ocid'] for r in fb) - union),
         len(union - set(r['ocid'] for r in fb))))
print("    --> category alone misses %d; keyword alone misses %d. USE BOTH."
      % (len(union - set(r['ocid'] for r in fb)), len(set(r['ocid'] for r in fb) - union)))

print("\n" + "=" * 72)
print("D. SAME TEST FOR OTHER LIKELY FILTER TERMS")
for word, pat in [("cleaning", r"cleaning|cleaners|hygiene|janitorial"),
                  ("security", r"security|guarding|guards"),
                  ("construction", r"construction|building works|civil works"),
                  ("transport", r"transport|fleet|shuttle|bus service")]:
    ex = {r["ocid"] for r in rows if word in blob(r).lower()}
    br = {r["ocid"] for r in rows if re.search(pat, blob(r).lower())}
    print("    %-14s exact %3d -> broad %3d  (+%d, +%.0f%%)"
          % (word, len(ex), len(br), len(br - ex), 100.0 * len(br - ex) / max(len(ex), 1)))

print("\n" + "=" * 72)
print("E. HOW MANY TENDERS/DAY (real backfill size)")
byday = collections.Counter(str(r.get("date"))[:10] for r in rows)
for d in sorted(byday):
    print("    %s  %4d" % (d, byday[d]))
print("    TOTAL %d over %d days = %.0f/day" % (len(rows), len(byday), len(rows) / len(byday)))
