# -*- coding: utf-8 -*-
"""POST ≥5 lotes únicos por labor · Licapa I (4) + Licapa II (3, sin CERCOS)."""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
API = "https://script.google.com/macros/s/AKfycbyMsvkvDiSwOVd-adNdKvnLWBAop4dPIBnPKU_Z5A3yaVGtt7dTtNfEX_T08RWLj9x3IA/exec"
LIMA = ZoneInfo("America/Lima")
HOY = datetime.now(LIMA).date().isoformat()
SEM = datetime.now(LIMA).isocalendar()[1]
COLOR = "#FF8A65"  # jueves

FUNDOS = {
    "licapa1": {
        "label": "LICAPA I",
        "etapa": "I",
        "data": ROOT / "licapa1" / "data.js",
        "key": "MAP_DATA",
        "labors": ["DESHIERBO", "RECOJO DE FRUTA", "ARENADO DE MACETAS", "CERCOS VIVOS"],
        "mod_labels": {1: "M1", 2: "M2", 3: "M3", 4: "M4", 5: "M5", 10: "M10"},
    },
    "licapa2": {
        "label": "LICAPA II",
        "etapa": "II",
        "data": ROOT / "licapa2" / "data.js",
        "key": "MAP_DATA_LICAPA2",
        "labors": ["DESHIERBO", "RECOJO DE FRUTA", "ARENADO DE MACETAS"],
        "mod_labels": {6: "M6", 7: "M7", 8: "M8", 9: "M9", 10: "M10"},
    },
}


def load_lots(path: Path, var_name: str):
    text = path.read_text(encoding="utf-8")
    m = re.search(rf"window\.{re.escape(var_name)}\s*=\s*(\{{.*\}})\s*;?\s*$", text, re.S)
    if not m:
        raise SystemExit(f"No parse {path.name}")
    data = json.loads(m.group(1))
    lots = []
    for lot in data.get("lots") or []:
        if lot.get("lote") is None or lot.get("tunel") is None:
            continue
        # Preferir lotes numéricos simples (evitar 208 A / 328b en bench)
        lote = lot["lote"]
        if isinstance(lote, str) and not str(lote).isdigit():
            continue
        lots.append(lot)
        if lot.get("split") and isinstance(lot["split"].get("lote"), (int, float)):
            sp = dict(lot["split"])
            sp["r"] = lot["r"]
            sp["c"] = lot["c"]
            lots.append(sp)
    return lots


def pick_unique(lots, n, used):
    out = []
    for lot in lots:
        key = f"{lot.get('tunel')}|{lot.get('lote')}"
        if key in used:
            continue
        ha = float(lot.get("ha") or 0)
        if ha < 0.2:
            continue
        used.add(key)
        out.append(lot)
        if len(out) >= n:
            break
    return out


def post_json(payload, timeout=90):
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        API,
        data=body,
        headers={"Content-Type": "text/plain;charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read().decode("utf-8", errors="replace")
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            return json.loads(raw)
        except Exception:
            return {"ok": False, "message": f"HTTP {e.code}: {raw[:200]}"}
    except Exception as e:
        return {"ok": False, "message": str(e)}


def get_labors(fundo_label, labor, sem):
    q = urllib.parse.urlencode(
        {
            "action": "get",
            "sem": sem,
            "laborReal": labor,
            "fundo": fundo_label,
            "nocache": "1",
        }
    )
    req = urllib.request.Request(API + "?" + q, method="GET")
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read().decode("utf-8", errors="replace"))


def build_record(lot, labor, fundo_meta, avance, jr=2):
    mod_id = lot.get("modulo")
    mod = fundo_meta["mod_labels"].get(mod_id, f"M{mod_id}")
    ha = round(float(lot.get("ha") or 0), 2)
    av = round(min(ha, float(avance)), 2)
    turno = str(lot.get("tunel") or "").upper()
    lote = lot.get("lote")
    if isinstance(lote, float):
        lote = int(lote)
    rec = {
        "sem": SEM,
        "fecha": HOY,
        "laborPpto": labor,
        "laborReal": labor,
        "modulo": mod,
        "turno": turno,
        "lote": lote,
        "variedad": "MAGICA" if str(lot.get("variedad", "")).upper() == "MAGICA" else "SEKOYA POP",
        "area": ha,
        "avance": av,
        "totalJr": jr,
        "color": COLOR,
        "editar": True,
        "fundo": fundo_meta["label"],
        "etapa": fundo_meta["etapa"],
        "posKey": f"{lot.get('r')},{lot.get('c')}",
    }
    if labor == "CERCOS VIVOS":
        rec["lotesTrabajados"] = 1
        rec["ml"] = 80
        rec["avance"] = ha  # cercos usa área completa típica
    return rec


