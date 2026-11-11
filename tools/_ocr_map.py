"""OCR the Licapa II map and dump detections with centers."""
import json
import re
from pathlib import Path

import easyocr
from PIL import Image

IMG = Path(
    r"C:\Users\CRISTOPHERPAOLOLEONA\.cursor\projects\c-Users-CRISTOPHERPAOLOLEONA-Desktop-mapa\assets\image-2848e357-00ab-47eb-afdb-f2d9109479e2.png"
)
OUT = Path(r"C:\Users\CRISTOPHERPAOLOLEONA\Desktop\mapa\assets\crops\ocr_dets.json")

img = Image.open(IMG)
print("size", img.size)
# upscale for better OCR
scale = 3
up = img.resize((img.width * scale, img.height * scale), Image.Resampling.LANCZOS)
up_path = Path(r"C:\Users\CRISTOPHERPAOLOLEONA\Desktop\mapa\assets\crops\full_3x.png")
up.save(up_path)

reader = easyocr.Reader(["en", "es"], gpu=False)
results = reader.readtext(str(up_path), detail=1, paragraph=False)

dets = []
for bbox, text, conf in results:
    xs = [p[0] for p in bbox]
    ys = [p[1] for p in bbox]
    cx = sum(xs) / 4
    cy = sum(ys) / 4
    dets.append(
        {
            "text": text,
            "conf": float(conf),
            "cx": cx / scale,
            "cy": cy / scale,
            "x0": min(xs) / scale,
            "y0": min(ys) / scale,
            "x1": max(xs) / scale,
            "y1": max(ys) / scale,
        }
    )

OUT.write_text(json.dumps(dets, indent=2), encoding="utf-8")
print("detections", len(dets))
# print lot-like and tunnel-like
lot_re = re.compile(r"(?i)l[t\.]?\s*\.?\s*(\d+\s*[abAB]?|\d+[abAB])")
tun_re = re.compile(r"(?i)^t\s*(\d+)$")
ha_re = re.compile(r"^\d+[.,]\d+$")
for d in sorted(dets, key=lambda x: (x["cy"], x["cx"])):
    t = d["text"].strip()
    if lot_re.search(t) or tun_re.match(t) or ha_re.match(t.replace(",", ".")) or "M" in t.upper():
        print(f"{d['cy']:7.1f} {d['cx']:7.1f} {d['conf']:.2f} | {t}")
