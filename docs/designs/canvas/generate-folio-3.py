"""
Ledger Illumination (1×3) — BESTCHOICE Finance Chromatic Index
A landscape specimen plate cataloguing the three pigments of the
current 1×3 rich menu — the distilled customer journey.

Canvas: 2400 × 1400 (landscape folio).
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# ─── Canvas ─────────────────────────────────────────────
W, H = 2400, 1400

# ─── Palette ────────────────────────────────────────────
FIELD = (250, 246, 234)       # warm ivory paper
RULE = (236, 228, 210)        # ledger rule — breathier
HAIRLINE = (194, 180, 148)    # plate border — aged bone
INK = (28, 36, 28)            # monastic ink
WHISPER = (140, 130, 110)     # marginalia grey
GOLD = (168, 118, 39)         # ceremonial hairline

# Three pigments — matching the 1×3 rich-menu chambers
PIGMENTS = [
    {"wash": (204, 207, 226), "accent": ( 63,  60, 140), "thai": "ชวนเพื่อน",   "code": "MONASTIC INDIGO",   "rgb": "204·207·226"},
    {"wash": (196, 224, 200), "accent": (  4, 120,  87), "thai": "ชำระค่างวด",  "code": "CEREMONIAL JADE",   "rgb": "196·224·200", "hero": True},
    {"wash": (192, 217, 220), "accent": ( 23,  96, 111), "thai": "ติดต่อเรา",   "code": "SUKHOTHAI CELADON", "rgb": "192·217·220"},
]

# ─── Fonts ──────────────────────────────────────────────
SKILL_FONTS = Path(".claude/skills/canvas-design/canvas-fonts").resolve()
RICH_MENU_FONTS = Path(__file__).parent.parent / "rich-menu"

F_TITLE = ImageFont.truetype(str(RICH_MENU_FONTS / "IBMPlexSansThai-SemiBold.ttf"), 64)
F_THAI_PLATE = ImageFont.truetype(str(RICH_MENU_FONTS / "IBMPlexSansThai-Medium.ttf"), 42)
F_MONO_S = ImageFont.truetype(str(SKILL_FONTS / "IBMPlexMono-Regular.ttf"), 18)
F_MONO_XS = ImageFont.truetype(str(SKILL_FONTS / "IBMPlexMono-Regular.ttf"), 14)
F_MONO_MD = ImageFont.truetype(str(SKILL_FONTS / "IBMPlexMono-Regular.ttf"), 22)

# ─── Canvas init ────────────────────────────────────────
img = Image.new("RGB", (W, H), FIELD)
draw = ImageDraw.Draw(img, "RGBA")


def text_centered(xy, text, font, fill):
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    x, y = xy
    draw.text((x - tw // 2, y - bbox[1]), text, fill=fill, font=font)


def text_width(text, font):
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0]


# ═════════════════════════════════════════════════════════
# 1. LEDGER RULES — every 36px across the full sheet
# ═════════════════════════════════════════════════════════
RULE_GAP = 36
for y in range(140, H - 140, RULE_GAP):
    draw.line([(0, y), (W, y)], fill=RULE, width=1)


# ═════════════════════════════════════════════════════════
# 2. HEADER — title + plate mark
# ═════════════════════════════════════════════════════════
HEADER_TOP = 150

eyebrow = "P L A T E   I I   ·   C H R O M A T I C   I N D E X   ·   1 × 3"
text_centered((W // 2, HEADER_TOP), eyebrow, F_MONO_S, WHISPER)

title = "เครื่องสีแห่งสัญญา"
title_cy = HEADER_TOP + 82
text_centered((W // 2, title_cy), title, F_TITLE, INK)

y_rule = title_cy + 86
draw.line(
    [(W // 2 - 68, y_rule), (W // 2 + 68, y_rule)],
    fill=GOLD,
    width=2,
)

subtitle = "a specimen catalogue of three pigments"
text_centered((W // 2, y_rule + 34), subtitle, F_MONO_S, WHISPER)


# ═════════════════════════════════════════════════════════
# 3. SPECIMEN ROW — three tiles in a single measured line
# ═════════════════════════════════════════════════════════
GRID_TOP = 510
GRID_LEFT = 140
GRID_RIGHT = W - 140
GRID_WIDTH = GRID_RIGHT - GRID_LEFT      # 2120
COL_GAP = 80
COLS = 3
TILE_W = (GRID_WIDTH - COL_GAP * (COLS - 1)) // COLS  # 653
TILE_H = 620


def draw_specimen(col: int, p: dict):
    x0 = GRID_LEFT + col * (TILE_W + COL_GAP)
    y0 = GRID_TOP
    x1 = x0 + TILE_W
    y1 = y0 + TILE_H

    # Wash fill
    draw.rectangle([x0, y0, x1, y1], fill=p["wash"])

    # Inner hairline border
    inset = 16
    draw.rectangle(
        [x0 + inset, y0 + inset, x1 - inset, y1 - inset],
        outline=HAIRLINE,
        width=1,
    )

    # ─── Icon — 12-tick radial wheel (installment cadence) ─
    icon_cx = x0 + TILE_W // 2
    icon_cy = y0 + 160
    accent = p["accent"]
    r = 62
    draw.ellipse(
        [icon_cx - r, icon_cy - r, icon_cx + r, icon_cy + r],
        outline=accent,
        width=3,
    )
    for i in range(12):
        ang = math.radians(i * 30 - 90)
        inner = r + 12
        outer = r + 26 if i % 3 == 0 else r + 20
        x_a = icon_cx + inner * math.cos(ang)
        y_a = icon_cy + inner * math.sin(ang)
        x_b = icon_cx + outer * math.cos(ang)
        y_b = icon_cy + outer * math.sin(ang)
        draw.line([(x_a, y_a), (x_b, y_b)], fill=accent, width=2)
    draw.ellipse(
        [icon_cx - 4, icon_cy - 4, icon_cx + 4, icon_cy + 4],
        fill=accent,
    )

    # ─── Hairline between icon and name ──────────────────
    sep_y = y0 + 300
    draw.line(
        [(x0 + 160, sep_y), (x1 - 160, sep_y)],
        fill=HAIRLINE,
        width=1,
    )

    # ─── Thai chamber name (center) ──────────────────────
    name_y = y0 + 380
    text_centered((icon_cx, name_y), p["thai"], F_THAI_PLATE, INK)

    # Hero gold underline for the central specimen
    if p.get("hero"):
        name_w = text_width(p["thai"], F_THAI_PLATE)
        underline_y = name_y + 58
        draw.line(
            [(icon_cx - name_w // 2, underline_y),
             (icon_cx + name_w // 2, underline_y)],
            fill=GOLD,
            width=2,
        )

    # ─── Marginalia row ──────────────────────────────────
    draw.text(
        (x0 + inset + 22, y1 - 72),
        p["code"],
        fill=INK,
        font=F_MONO_XS,
    )
    rgb_w = text_width(p["rgb"], F_MONO_XS)
    draw.text(
        (x1 - inset - 22 - rgb_w, y1 - 72),
        p["rgb"],
        fill=WHISPER,
        font=F_MONO_XS,
    )

    # Plate number (top-left)
    plate_no = f"0{col + 1}"
    draw.text(
        (x0 + inset + 22, y0 + inset + 16),
        plate_no,
        fill=WHISPER,
        font=F_MONO_XS,
    )

    # Accent stroke swatch (bottom-left)
    bar_x = x0 + inset + 22
    bar_y = y1 - 42
    draw.line(
        [(bar_x, bar_y), (bar_x + 72, bar_y)],
        fill=accent,
        width=2,
    )


for i, pigment in enumerate(PIGMENTS):
    draw_specimen(i, pigment)


# ═════════════════════════════════════════════════════════
# 4. FOOTER — hallmark + date + seal
# ═════════════════════════════════════════════════════════
FOOTER_Y = GRID_TOP + TILE_H + 140

draw.line([(140, FOOTER_Y), (210, FOOTER_Y)], fill=GOLD, width=2)
draw.text(
    (232, FOOTER_Y - 14),
    "BESTCHOICE  FINANCE",
    fill=INK,
    font=F_MONO_MD,
)
draw.text(
    (232, FOOTER_Y + 14),
    "AN ILLUMINATED LEDGER · BE 2568",
    fill=WHISPER,
    font=F_MONO_XS,
)

ed = "ED. 01 / 01 · 1×3"
ed_w = text_width(ed, F_MONO_MD)
draw.text(
    (W - 140 - ed_w, FOOTER_Y - 14),
    ed,
    fill=INK,
    font=F_MONO_MD,
)
draw.line(
    [(W - 140 - ed_w - 80, FOOTER_Y), (W - 140 - ed_w - 20, FOOTER_Y)],
    fill=GOLD,
    width=2,
)
sig = "VOL. I · FOLIO II"
sig_w = text_width(sig, F_MONO_XS)
draw.text(
    (W - 140 - sig_w, FOOTER_Y + 14),
    sig,
    fill=WHISPER,
    font=F_MONO_XS,
)


# ─── Export ─────────────────────────────────────────────
out = Path(__file__).parent / "bestchoice-chromatic-index-3.png"
img.save(out, "PNG", optimize=True)
print(f"saved {out}  ({W}x{H})")
