import json, glob, datetime, collections

rows = []
for f in sorted(glob.glob("ocds_*.json")):
    rows.extend(json.load(open(f))["releases"])

t = lambda r: (r.get("tender", {}) or {})
NOW = datetime.datetime(2026, 9, 8, tzinfo=datetime.timezone.utc)


def parse(d):
    if not d:
        return None
    try:
        return datetime.datetime.fromisoformat(d.replace("Z", "+00:00"))
    except Exception:
        return None


print("=" * 72)
print("A. REAL 'EXPIRING SOON' POOL  (closing <=7d AND status=active)")
soon = []
for r in rows:
    cd = parse((t(r).get("tenderPeriod") or {}).get("endDate"))
    if not cd:
        continue
    d = (cd - NOW).total_seconds() / 86400.0
    if 0 <= d <= 7:
        soon.append(r)
print("    closing in 0-7 days (any status) : %d" % sum(
    1 for r in rows
    if (lambda c: c and 0 <= (c - NOW).total_seconds() / 86400.0 <= 7)(
        parse((t(r).get("tenderPeriod") or {}).get("endDate")))))
print("    ...AND status=active             : %d" % sum(1 for r in soon if t(r).get("status") == "active"))
print("    ...status breakdown:", dict(collections.Counter(t(r).get("status") for r in soon)))

print("\n" + "=" * 72)
print("B. STATUS vs CLOSING DATE  (should we notify on non-active?)")
for st in ["active", "complete", "cancelled", "planning"]:
    sub = [r for r in rows if t(r).get("status") == st]
    future = sum(1 for r in sub
                 if (lambda c: c and c > NOW)(parse((t(r).get("tenderPeriod") or {}).get("endDate"))))
    print("    %-10s %5d total | %5d with closing date in the FUTURE" % (st, len(sub), future))

print("\n" + "=" * 72)
print("C. CLOSING TIME OF DAY  (when should the digest/expiry alert fire?)")
hours = collections.Counter()
for r in rows:
    cd = parse((t(r).get("tenderPeriod") or {}).get("endDate"))
    if cd:
        hours[cd.hour] += 1
for h in sorted(hours):
    print("    %02d:00 UTC (%02d:00 SAST)  %4d" % (h, (h + 2) % 24, hours[h]))

print("\n" + "=" * 72)
print("D. DUPLICATE / IDENTITY CHECK")
tn = collections.Counter(str(t(r).get("id")) for r in rows)
print("    tender.id unique? %d unique of %d releases" % (len(tn), len(rows)))
print("    most repeated tender.id:", tn.most_common(3))
oc = collections.Counter(r.get("ocid") for r in rows)
print("    ocid duplicated across days:", [k for k, v in oc.items() if v > 1][:5] or "none")

print("\n" + "=" * 72)
print("E. KWAZULU-NATAL + FOOD/CATERING  (your example: a Durban caterer)")
kzn = [r for r in rows if t(r).get("province") == "KwaZulu-Natal"]
print("    KZN tenders in 31 days: %d (%.1f%% of all)" % (len(kzn), 100.0 * len(kzn) / len(rows)))
import re
def blob(r):
    tt = t(r)
    return " ".join(str(tt.get(k) or "") for k in ("title", "description", "specialConditions")).lower()
food = [r for r in kzn if re.search(r"cater\w*|canteen|meals?\b|food (service|provision)", blob(r))
        or "Food and beverage" in str(t(r).get("category"))]
print("    KZN food/catering matches (category OR keyword): %d" % len(food))
print("    --> ~%.1f per week for a single narrow filter" % (len(food) / 4.43))
for r in food[:8]:
    tt = t(r)
    cd = parse((tt.get("tenderPeriod") or {}).get("endDate"))
    print("      %-24s | %-28s | closes %s" % (str(tt.get("title"))[:24], str(tt.get("description"))[:28],
                                              cd.date() if cd else "?"))
