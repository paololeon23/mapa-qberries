import json
from collections import Counter, defaultdict

with open(r"C:\Users\CRISTOPHERPAOLOLEONA\Desktop\mapa\data-etapa2-master.json", encoding="utf-8") as f:
    data = json.load(f)

print("total", len(data))
print("modulos", Counter(d["modulo"] for d in data))
by_mod = defaultdict(list)
for d in data:
    by_mod[d["modulo"]].append(d)
for m in sorted(by_mod):
    lots = sorted(by_mod[m], key=lambda x: (str(x["lote"]), x["tunel"]))
    print(f"=== M{m} ({len(lots)}) ===")
    for d in lots:
        print(f"  {d['tunel']} Lt.{d['lote']} ha={d['ha']} cod={d['cod']}")
