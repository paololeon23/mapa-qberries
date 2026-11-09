#!/usr/bin/env python3
"""Genera frecuencias-data.json desde el Excel de campaña (DATA EXP Y CAMP)."""
import argparse
import json
import re
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

try:
    import openpyxl
    from openpyxl.utils.datetime import from_excel
except ImportError as e:
    raise SystemExit("Instala openpyxl: pip install openpyxl") from e


def to_date(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, (int, float)):
        try:
            d = from_excel(v)
            return d.date() if isinstance(d, datetime) else d
        except Exception:
            return None
    s = str(v).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def norm_turn(t):
    s = str(t or "").strip().upper().replace(" ", "")
    m = re.match(r"^T?(\d{1,3})([A-Z])?$", s)
    if m:
        return "T" + m.group(1) + (m.group(2) or "")
    digits = re.sub(r"\D", "", s)
    return ("T" + digits) if digits else ""


def norm_mod(m):
    s = str(m or "").strip().upper().replace(" ", "")
    if not s:
        return ""
    if s.startswith("M"):
        return s
    d = re.sub(r"\D", "", s)
    return "M" + d if d else s


def norm_var(v):
    s = str(v or "").strip().upper()
    if "MAGICA" in s:
        return "MAGICA"
    if "SEKOYA" in s:
        return "SEKOYA POP"
    return s or "SEKOYA POP"


def find_sheet(wb, needle):
    needle = needle.upper().replace(" ", "")
    for name in wb.sheetnames:
        compact = name.upper().replace(" ", "")
        if needle in compact:
            return name
    return None


def build(xlsx: Path, out: Path, cut: date):
    wb = openpyxl.load_workbook(xlsx, data_only=True, read_only=True)
    sheet = find_sheet(wb, "DATAEXPYCAMP(2)") or find_sheet(wb, "DATAEXPYCAMP")
    if not sheet:
        raise SystemExit("No se encontró hoja DATA EXP Y CAMP (2)")
    ws = wb[sheet]

    lots = defaultdict(set)
    headers = None
    bad = 0
    n = 0
    for row in ws.iter_rows(values_only=True):
        if headers is None:
            headers = [str(h or "").strip().upper() for h in row]
            idx = {h: i for i, h in enumerate(headers)}

            def col(*names):
                for name in names:
                    for k, i in idx.items():
                        if name in k:
                            return i
                return None

            i_fecha = col("FECHA")
            i_var = col("VARIEDAD")
            i_mod = col("MODULO", "MÓDULO")
            i_turn = col("TURNO")
            i_lote = col("LOTE")
            i_fundo = col("FUNDO")
            continue

        n += 1
        fundo = str(row[i_fundo] or "").upper() if i_fundo is not None else ""
        if fundo and "QBERRIES" not in fundo and "LICAPA" not in fundo:
            continue
        d = to_date(row[i_fecha] if i_fecha is not None else None)
        if not d:
            bad += 1
            continue
        var = norm_var(row[i_var] if i_var is not None else "")
        mod = norm_mod(row[i_mod] if i_mod is not None else "")
        turn = norm_turn(row[i_turn] if i_turn is not None else "")
        try:
            lote = int(float(row[i_lote]))
        except (TypeError, ValueError):
            continue
        if not lote or not turn:
            continue
        lots[f"{var}|{mod}|{turn}|{lote}"].add(d.isoformat())

    out_lots = []
    for key, dates in lots.items():
        var, mod, turn, lote = key.split("|")
        ordered = sorted(dates)
        entries = []
        prev = None
        for i, ds in enumerate(ordered):
            d = date.fromisoformat(ds)
            dr = 1 if i == 0 else (d - date.fromisoformat(prev)).days
            entries.append({"n": i + 1, "fecha": ds, "dr": dr})
            prev = ds
        out_lots.append({
            "variedad": var,
            "modulo": mod,
            "turno": turn,
            "lote": int(lote),
            "entradas": entries,
            "ultima": ordered[-1],
            "nEntradas": len(ordered),
        })
    out_lots.sort(key=lambda x: (x["variedad"], x["modulo"], x["turno"], x["lote"]))

    payload = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "source": sheet,
        "fundo": "LICAPA",
        "defaultCutDate": cut.isoformat(),
        "colors": {"verde": [0, 8], "amarillo": [9, 11], "rojo": [12, 9999]},
        "lots": out_lots,
        "meta": {"rows": n, "badDates": bad, "lotCount": len(out_lots)},
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"OK {out} · {len(out_lots)} lotes · {out.stat().st_size} bytes")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx", type=Path)
    ap.add_argument("-o", "--out", type=Path, default=Path("frecuencias-data.json"))
    ap.add_argument("--cut", default="2026-11-05")
    args = ap.parse_args()
    build(args.xlsx, args.out, date.fromisoformat(args.cut))