def main():
    print(f"Bench POST · SEM{SEM} · {HOY}")
    print(f"API: {API[:60]}...")
    results = []
    used_global = {"licapa1": set(), "licapa2": set()}

    # Smoke: CERCOS en Licapa II debe fallar
    bad = build_record(
        {"r": 10, "c": 9, "tunel": "T10", "lote": 274, "ha": 0.98, "modulo": 6},
        "CERCOS VIVOS",
        FUNDOS["licapa2"],
        0.2,
    )
    bad_res = post_json({"action": "guardar", "data": bad})
    print("\n[block] CERCOS @ Licapa II →", bad_res.get("ok"), bad_res.get("message") or bad_res.get("error") or "")
    results.append(("CERCOS_II_BLOCK", bad_res))

    for fid, meta in FUNDOS.items():
        lots = load_lots(meta["data"], meta["key"])
        print(f"\n=== {meta['label']} · {len(lots)} lotes ===")
        for labor in meta["labors"]:
            picked = pick_unique(lots, 5, used_global[fid])
            if len(picked) < 5:
                print(f"  ! {labor}: solo {len(picked)} lotes únicos")
            # avance parcial 0.34 o 35% del área (probar restante/pintura)
            items = []
            for i, lot in enumerate(picked):
                ha = float(lot["ha"])
                av = 0.34 if ha >= 0.5 else round(ha * 0.35, 2)
                if labor == "CERCOS VIVOS":
                    av = ha
                items.append(build_record(lot, labor, meta, av, jr=2 + i))

            payload = {
                "action": "guardar_grupo",
                "data": {
                    "laborReal": labor,
                    "laborPpto": labor,
                    "fecha": HOY,
                    "sem": SEM,
                    "variedad": "SEKOYA POP",
                    "totalJr": sum(x["totalJr"] for x in items),
                    "color": COLOR,
                    "fundo": meta["label"],
                    "etapa": meta["etapa"],
                    "items": items,
                    "ml": sum(x.get("ml") or 0 for x in items) if labor == "CERCOS VIVOS" else 0,
                    "lotesTrabajados": len(items) if labor == "CERCOS VIVOS" else 0,
                },
            }
            print(f"  POST {labor} × {len(items)} …", flush=True)
            res = post_json(payload)
            ok = bool(res.get("ok"))
            msg = res.get("message") or res.get("error") or ("synced" if res.get("synced") else "")
            print(f"    → ok={ok} count={res.get('count') or res.get('saved') or len(items)} {msg}")
            results.append((f"{fid}:{labor}:POST", res))
            time.sleep(1.2)

            # GET verify
            try:
                g = get_labors(meta["label"], labor, SEM)
                lst = g.get("list") or g.get("records") or []
                keys = {f"{(x.get('turno') or '').upper()}|{x.get('lote')}" for x in lst}
                hit = 0
                for it in items:
                    k = f"{it['turno']}|{it['lote']}"
                    if k in keys:
                        hit += 1
                print(f"    GET list={len(lst)} matched={hit}/{len(items)}")
                results.append((f"{fid}:{labor}:GET", {"ok": g.get("ok"), "count": len(lst), "matched": hit}))
            except Exception as e:
                print(f"    GET fail: {e}")
                results.append((f"{fid}:{labor}:GET", {"ok": False, "message": str(e)}))
            time.sleep(0.8)

    # Resumen
    print("\n======== RESUMEN ========")
    posts = [r for k, r in results if k.endswith(":POST")]
    gets = [r for k, r in results if k.endswith(":GET")]
    ok_post = sum(1 for r in posts if r.get("ok"))
    ok_get = sum(1 for r in gets if r.get("ok") and r.get("matched", 0) >= 5)
    print(f"POSTs ok: {ok_post}/{len(posts)}")
    print(f"GETs con ≥5 match: {ok_get}/{len(gets)}")
    block = next((r for k, r in results if k == "CERCOS_II_BLOCK"), {})
    print(f"CERCOS II bloqueado: {not block.get('ok')}")
    out = ROOT / "_bench_post5_result.json"
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Log: {out}")
    return 0 if ok_post == len(posts) and ok_get == len(gets) else 1


if __name__ == "__main__":
    raise SystemExit(main())
