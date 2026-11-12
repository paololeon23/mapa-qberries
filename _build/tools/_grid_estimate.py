"""Estimate regular-ish grid from colored borders via Hough lines + projection."""
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
hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)

# Keep saturated colored borders (green/blue/purple/orange/pink), drop gray text-ish
sat = hsv[:, :, 1]
val = hsv[:, :, 2]
mask = ((sat > 40) & (val > 40) & (val < 230)).astype(np.uint8) * 255
# also include dark lines
gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
dark = ((gray < 90) & (sat < 80)).astype(np.uint8) * 255
mask = cv2.bitwise_or(mask, dark)

mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((2, 2), np.uint8), iterations=1)
cv2.imwrite(str(OUT / "_bordermask.png"), mask)

# Projection profiles to find grid lines
# Restrict to main map area (exclude legend bottom)
roi = mask[10:580, 40:980]
rh, rw = roi.shape

# Vertical projection: sum over rows
vproj = roi.sum(axis=0).astype(float)
hproj = roi.sum(axis=1).astype(float)

# Smooth
def smooth(a, k=7):
    ker = np.ones(k) / k
    return np.convolve(a, ker, mode="same")

vproj_s = smooth(vproj, 5)
hproj_s = smooth(hproj, 5)

# Find peaks (grid lines)
def find_peaks(a, min_dist=18, thr_frac=0.35):
    thr = a.max() * thr_frac
    peaks = []
    for i in range(1, len(a) - 1):
        if a[i] >= thr and a[i] >= a[i - 1] and a[i] >= a[i + 1]:
            if not peaks or i - peaks[-1] >= min_dist:
                peaks.append(i)
            elif a[i] > a[peaks[-1]]:
                peaks[-1] = i
    return peaks

v_lines = [p + 40 for p in find_peaks(vproj_s, min_dist=16, thr_frac=0.25)]
h_lines = [p + 10 for p in find_peaks(hproj_s, min_dist=14, thr_frac=0.25)]
print("v_lines", len(v_lines), v_lines[:30])
print("h_lines", len(h_lines), h_lines)

# Build cells between consecutive lines; keep only "content" cells with dark pixels (text)
pil = Image.open(IMG)
cells = []
idx = 0
for ri in range(len(h_lines) - 1):
    y0, y1 = h_lines[ri], h_lines[ri + 1]
    if y1 - y0 < 16 or y1 - y0 > 55:
        continue
    for ci in range(len(v_lines) - 1):
        x0, x1 = v_lines[ci], v_lines[ci + 1]
        if x1 - x0 < 16 or x1 - x0 > 55:
            continue
        # check text density
        patch = gray[y0 + 2 : y1 - 2, x0 + 2 : x1 - 2]
        if patch.size == 0:
            continue
        dark_frac = (patch < 100).mean()
        # white-ish background
        bright_frac = (patch > 200).mean()
        if dark_frac < 0.02 or bright_frac < 0.3:
            continue
        cells.append({"r_line": ri, "c_line": ci, "x0": x0, "y0": y0, "x1": x1, "y1": y1})

print("candidate cells", len(cells))

# Remap to compact r,c based on unique line indices used
used_r = sorted({c["r_line"] for c in cells})
used_c = sorted({c["c_line"] for c in cells})
r_map = {v: i for i, v in enumerate(used_r)}
c_map = {v: i for i, v in enumerate(used_c)}

meta = []
vis = bgr.copy()
for c in cells:
    r = r_map[c["r_line"]]
    col = c_map[c["c_line"]]
    x0, y0, x1, y1 = c["x0"], c["y0"], c["x1"], c["y1"]
    cv2.rectangle(vis, (x0, y0), (x1, y1), (0, 0, 255), 1)
    crop = pil.crop((x0, y0, x1, y1)).resize(
        ((x1 - x0) * 6, (y1 - y0) * 6), Image.Resampling.LANCZOS
    )
    name = f"g_r{r:02d}_c{col:02d}.png"
    crop.save(OUT / name)
    meta.append(
        {
            "file": name,
            "r": r,
            "c": col,
            "box": [x0, y0, x1, y1],
            "cx": (x0 + x1) / 2,
            "cy": (y0 + y1) / 2,
        }
    )

cv2.imwrite(str(OUT / "_grid_overview.png"), vis)
(OUT / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
print("wrote", len(meta))
from collections import defaultdict

occ = defaultdict(list)
for m in meta:
    occ[m["r"]].append(m["c"])
for r in sorted(occ):
    print(f"r={r}: {sorted(occ[r])}")
