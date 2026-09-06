#!/usr/bin/env bash
# ============================================================
# Refresh data/rates.json from the FRED Optimal Blue indices.
#
#   ./scripts/refresh-rates.sh
#
# Pulls the four FRED series below, takes the last dated row that
# actually carries a value, and rewrites data/rates.json. Anything
# that fails validation (outside 2-15, or more than 0.75 away from
# the rate we already publish) is discarded and the previous value
# is kept — printed as `KEPT <program>`.
#
# WHEDA has no public series, so the scheduled task looks it up and
# passes it in:
#   WHEDA_RATE=6.375 WHEDA_STD=7.75 WHEDA_ASOF=2026-09-06
# If those are unset the previous WHEDA entry is kept as is.
#
# `overrides` and `adjustment` in the existing file are preserved.
# Pure bash + python3 — no jq.
# ============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/data/rates.json"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ ! -f "$OUT" ]; then
  echo "error: $OUT not found" >&2
  exit 1
fi

# program:FRED series id
SERIES="conventional:OBMMIC30YF fha:OBMMIFHA30YF va:OBMMIVA30YF usda:OBMMIUSDA30YF"

for pair in $SERIES; do
  prog="${pair%%:*}"
  id="${pair##*:}"
  if ! curl -sfL --max-time 45 \
      "https://fred.stlouisfed.org/graph/fredgraph.csv?id=$id" \
      -o "$TMP/$prog.csv"; then
    echo "WARN fetch failed for $prog ($id)" >&2
    rm -f "$TMP/$prog.csv"
  fi
done

python3 - "$OUT" "$TMP" <<'PY'
import json, os, sys, datetime

out_path, tmp = sys.argv[1], sys.argv[2]

with open(out_path) as f:
    data = json.load(f)

programs = data.setdefault("programs", {})
adjustment = data.get("adjustment", -0.25)
overrides = data.get("overrides", {})

SOURCES = {
    "conventional": ("OBMMIC30YF", "FRED OBMMIC30YF (Optimal Blue 30-yr conforming index)"),
    "fha":          ("OBMMIFHA30YF", "FRED OBMMIFHA30YF"),
    "va":           ("OBMMIVA30YF", "FRED OBMMIVA30YF"),
    "usda":         ("OBMMIUSDA30YF", "FRED OBMMIUSDA30YF"),
}
MAX_DELTA = 0.75

def last_row(path):
    """Last CSV row whose value is not '.' -> (date, float) or None."""
    try:
        with open(path) as f:
            rows = [r.strip() for r in f if r.strip()]
    except OSError:
        return None
    for line in reversed(rows[1:]):
        parts = line.split(",")
        if len(parts) < 2:
            continue
        date, raw = parts[0].strip(), parts[-1].strip().strip('"')
        if raw in (".", ""):
            continue
        try:
            return date, float(raw)
        except ValueError:
            continue
    return None

summary = []
for prog, (series_id, source) in SOURCES.items():
    entry = programs.get(prog, {})
    prev = entry.get("metric")
    row = last_row(os.path.join(tmp, prog + ".csv"))
    keep = None
    if row is None:
        keep = "no data"
    else:
        date, val = row
        if not (2.0 <= val <= 15.0):
            keep = "out of range %.3f" % val
        elif isinstance(prev, (int, float)) and abs(val - prev) > MAX_DELTA:
            keep = "delta %.3f" % (val - prev)
        else:
            entry["metric"] = round(val, 3)
            entry["asOf"] = date
            entry["source"] = source
            programs[prog] = entry
    if keep:
        print("KEPT %s (%s)" % (prog, keep))
        programs[prog] = entry
    e = programs.get(prog, {})
    summary.append("%s %s (%s)" % (
        prog[:4], e.get("metric", "-"), str(e.get("asOf", "-"))[5:]))

# WHEDA: supplied by the caller, otherwise left exactly as it was.
w = programs.get("wheda", {})
wr, ws, wa = (os.environ.get(k, "").strip()
              for k in ("WHEDA_RATE", "WHEDA_STD", "WHEDA_ASOF"))
if wr:
    try:
        v = float(wr)
        prev = w.get("metric")
        if not (2.0 <= v <= 15.0):
            print("KEPT wheda (out of range %.3f)" % v)
        elif isinstance(prev, (int, float)) and abs(v - prev) > MAX_DELTA:
            print("KEPT wheda (delta %.3f)" % (v - prev))
        else:
            w["metric"] = round(v, 3)
            if wa:
                w["asOf"] = wa
            if ws:
                try:
                    w.setdefault("alt", {})["standard30"] = round(float(ws), 3)
                except ValueError:
                    pass
    except ValueError:
        print("KEPT wheda (unparseable WHEDA_RATE)")
if w:
    programs["wheda"] = w
    summary.append("wheda %s (%s)" % (w.get("metric", "-"), str(w.get("asOf", "-"))[5:]))

data["updated"] = datetime.datetime.now(datetime.timezone.utc).strftime(
    "%Y-%m-%dT%H:%M:%SZ")
data["adjustment"] = adjustment
data["programs"] = programs
data["overrides"] = overrides
data.setdefault(
    "note",
    "Default calculator rates = program market metric + adjustment. "
    "Estimates, not quotes.")

body = json.dumps(
    {"updated": data["updated"], "adjustment": data["adjustment"],
     "note": data["note"], "programs": programs, "overrides": overrides},
    indent=2) + "\n"

with open(out_path, "w") as f:
    f.write(body)

print(body, end="")
print(" | ".join(summary))
PY
