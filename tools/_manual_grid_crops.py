"""Crop a dense manual grid of candidate cells for visual reading."""
from pathlib import Path
from PIL import Image

IMG = Path(
    r"C:\Users\CRISTOPHERPAOLOLEONA\.cursor\projects\c-Users-CRISTOPHERPAOLOLEONA-Desktop-mapa\assets\image-2848e357-00ab-47eb-afdb-f2d9109479e2.png"
)
OUT = Path(r"C:\Users\CRISTOPHERPAOLOLEONA\Desktop\mapa\assets\crops\manual")
OUT.mkdir(parents=True, exist_ok=True)

img = Image.open(IMG)
w, h = img.size

# From visual inspection of top crown:
# Top row y ~ 28-58, first cell (358) x ~ 205-238, cell pitch ~ 33-34 px
# Leftmost M9 cells around x ~ 70-100

# Calibrated approximate:
# Columns: start x=72, pitch=33.5 -> ~27 columns
# Rows: start y=28, pitch=31 -> ~18 rows for main; M10 starts y~505

col0_x = 72
pitch_c = 33.4
row0_y = 28
pitch_r = 31.0
cell_w = 32
cell_h = 29

# Save a few verification strips and a labeled overview
overview = img.copy()
from PIL import ImageDraw, ImageFont

draw = ImageDraw.Draw(overview)

meta_rows = []
for r in range(18):
    y = int(row0_y + r * pitch_r)
    row_lots = []
    for c in range(27):
        x = int(col0_x + c * pitch_c)
        if x + cell_w > w or y + cell_h > h:
            continue
        box = (x, y, x + cell_w, y + cell_h)
        crop = img.crop(box).resize((cell_w * 5, cell_h * 5), Image.Resampling.LANCZOS)
        # skip nearly empty (mostly white)
        import statistics

        pix = list(crop.getdata())
        # brightness
        br = sum(p[0] + p[1] + p[2] for p in pix) / (3 * len(pix))
        # variance proxy
        dark = sum(1 for p in pix if p[0] < 90)
        if dark < 80:  # no text
            continue
        name = f"m_r{r:02d}_c{c:02d}.png"
        crop.save(OUT / name)
        row_lots.append(c)
        draw.rectangle(box, outline=(255, 0, 0))
        draw.text((x, y - 8), f"{r},{c}", fill=(0, 0, 255))
    meta_rows.append((r, row_lots))
    print(f"r={r} occupied cols {row_lots}")

overview.save(OUT / "_manual_overview.png")
print("saved overview")

# Also save horizontal row montages for easier reading
for r in range(18):
    y = int(row0_y + r * pitch_r)
    band = img.crop((40, max(0, y - 2), 980, min(h, y + cell_h + 2)))
    band = band.resize((band.width * 3, band.height * 3), Image.Resampling.LANCZOS)
    band.save(OUT / f"montage_r{r:02d}.png")
