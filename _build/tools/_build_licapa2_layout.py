"""Build data-licapa2-layout.json from visual grid + master JSON attributes."""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

MASTER = Path(r"C:\Users\CRISTOPHERPAOLOLEONA\Desktop\mapa\data-etapa2-master.json")
OUT = Path(r"C:\Users\CRISTOPHERPAOLOLEONA\Desktop\mapa\data-licapa2-layout.json")

master = json.loads(MASTER.read_text(encoding="utf-8"))

# Key by normalized lote id (int or str like "328b", "208 A")
def norm_lote(v):
    if isinstance(v, int):
        return v
    s = str(v).strip()
    low = s.lower().replace(" ", "")
    if low.endswith("b") and low[:-1].isdigit():
        return low  # e.g. 328b
    if low.endswith("a") and low[:-1].isdigit():
        return s  # keep "208 A" style from master
    if s.replace(" ", "").upper() in ("208A", "208B"):
        return "208 A" if "A" in s.upper() else "208 B"
    try:
        return int(s)
    except ValueError:
        return s


by_lote = {}
for d in master:
    by_lote[norm_lote(d["lote"])] = d

# Also index string variants
for d in master:
    by_lote[str(d["lote"])] = d
    by_lote[str(d["lote"]).lower()] = d
    by_lote[str(d["lote"]).lower().replace(" ", "")] = d


def lookup(lote):
    keys = [lote, norm_lote(lote), str(lote), str(lote).lower(), str(lote).lower().replace(" ", "")]
    if lote == "328b" or lote == "328B":
        keys += [328, "328b", "328B"]
    if lote in ("208A", "208 A", "208a"):
        keys += ["208 A", "208A"]
    if lote in ("208B", "208 B", "208b"):
        keys += ["208 B", "208B"]
    for k in keys:
        if k in by_lote:
            return by_lote[k]
    raise KeyError(f"lote not in master: {lote!r}")


# Visual grid: list of (r, c, lote_key)
# lote_key matches master (int or "328b" / "208 A" / "208 B")
#
# Column 0 = leftmost M9 (Lt.379 column).
# Top M8 crown starts at c=5.
# Sparse rows 5,7,9 hold vertically stacked split lots.

GRID = [
    # r0 — M8 crown top
    (0, 5, 358), (0, 6, 359), (0, 7, 362), (0, 8, 363),
    (0, 9, 366), (0, 10, 367), (0, 11, 370), (0, 12, 371),
    # r1 — M8 crown second
    (1, 5, 357), (1, 6, 360), (1, 7, 361), (1, 8, 364),
    (1, 9, 365), (1, 10, 368), (1, 11, 369),
    # r2 — M8/M7 transition under crown
    (2, 7, 356), (2, 8, 351), (2, 9, 350), (2, 10, 349), (2, 11, 348),
    (2, 12, 421), (2, 13, 323), (2, 14, 322), (2, 15, 321), (2, 16, 320), (2, 17, 319),
    # r3 — first full cross row
    (3, 4, 375), (3, 5, 372), (3, 6, 354), (3, 7, 355),
    (3, 8, 347), (3, 9, 344), (3, 10, 343), (3, 11, 342),
    (3, 12, 341), (3, 13, 340), (3, 14, 316), (3, 15, 315),
    (3, 16, 318), (3, 17, 317),
    (3, 18, 291), (3, 19, 290), (3, 20, 287), (3, 21, 285), (3, 22, 284),
    # r4 — M9 entry + M8 mid + M7 upper
    (4, 0, 379), (4, 1, 378), (4, 2, 377), (4, 3, 376),
    (4, 4, 374), (4, 5, 373), (4, 6, 353), (4, 7, 352),
    (4, 8, 346), (4, 9, 345), (4, 10, 336), (4, 11, 337),
    (4, 12, 338), (4, 13, 339), (4, 14, 314), (4, 15, 313),
    (4, 16, 311), (4, 17, 310), (4, 18, 309), (4, 19, 308),
    (4, 20, 288), (4, 21, 286), (4, 22, 283), (4, 23, 282),
    # r5 — split inserts under 313 / 288
    (5, 15, 312), (5, 20, 289),
    # r6 — M9/M8/M7 mid belt
    (6, 0, 382), (6, 1, 381), (6, 2, 380),
    (6, 3, 398), (6, 4, 399), (6, 5, 400), (6, 6, 401), (6, 7, 402), (6, 8, 403),
    (6, 9, 332), (6, 10, 333), (6, 11, 334), (6, 12, 335),
    (6, 13, 326), (6, 14, 325), (6, 15, 307), (6, 16, 306),
    (6, 17, 305), (6, 18, 304), (6, 19, 295), (6, 20, 294),
    (6, 21, 293), (6, 22, 292), (6, 23, 281), (6, 24, 280),
    # r7 — split under 325
    (7, 14, 422),
    # r8 — M9 lower + M8 lower + M7 lower
    (8, 0, 383), (8, 1, 384), (8, 2, 385),
    (8, 3, 395), (8, 4, 396), (8, 5, 397),
    (8, 6, 406), (8, 7, 405), (8, 8, 404),
    (8, 9, 331), (8, 10, 330), (8, 11, 329), (8, 12, 328),
    (8, 13, "328b"), (8, 14, 324),
    (8, 15, 303), (8, 16, 302), (8, 17, 301), (8, 18, 300),
    (8, 19, 299), (8, 20, 298), (8, 21, 297), (8, 22, 296),
    # r9 — split under 328b
    (9, 13, 327),
    # r10 — M9 south + M6 north strip
    (10, 0, 388), (10, 1, 387), (10, 2, 386),
    (10, 3, 394), (10, 4, 393),
    (10, 5, 410), (10, 6, 409), (10, 7, 408), (10, 8, 407),
    (10, 9, 274), (10, 10, 271), (10, 11, 270), (10, 12, 269),
    (10, 13, 262), (10, 14, 261), (10, 15, 260), (10, 16, 259), (10, 17, 258),
    (10, 18, 229), (10, 19, 228), (10, 20, 227), (10, 21, 226), (10, 22, 225),
    # r11 — M9 bottom + M6 south
    (11, 1, 389), (11, 2, 390), (11, 3, 391), (11, 4, 392),
    (11, 5, 415), (11, 6, 414), (11, 7, 412), (11, 8, 411),
    (11, 9, 273), (11, 10, 272), (11, 11, 268), (11, 12, 267),
    (11, 13, 266), (11, 14, 263),
    (11, 15, 257), (11, 16, 256), (11, 17, 255), (11, 18, 254),
    # r12 — 416/413 hanging under 415/414
    (12, 5, 416), (12, 6, 413),
    # r13 — LAS TUNAS (M9 T10)
    (13, 2, 420), (13, 3, 419), (13, 4, 418), (13, 5, 417),
    # r15–18 — isolated M10 (gap from main body; cols start ~20)
    (15, 20, 198), (15, 21, 199), (15, 22, 200), (15, 23, 203), (15, 24, 204), (15, 25, 205),
    (16, 20, 216), (16, 21, 215), (16, 22, 201), (16, 23, 202), (16, 24, 207), (16, 25, 206),
    (17, 18, 223), (17, 19, 224), (17, 20, 214), (17, 21, 213),
    (17, 22, 212), (17, 23, 211), (17, 24, 209), (17, 25, "208 B"),
    (18, 24, 210), (18, 25, "208 A"),
]

