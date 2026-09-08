import json, glob, collections, re, datetime, statistics

files = sorted(glob.glob("ocds_*.json"))
allr = []
for f in files:
    d = json.load(open(f))
    allr.extend(d["releases"])

print("=" * 70)
print("DATASET: %d raw releases from %d weekly files" % (len(allr), len(files)))
ocids = [r.get("ocid") for r in allr]
uniq = {}
for r in allr:
    uniq[r.get("ocid")] = r
print("unique ocids: %d  (duplicates across ranges: %d)" % (len(uniq), len(allr) - len(uniq)))
rows = list(uniq.values())


def parse(d):
    if not d:
        return None
    try:
        return datetime.datetime.fromisoformat(d.replace("Z", "+00:00"))
    except Exception:
        return None


SENTINEL = datetime.datetime(1, 1, 1, tzinfo=datetime.timezone.utc)

print("\n" + "=" * 70)
print("1. CLOSING DATE COVERAGE  (drives the '1 week before expiry' alert)")
have, sentinel, valid = 0, 0, 0
leads = []
for r in rows:
    t = r.get("tender", {}) or {}
    tp = t.get("tenderPeriod") or {}
    cd = parse(tp.get("endDate"))
    if tp.get("endDate"):
        have += 1
        if cd == SENTINEL:
            sentinel += 1
        else:
            valid += 1
            pdt = parse(r.get("date"))
            if pdt and cd:
                leads.append((cd - pdt).total_seconds() / 86400.0)
print("  tenderPeriod.endDate present : %d / %d  (%.1f%%)" % (have, len(rows), 100.0 * have / len(rows)))
print("  ...of which SENTINEL 0001-01-01: %d" % sentinel)
print("  ...USABLE closing dates        : %d  (%.1f%%)" % (valid, 100.0 * valid / len(rows)))
if leads:
    leads.sort()
    print("\n  lead time (closing - published), days:")
    print("    min %.1f | p10 %.1f | median %.1f | p90 %.1f | max %.1f"
          % (leads[0], leads[len(leads)//10], statistics.median(leads), leads[int(len(leads)*0.9)], leads[-1]))
    print("    >=7 days (enough for a 1-week warning): %d / %d (%.1f%%)"
          % (sum(1 for x in leads if x >= 7), len(leads), 100.0*sum(1 for x in leads if x >= 7)/len(leads)))
    print("    <7 days  (too late to warn)          : %d (%.1f%%)"
          % (sum(1 for x in leads if x < 7), 100.0*sum(1 for x in leads if x < 7)/len(leads)))

print("\n" + "=" * 70)
print("2. CATEGORY QUALITY  (app currently shows 97% 'Other')")
cats = collections.Counter((r.get("tender", {}) or {}).get("category") for r in rows)
print("  distinct categories: %d" % len(cats))
for k, v in cats.most_common(18):
    print("    %5d (%.1f%%)  %s" % (v, 100.0*v/len(rows), k))
other = cats.get("Other", 0)
print("  --> 'Other': %d (%.1f%%)" % (other, 100.0*other/len(rows)))

print("\n" + "=" * 70)
print("3. PROVINCE COVERAGE")
prov = collections.Counter((r.get("tender", {}) or {}).get("province") for r in rows)
for k, v in prov.most_common():
    print("    %5d (%.1f%%)  %s" % (v, 100.0*v/len(rows), k))

print("\n" + "=" * 70)
print("4. FIELD COVERAGE")
def cov(label, fn):
    n = sum(1 for r in rows if fn(r))
    print("    %-26s %5d / %d  (%.1f%%)" % (label, n, len(rows), 100.0*n/len(rows)))
t = lambda r: (r.get("tender", {}) or {})
cov("has title", lambda r: bool(t(r).get("title")))
cov("has description", lambda r: bool(t(r).get("description")))
cov("has organisation", lambda r: bool((r.get("buyer") or {}).get("name") or (t(r).get("procuringEntity") or {}).get("name")))
cov("has documents", lambda r: bool(t(r).get("documents")))
cov("has contactPerson", lambda r: bool(t(r).get("contactPerson")))
cov("has contact email", lambda r: bool((t(r).get("contactPerson") or {}).get("email")))
cov("has deliveryLocation", lambda r: bool(t(r).get("deliveryLocation")))
cov("value.amount > 0", lambda r: ((t(r).get("value") or {}).get("amount") or 0) > 0)

print("\n  status:", dict(collections.Counter(t(r).get("status") for r in rows)))

print("\n" + "=" * 70)
print("5. KEYWORD RECALL TEST  (can users filter on 'catering'?)")
def blob(r):
    tt = t(r)
    return " ".join(str(tt.get(k) or "") for k in ("title", "description", "specialConditions"))

for kw in ["catering", "cater", "food", "cleaning", "security", "construction", "transport", "training", "consulting"]:
    hits = [r for r in rows if kw in blob(r).lower()]
    print("    %-14s %4d hits (%.1f%%)" % (kw, len(hits), 100.0*len(hits)/len(rows)))

print("\n  --- 'catering' matches: precision check (title | category) ---")
for r in rows:
    if "catering" in blob(r).lower():
        tt = t(r)
        print("      %-30s | %-32s | %s" % (str(tt.get("title"))[:30], str(tt.get("category"))[:32], str((r.get("buyer") or {}).get("name"))[:28]))

print("\n  --- NEAR-MISSES: food-ish tenders NOT containing 'catering' ---")
n = 0
for r in rows:
    b = blob(r).lower()
    if "catering" not in b and any(w in b for w in ["meal", "canteen", "refreshment", "food", "caterer", "cafeteria"]):
        tt = t(r)
        print("      %-30s | %-32s | %s" % (str(tt.get("title"))[:30], str(tt.get("category"))[:32], str(tt.get("description"))[:60]))
        n += 1
        if n >= 12:
            break

print("\n" + "=" * 70)
print("6. CIDB GRADE EXTRACTION")
pat = re.compile(r"CIDB[^.]{0,120}?(?:grading|grade)[^.]{0,80}?([1-9](?:CE|GB|PE|ME|EE|EB|EP|SC|SW|SF|SG|SJ|SK|SL|SM|SN|SO|SP|SQ|SR|SS|ST|SU|SV)[A-Za-z]?)", re.I)
hits = [r for r in rows if pat.search(json.dumps(r))]
print("  releases with extractable CIDB grade: %d / %d (%.1f%%)" % (len(hits), len(rows), 100.0*len(hits)/len(rows)))
for r in hits[:6]:
    m = pat.search(json.dumps(r))
    print("    %-22s %s" % (r.get("ocid"), m.group(0)[:80]))
