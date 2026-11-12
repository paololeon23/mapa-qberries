"""Detect lot cell rectangles via contour/grid heuristics and export per-cell crops."""
from pathlib import Path
import json
import cv2
import numpy as np
from PIL import Image

IMG = Path(
    r"C:\Users\CRISTOPHERPAOLOLEONA\.cursor\projects\c-Users-CRISTOPHERPAOLOLEONA-Desktop-mapa\assets\image-2848e357-00ab-47eb-afdb-f2d9109479e2.png"
)
OUT = Path(r"C:\Users\CRISTOPHERPAOLOLEONA\Desktop\mapa\assets\crops\cells")
OUT.mkdir(parents=True, exist_ok=True)

bgr = cv2.imread(str(IMG))
h, w = bgr.shape[:2]
print("size", w, h)

# Upscale for detection
scale = 2
big = cv2.resize(bgr, (w * scale, h * scale), interpolation=cv2.INTER_CUBIC)
gray = cv2.cvtColor(big, cv2.COLOR_BGR2GRAY)
# Invert-ish: cells are white with dark text and thin colored borders
blur = cv2.GaussianBlur(gray, (3, 3), 0)
edges = cv2.Canny(blur, 40, 120)

# Morph to close cell borders
kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
edges = cv2.dilate(edges, kernel, iterations=1)
edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)

contours, _ = cv2.findContours(edges, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)

# Expected cell size in original coords ~ 28-40 wide, ~24-36 tall
cells = []
for cnt in contours:
    x, y, cw, ch = cv2.boundingRect(cnt)
    # convert to original coords
    x0, y0, cw0, ch0 = x / scale, y / scale, cw / scale, ch / scale
    area = cw0 * ch0
    ar = cw0 / max(ch0, 1)
    if 400 < area < 2200 and 0.55 < ar < 2.2 and 18 < cw0 < 55 and 16 < ch0 < 50:
        cells.append({"x": x0, "y": y0, "w": cw0, "h": ch0, "cx": x0 + cw0 / 2, "cy": y0 + ch0 / 2})

# NMS: remove nested/overlapping duplicates
cells.sort(key=lambda c: c["w"] * c["h"])
kept = []
for c in cells:
    ok = True
    for k in kept:
        # IoU-ish
        ix0 = max(c["x"], k["x"])
        iy0 = max(c["y"], k["y"])
        ix1 = min(c["x"] + c["w"], k["x"] + k["w"])
        iy1 = min(c["y"] + c["h"], k["y"] + k["h"])
        iw = max(0, ix1 - ix0)
        ih = max(0, iy1 - iy0)
        inter = iw * ih
        if inter / min(c["w"] * c["h"], k["w"] * k["h"]) > 0.5:
            ok = False
            break
    if ok:
        kept.append(c)

print("raw cells", len(cells), "kept", len(kept))

# Cluster into rows by cy
kept.sort(key=lambda c: (c["cy"], c["cx"]))
rows = []
for c in kept:
    if not rows or abs(c["cy"] - rows[-1][0]["cy"]) > 12:
        rows.append([c])
    else:
        rows[-1].append(c)

# Assign discrete r,c
# First assign row indices
row_ys = [sum(c["cy"] for c in row) / len(row) for row in rows]
# Merge rows that are too close
merged = []
for row, y in zip(rows, row_ys):
    if merged and abs(y - merged[-1][1]) < 14:
        merged[-1][0].extend(row)
        merged[-1][1] = sum(c["cy"] for c in merged[-1][0]) / len(merged[-1][0])
    else:
        merged.append([row, y])

# Column clustering globally
all_cx = sorted(c["cx"] for c in kept)
# greedy column centers
col_centers = []
for cx in all_cx:
    if not col_centers or abs(cx - col_centers[-1]) > 16:
        col_centers.append(cx)
    else:
        col_centers[-1] = (col_centers[-1] + cx) / 2

print("rows", len(merged), "cols", len(col_centers))

assignments = []
for ri, (row, y) in enumerate(merged):
    row.sort(key=lambda c: c["cx"])
    for c in row:
        # nearest col
        ci = min(range(len(col_centers)), key=lambda i: abs(col_centers[i] - c["cx"]))
        assignments.append({**c, "r": ri, "c": ci})

# Save overview annotated
vis = bgr.copy()
for a in assignments:
    x, y, ww, hh = int(a["x"]), int(a["y"]), int(a["w"]), int(a["h"])
    cv2.rectangle(vis, (x, y), (x + ww, y + hh), (0, 0, 255), 1)
    cv2.putText(vis, f"{a['r']},{a['c']}", (x, y - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.3, (255, 0, 0), 1)
cv2.imwrite(str(OUT / "_overview.png"), vis)

# Save each cell crop upscaled
meta = []
pil = Image.open(IMG)
for i, a in enumerate(assignments):
    pad = 1
    box = (
        max(0, int(a["x"] - pad)),
        max(0, int(a["y"] - pad)),
        min(w, int(a["x"] + a["w"] + pad)),
        min(h, int(a["y"] + a["h"] + pad)),
    )
    crop = pil.crop(box).resize(
        ((box[2] - box[0]) * 6, (box[3] - box[1]) * 6), Image.Resampling.LANCZOS
    )
    name = f"cell_r{a['r']:02d}_c{a['c']:02d}_{i:03d}.png"
    crop.save(OUT / name)
    meta.append({"file": name, "r": a["r"], "c": a["c"], "cx": a["cx"], "cy": a["cy"], "box": box})

(OUT / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
print("wrote", len(meta), "cells")
# print row occupancy
from collections import defaultdict
occ = defaultdict(list)
for m in meta:
    occ[m["r"]].append(m["c"])
for r in sorted(occ):
    print(f"r={r}: cols {sorted(occ[r])} count={len(occ[r])}")