lots = []
seen = set()
missing_master = []
for r, c, lote in GRID:
    try:
        m = lookup(lote)
    except KeyError:
        missing_master.append(lote)
        continue
    key = (m["cod"], r, c)
    if key in seen:
        continue
    seen.add(key)
    lote_out = m["lote"]
    # normalize 328b display
    if str(lote_out).lower().replace(" ", "") == "328b":
        lote_out = "328b"
    lots.append(
        {
            "r": r,
            "c": c,
            "tunel": m["tunel"],
            "lote": lote_out,
            "ha": m["ha"],
            "modulo": m["modulo"],
        }
    )

# Validate coverage vs master
placed_codes = set()
placed_lotes = []
for item in lots:
    # find cod
    m = lookup(item["lote"])
    placed_codes.add(m["cod"])
    placed_lotes.append(item["lote"])

master_codes = {d["cod"] for d in master}
missing = sorted(master_codes - placed_codes)
extra = sorted(placed_codes - master_codes)

# duplicate lot positions?
pos = [(x["r"], x["c"]) for x in lots]
dup_pos = [p for p, n in Counter(pos).items() if n > 1]

notes = (
    "Licapa II / Etapa 2 geographic layout extracted from map image. "
    "r=0 is the topmost M8 crown; c=0 is the leftmost M9 column (Lt.379). "
    "Empty (r,c) cells are omitted. Sparse rows 5/7/9 hold vertically stacked "
    "split lots (312 under 313, 289 under 288, 422 under 325, 327 under 328b). "
    "M10 is the isolated bottom-right block (rows 15–18) with a column gap from the main body. "
    "tunel/ha/modulo taken from data-etapa2-master.json; (r,c) from map geometry. "
    "Las Tunas = M9 T10 lots 417–420. MAGICA highlight on M10 near 215/216."
)
if missing:
    notes += f" Missing from layout vs master ({len(missing)}): {missing}."
if missing_master:
    notes += f" Grid keys not found in master: {missing_master}."
if dup_pos:
    notes += f" Duplicate positions: {dup_pos}."

payload = {
    "lots": lots,
    "notes": notes,
}

OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

rs = [x["r"] for x in lots]
cs = [x["c"] for x in lots]
print("wrote", OUT)
print("count", len(lots))
print("r range", min(rs), max(rs))
print("c range", min(cs), max(cs))
print("per modulo", dict(sorted(Counter(x["modulo"] for x in lots).items())))
print("master total", len(master), "placed", len(placed_codes), "missing", missing)
print("dup positions", dup_pos)
