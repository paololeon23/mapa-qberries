import re, json
from pathlib import Path
from collections import Counter, defaultdict

s = Path("data-licapa2.js").read_text(encoding="utf-8")
d = json.loads(re.search(r"window\.MAP_DATA_LICAPA2 = (\{.*\})", s, re.S).group(1))

print("=== MODULES declared ===")
for m in d.get("modules", []):
    print(m)

print("\n=== LOT counts by modulo field ===")
by_mod = Counter()
magica = []
for l in d["lots"]:
    by_mod[l.get("modulo")] += 1
    if l.get("zonaMagica") or (l.get("split") and l["split"].get("zonaMagica")):
        magica.append(l)
    if str(l.get("variedad","")).upper().find("MAGIC") >= 0:
        pass
print(dict(sorted(by_mod.items(), key=lambda x: (x[0] is None, x[0]))))

print("\n=== zonaMagica lots ===")
for l in sorted(magica, key=lambda x: x["lote"]):
    print(f"  LT.{l['lote']} mod={l.get('modulo')} r={l['r']} c={l['c']} var={l.get('variedad')}")

# Compare modules[].lotes vs actual count
print("\n=== modules.lotes vs counted ===")
for m in d.get("modules", []):
    mid = m["id"]
    actual = sum(1 for l in d["lots"] if l.get("modulo") == mid)
    # also half-lots?
    print(f"M{mid}: declared lotes={m.get('lotes')} ha={m.get('ha')} actual_lots={actual}")

# master check
mp = Path("data-etapa2-master.json")
if mp.exists():
    master = json.loads(mp.read_text(encoding="utf-8"))
    print("\n=== master keys sample ===", list(master)[:5] if isinstance(master, dict) else type(master))
    if isinstance(master, list):
        print("master list len", len(master))
        print("sample", master[0] if master else None)
    elif isinstance(master, dict):
        lots_m = master.get("lots") or master.get("lotes") or []
        print("master lots", len(lots_m) if isinstance(lots_m, list) else "n/a")
