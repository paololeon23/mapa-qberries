"""Crop horizontal strips + key regions at high zoom for manual reading."""
from pathlib import Path
from PIL import Image

IMG = Path(
    r"C:\Users\CRISTOPHERPAOLOLEONA\.cursor\projects\c-Users-CRISTOPHERPAOLOLEONA-Desktop-mapa\assets\image-2848e357-00ab-47eb-afdb-f2d9109479e2.png"
)
OUT = Path(r"C:\Users\CRISTOPHERPAOLOLEONA\Desktop\mapa\assets\crops")
OUT.mkdir(exist_ok=True)

img = Image.open(IMG)
w, h = img.size
print(w, h)

# Approximate row bands based on visual inspection of full map (~18 logical rows)
# Top of lots ~25, bottom of main ~560, M10 starts ~520
# Cell height roughly ~28-32 px looking at 709 height / ~20 rows

# More precise: crop overlapping horizontal strips every ~28px from y=20 to y=580
band_h = 36
step = 28
scale = 4
idx = 0
for y0 in range(20, 590, step):
    y1 = min(h, y0 + band_h)
    crop = img.crop((0, y0, w, y1))
    crop = crop.resize((crop.width * scale, crop.height * scale), Image.Resampling.LANCZOS)
    path = OUT / f"rowband_{idx:02d}_y{y0}.png"
    crop.save(path)
    print(path.name, crop.size)
    idx += 1

# Also left / center / right thirds of full map upscaled
for name, box in [
    ("left", (0, 0, 420, h)),
    ("mid", (300, 0, 720, h)),
    ("right", (600, 0, w, h)),
    ("m10", (700, 480, w, h)),
    ("bottom", (0, 420, 750, 620)),
    ("top", (150, 0, 700, 200)),
]:
    crop = img.crop(box)
    crop = crop.resize((crop.width * 3, crop.height * 3), Image.Resampling.LANCZOS)
    path = OUT / f"region_{name}.png"
    crop.save(path)
    print("region", path.name, crop.size)
