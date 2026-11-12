import json
from pathlib import Path
from collections import Counter

mp = Path("data-etapa2-master.json")
master = json.loads(mp.read_text(encoding="utf-8"))
print(type(master), len(master) if hasattr(master, "__len__") else "")
if isinstance(master, dict):
    print(master.keys())
    for k, v in master.items():
        if isinstance(v, list):
            print(k, len(v), "sample", v[0] if v else None)
        else:
            print(k, type(v).__name__, str(v)[:80])
elif isinstance(master, list):
    print("sample keys", master[0].keys() if master else None)
    print("sample", master[0] if master else None)
    # count by modulo / variedad
    mods = Counter()
    vars_ = Counter()
    for r in master:
        mods[r.get("modulo") or r.get("md") or r.get("MD")] += 1
        vars_[str(r.get("variedad") or r.get("VARIEDAD") or "").upper()] += 1
    print("mods", dict(mods))
    print("variedades", dict(vars_))
    mag = [r for r in master if "MAGIC" in str(r.get("variedad") or r.get("VARIEDAD") or "").upper()]
    print("MAGICA count", len(mag))
    if mag:
        print("MAGICA sample", mag[:3])
        print("MAGICA lotes", sorted({r.get("lote") or r.get("LOTE") for r in mag})[:30])
