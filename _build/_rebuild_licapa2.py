# -*- coding: utf-8 -*-
import json
from pathlib import Path
from collections import Counter

ROOT = Path(r"c:\Users\CRISTOPHERPAOLOLEONA\Desktop\mapa")
master = json.loads((ROOT / "data-etapa2-master.json").read_text(encoding="utf-8"))
mby = {}
for x in master:
    k = str(x["lote"]).upper().replace(" ", "")
    mby[k] = x


def L(lote, r, c, modulo):
    key = str(lote).upper().replace(" ", "")
    src = mby.get(key)
    if not src:
        for alt in (key.replace("B", " B").replace("A", " A"), key):
            src = mby.get(alt)
            if src:
                break
    if not src:
        raise SystemExit("missing master " + str(lote))
    return {
        "r": r,
        "c": c,
        "tunel": str(src["tunel"]).upper(),
        "lote": src["lote"],
        "ha": round(float(src["ha"]), 2),
        "modulo": modulo,
    }


lots = []

# --- M8 GREEN (corona +1 col; 356 fijo sobre 355) ---
lots += [
    L(358, 0, 6, 8), L(359, 0, 7, 8), L(362, 0, 8, 8), L(363, 0, 9, 8),
    L(366, 0, 10, 8), L(367, 0, 11, 8), L(370, 0, 12, 8), L(371, 0, 13, 8),
    L(357, 1, 6, 8), L(360, 1, 7, 8), L(361, 1, 8, 8), L(364, 1, 9, 8),
    L(365, 1, 10, 8), L(368, 1, 11, 8), L(369, 1, 12, 8),
    L(356, 2, 8, 8), L(351, 2, 9, 8), L(350, 2, 10, 8), L(349, 2, 11, 8), L(348, 2, 12, 8),
    L(354, 3, 7, 8), L(355, 3, 8, 8), L(347, 3, 9, 8), L(344, 3, 10, 8),
    L(343, 3, 11, 8), L(342, 3, 12, 8),
    L(353, 4, 7, 8), L(352, 4, 8, 8), L(346, 4, 9, 8), L(345, 4, 10, 8),
    L(336, 4, 11, 8), L(337, 4, 12, 8),
    L(402, 6, 7, 8), L(403, 6, 8, 8), L(332, 6, 9, 8), L(333, 6, 10, 8),
    L(334, 6, 11, 8), L(335, 6, 12, 8),
    L(331, 8, 9, 8), L(330, 8, 10, 8), L(329, 8, 11, 8), L(328, 8, 12, 8),
]

# --- M7 PURPLE (image 1) ---
lots += [
    L(421, 2, 13, 7), L(323, 2, 14, 7), L(322, 2, 15, 7), L(321, 2, 16, 7),
    L(320, 2, 17, 7), L(319, 2, 18, 7),
    L(341, 3, 13, 7), L(340, 3, 14, 7), L(316, 3, 15, 7), L(315, 3, 16, 7),
    L(318, 3, 17, 7), L(317, 3, 18, 7), L(291, 3, 19, 7), L(290, 3, 20, 7),
    L(287, 3, 21, 7), L(285, 3, 22, 7), L(284, 3, 23, 7),
    L(338, 4, 13, 7), L(339, 4, 14, 7), L(314, 4, 15, 7), L(313, 4, 16, 7),
    L(311, 4, 17, 7), L(310, 4, 18, 7), L(309, 4, 19, 7), L(308, 4, 20, 7),
    L(288, 4, 21, 7), L(286, 4, 22, 7), L(283, 4, 23, 7), L(282, 4, 24, 7),
    L(312, 5, 15, 7), L(289, 5, 20, 7),
    L(326, 6, 13, 7), L(325, 6, 14, 7), L(307, 6, 15, 7), L(306, 6, 16, 7),
    L(305, 6, 17, 7), L(304, 6, 18, 7), L(295, 6, 19, 7), L(294, 6, 20, 7),
    L(293, 6, 21, 7), L(292, 6, 22, 7), L(281, 6, 23, 7), L(280, 6, 24, 7),
    L(422, 7, 14, 7),
    L("328b", 8, 13, 7), L(324, 8, 14, 7), L(303, 8, 15, 7), L(302, 8, 16, 7),
    L(301, 8, 17, 7), L(300, 8, 18, 7), L(299, 8, 19, 7), L(298, 8, 20, 7),
    L(297, 8, 21, 7), L(296, 8, 22, 7),
    L(327, 9, 13, 7),
]

