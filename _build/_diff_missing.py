import re, json
from pathlib import Path
from collections import Counter

master = json.loads(Path("data-etapa2-master.json").read_text(encoding="utf-8"))
s = Path("data-licapa2.js").read_text(encoding="utf-8")
d = json.loads(re.search(r"window\.MAP_DATA_LICAPA2 = (\{.*\})", s, re.S).group(1))

def lot_key(x):
    return str(x).strip().upper().replace(" ", "")

map_lotes = set()
for l in d["lots"]:
    map_lotes.add(lot_key(l["lote"]))
    if l.get("split") and l["split"].get("lote") is not None:
        map_lotes.add(lot_key(l["split"]["lote"]))

master_by_mod = Counter()
missing = []
extra = []
master_lotes = set()
for r in master:
    k = lot_key(r["lote"])
    master_lotes.add(k)
    master_by_mod[r["modulo"]] += 1
    if k not in map_lotes:
        missing.append(r)

for k in sorted(map_lotes):
    if k not in master_lotes:
        extra.append(k)

print("master", len(master), "map unique lotes", len(map_lotes))
print("missing from map", len(missing))
for r in sorted(missing, key=lambda x: (x["modulo"], str(x["lote"]))):
    print(f"  M{r['modulo']} LT.{r['lote']} {r['variedad']} ha={r['ha']} T={r['tunel']}")
print("extra on map not in master", extra[:40], "count", len(extra))

# ha by module master vs map
print("\nHA master vs map")
for mid in (6, 7, 8, 9, 10):
    mha = round(sum(r["ha"] for r in master if r["modulo"] == mid), 2)
    pha = 0
    for l in d["lots"]:
        if l.get("modulo") == mid:
            pha += float(l.get("ha") or 0)
        if l.get("split") and (l["split"].get("modulo", l.get("modulo")) == mid):
            pha += float(l["split"].get("ha") or 0)
    mod = next(m for m in d["modules"] if m["id"] == mid)
    print(f"M{mid}: master_ha={mha} map_ha={round(pha,2)} declared_ha={mod['ha']} declared_lotes={mod['lotes']}")

# Licapa1 peek
s1 = Path("data.js").read_text(encoding="utf-8")
# find MAP_DATA
m = re.search(r"window\.MAP_DATA\s*=\s*(\{)", s1)
print("\ndata.js has MAP_DATA", bool(m), "size", len(s1))
# modules in licapa1
m2 = re.search(r"modules\"?\s*:\s*(\[.*?\])\s*,\s*\"?lots", s1, re.S)
if not m2:
    # try json dump style
    try:
        d1 = json.loads(re.search(r"window\.MAP_DATA = (\{.*\})\s*;?\s*$", s1, re.S).group(1))
        print("L1 modules", d1.get("modules"))
        print("L1 lot count", len(d1.get("lots", [])))
        print("L1 mod ids", [x["id"] for x in d1.get("modules", [])])
    except Exception as e:
        print("parse L1 fail", e)
