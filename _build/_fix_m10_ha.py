"""Solo corregir ha/variedad/modulo desde master. NO mover r,c."""
import re, json
from pathlib import Path

master = {str(r["lote"]).strip().upper().replace(" ", ""): r
          for r in json.loads(Path("data-etapa2-master.json").read_text(encoding="utf-8"))}

p = Path("data-licapa2.js")
s = p.read_text(encoding="utf-8")
m = re.search(r"^(window\.MAP_DATA_LICAPA2 = )(\{.*\})(\s*)$", s, re.S)
d = json.loads(m.group(2))

MAGICA_ZONE = {213, 214, 215, 216, 223, 224}

def norm(lote):
    return str(lote).strip().upper().replace(" ", "")

changed = []
for lot in d["lots"]:
    key = norm(lot["lote"])
    src = master.get(key)
    if not src:
        print("NO MASTER", lot["lote"])
        continue
    before = (lot.get("ha"), lot.get("modulo"), lot.get("variedad"), lot.get("tunel"))
    # sync identity fields only — keep r,c
    lot["ha"] = src["ha"]
    lot["modulo"] = src["modulo"]
    lot["tunel"] = src["tunel"]
    # variedad real del master, pero zonaMagica solo en los 6 visuales
    lot["variedad"] = src["variedad"]
    if lot.get("lote") in MAGICA_ZONE or (isinstance(lot.get("lote"), str) and lot["lote"].isdigit() and int(lot["lote"]) in MAGICA_ZONE):
        lot["zonaMagica"] = True
    else:
        # also numeric
        try:
            if int(str(lot["lote"]).split()[0]) in MAGICA_ZONE:
                lot["zonaMagica"] = True
            else:
                lot.pop("zonaMagica", None)
        except Exception:
            lot.pop("zonaMagica", None)

    # split half
    if lot.get("split") and lot["split"].get("lote") is not None:
        sk = norm(lot["split"]["lote"])
        ss = master.get(sk)
        if ss:
            lot["split"]["ha"] = ss["ha"]
            lot["split"]["modulo"] = ss["modulo"]
            lot["split"]["tunel"] = ss["tunel"]
            lot["split"]["variedad"] = ss["variedad"]
            try:
                lid = int(str(lot["split"]["lote"]).split()[0])
            except Exception:
                lid = None
            if lid in MAGICA_ZONE:
                lot["split"]["zonaMagica"] = True
            else:
                lot["split"].pop("zonaMagica", None)

    after = (lot.get("ha"), lot.get("modulo"), lot.get("variedad"), lot.get("tunel"))
    if before != after:
        changed.append((lot["lote"], before, after, lot["r"], lot["c"]))

# zonaMagica strict on 6 lots by lote number
for lot in d["lots"]:
    lids = [lot["lote"]]
    if lot.get("split"):
        lids.append(lot["split"].get("lote"))
    for i, lid in enumerate(lids):
        try:
            n = int(str(lid).split()[0])
        except Exception:
            continue
        target = lot if i == 0 else lot["split"]
        if n in MAGICA_ZONE:
            target["zonaMagica"] = True
        else:
            target.pop("zonaMagica", None)

# Fix modules[].lotes and ha from master aggregates
from collections import defaultdict
agg = defaultdict(lambda: {"ha": 0.0, "n": 0})
for r in master.values():
    agg[r["modulo"]]["ha"] += float(r["ha"])
    agg[r["modulo"]]["n"] += 1
for mod in d["modules"]:
    a = agg[mod["id"]]
    mod["ha"] = round(a["ha"], 2)
    mod["lotes"] = a["n"]
    print(f"M{mod['id']}: lotes={mod['lotes']} ha={mod['ha']}")

# verify M10 ha
m10 = sum(float(l["ha"]) for l in d["lots"] if l.get("modulo") == 10)
m10 += sum(float(l["split"]["ha"]) for l in d["lots"] if l.get("split") and l["split"].get("modulo", l.get("modulo")) == 10 and l.get("modulo") != 10)
# simpler: sum all lot identities
ha_by = defaultdict(float)
n_by = defaultdict(int)
for l in d["lots"]:
    ha_by[l["modulo"]] += float(l.get("ha") or 0)
    n_by[l["modulo"]] += 1
    if l.get("split") and l["split"].get("lote") is not None:
        sm = l["split"].get("modulo", l["modulo"])
        ha_by[sm] += float(l["split"].get("ha") or 0)
        n_by[sm] += 1
print("map after:", {k: (n_by[k], round(ha_by[k], 2)) for k in sorted(ha_by)})
print("changed lots:", len(changed))
for c in changed[:30]:
    print(" ", c)

# MAGICA zone still 6
zm = [l["lote"] for l in d["lots"] if l.get("zonaMagica")]
zm += [l["split"]["lote"] for l in d["lots"] if l.get("split") and l["split"].get("zonaMagica")]
print("zonaMagica:", sorted(zm, key=lambda x: str(x)))

# positions of MAGICA zone unchanged check
for want in (213, 214, 215, 216, 223, 224):
    lot = next(l for l in d["lots"] if l["lote"] == want)
    print(f"LT.{want} still r={lot['r']} c={lot['c']}")

p.write_text(m.group(1) + json.dumps(d, ensure_ascii=False) + "\n", encoding="utf-8")
lp = Path("data-licapa2-layout.json")
if lp.exists():
    lay = json.loads(lp.read_text(encoding="utf-8"))
    # preserve positions from d
    lay["lots"] = d["lots"]
    lay["modules"] = d["modules"]
    lay["labels"] = d.get("labels", lay.get("labels", []))
    lp.write_text(json.dumps(lay, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("ok")