# --- M9 BLUE + LAS TUNAS (image 4) ---
lots += [
    # 375 sobre 374; 372 sobre 373; vacío sobre 376
    L(375, 3, 5, 9), L(372, 3, 6, 9),
    L(379, 4, 1, 9), L(378, 4, 2, 9), L(377, 4, 3, 9), L(376, 4, 4, 9),
    L(374, 4, 5, 9), L(373, 4, 6, 9),
    L(382, 6, 0, 9), L(381, 6, 1, 9), L(380, 6, 2, 9), L(398, 6, 3, 9),
    L(399, 6, 4, 9), L(400, 6, 5, 9), L(401, 6, 6, 9),
    L(383, 8, 0, 9), L(384, 8, 1, 9), L(385, 8, 2, 9), L(395, 8, 3, 9),
    L(396, 8, 4, 9), L(397, 8, 5, 9), L(406, 8, 6, 9), L(405, 8, 7, 9), L(404, 8, 8, 9),
    L(388, 10, 0, 9), L(387, 10, 1, 9), L(386, 10, 2, 9), L(394, 10, 3, 9),
    L(393, 10, 4, 9), L(410, 10, 5, 9), L(409, 10, 6, 9), L(408, 10, 7, 9), L(407, 10, 8, 9),
    L(389, 11, 1, 9), L(390, 11, 2, 9), L(391, 11, 3, 9), L(392, 11, 4, 9),
    L(415, 11, 5, 9), L(414, 11, 6, 9), L(412, 11, 7, 9), L(411, 11, 8, 9),
    L(416, 12, 5, 9), L(413, 12, 6, 9),
    L(420, 13, 2, 9), L(419, 13, 3, 9), L(418, 13, 4, 9), L(417, 13, 5, 9),
]

# --- M6 RED (image 2) ---
lots += [
    L(274, 10, 9, 6), L(271, 10, 10, 6), L(270, 10, 11, 6), L(269, 10, 12, 6),
    L(262, 10, 13, 6), L(261, 10, 14, 6), L(260, 10, 15, 6), L(259, 10, 16, 6),
    L(258, 10, 17, 6), L(229, 10, 18, 6), L(228, 10, 19, 6), L(227, 10, 20, 6),
    L(226, 10, 21, 6), L(225, 10, 22, 6),
    L(273, 11, 9, 6), L(272, 11, 10, 6), L(268, 11, 11, 6), L(267, 11, 12, 6),
    L(266, 11, 13, 6), L(263, 11, 14, 6), L(257, 11, 15, 6), L(256, 11, 16, 6),
    L(255, 11, 17, 6), L(254, 11, 18, 6),
]

# --- M10: bloque completo +2 cols a la derecha ---
for r, c, lote in [
    (11, 23, 198), (11, 24, 199), (11, 25, 200),
    (11, 26, 203), (11, 27, 204), (11, 28, 205),
    (12, 21, 216), (12, 22, 215), (12, 23, 201), (12, 24, 202), (12, 25, 207), (12, 26, 206),
    (13, 19, 223), (13, 20, 224), (13, 21, 214), (13, 22, 213), (13, 23, 212), (13, 24, 211), (13, 25, 209), (13, 26, "208 B"),
    (14, 25, 210), (14, 26, "208 A"),
]:
    lots.append(L(lote, r, c, 10))

# dup positions
pos = {}
dups = []
for l in lots:
    k = (l["r"], l["c"])
    if k in pos:
        dups.append((k, pos[k], l["lote"]))
    pos[k] = l["lote"]
print("dups", dups)

have = {str(l["lote"]).upper().replace(" ", "") for l in lots}
allm = {str(x["lote"]).upper().replace(" ", "") for x in master}
miss = sorted(allm - have)
print("n", len(lots), "missing", miss)
print("by mod", Counter(l["modulo"] for l in lots))

# place any missing on spare row 14
c_spare = 0
for key in miss:
    src = mby[key]
    mid = src["modulo"]
    if isinstance(mid, str) and mid.upper().startswith("M"):
        mid = int(mid[1:])
    lots.append({
        "r": 14, "c": c_spare,
        "tunel": str(src["tunel"]).upper(),
        "lote": src["lote"],
        "ha": round(float(src["ha"]), 2),
        "modulo": int(mid),
    })
    c_spare += 1

MOD_STYLE = {
    6: {"fill": "#FFCCBC", "badge": "#E64A19", "name": "Modulo 06"},
    7: {"fill": "#D1C4E9", "badge": "#5E35B1", "name": "Modulo 07"},
    8: {"fill": "#C8E6C9", "badge": "#2E7D32", "name": "Modulo 08"},
    9: {"fill": "#B2DFDB", "badge": "#00695C", "name": "Modulo 09"},
    10: {"fill": "#F8BBD0", "badge": "#C2185B", "name": "Modulo 10"},
}
modules = []
badges = []
for mid in sorted({l["modulo"] for l in lots}):
    sub = [l for l in lots if l["modulo"] == mid]
    st = MOD_STYLE[mid]
    modules.append({
        "id": mid, "label": "M" + str(mid), "name": st["name"],
        "ha": round(sum(l["ha"] for l in sub), 2),
        "fill": st["fill"], "badge": st["badge"],
    })
    rs = sorted(l["r"] for l in sub)
    cs = sorted(l["c"] for l in sub)
    badges.append({"id": mid, "r": rs[len(rs) // 2], "c": cs[len(cs) // 2]})

labels = [
    {"text": "LAS TUNAS", "kind": "zone", "r": 13, "cStart": 2, "cEnd": 5, "anchor": "top"},
    {"text": "MAGICA", "kind": "variety", "r": 12, "cStart": 21, "cEnd": 22, "anchor": "top"},
    {"text": "M06", "kind": "module", "r": 10, "cStart": 14, "cEnd": 15, "anchor": "center", "color": "#0f2744"},
    {"text": "M07", "kind": "module", "r": 6, "cStart": 19, "cEnd": 20, "anchor": "center", "color": "#0f2744"},
    {"text": "M08", "kind": "module", "r": 4, "cStart": 10, "cEnd": 11, "anchor": "center", "color": "#0f2744"},
    {"text": "M09", "kind": "module", "r": 8, "cStart": 4, "cEnd": 5, "anchor": "center", "color": "#0f2744"},
    {"text": "M10", "kind": "module", "r": 12, "cStart": 24, "cEnd": 25, "anchor": "center", "color": "#0f2744"},
]

payload = {
    "title": "PLANO DE COSECHA ETAPA II",
    "brand": "Q Berries",
    "fundo": "LICAPA II",
    "etapa": "II",
    "totalHa": round(sum(l["ha"] for l in lots), 2),
    "modules": modules,
    "badges": badges,
    "labels": labels,
    "lots": lots,
}
(ROOT / "data-licapa2.js").write_text(
    "window.MAP_DATA_LICAPA2 = " + json.dumps(payload, ensure_ascii=False) + "\n",
    encoding="utf-8",
)
(ROOT / "data-licapa2-layout.json").write_text(
    json.dumps({"lots": lots, "labels": labels}, ensure_ascii=False, indent=2),
    encoding="utf-8",
)

by = {(l["r"], l["c"]): l for l in lots}
ch = {6: "6", 7: "7", 8: "8", 9: "9", 10: "A"}
print("modules", [(m["label"], m["ha"], sum(1 for l in lots if l["modulo"] == m["id"])) for m in modules])
for r in range(min(l["r"] for l in lots), max(l["r"] for l in lots) + 1):
    line = "".join(ch.get(by[(r, c)]["modulo"], ".") if (r, c) in by else "." for c in range(0, 26))
    print(f"{r:02d}", line)
print("done missing_after", miss)
