"""
Ledger Illumination — BESTCHOICE Finance Chromatic Index
A museum-quality specimen plate cataloguing the six pigments of the
rich-menu Chromatic Shrine, rendered as if lifted from a monastic
ledger compiled by a lifelong accountant-scribe.

Canvas: 1600 × 2200 (portrait folio).
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# ─── Canvas ─────────────────────────────────────────────
W, H = 1600, 2200

# ─── Palette ────────────────────────────────────────────
FIELD = (250, 246, 234)       # warm ivory paper
RULE = (236, 228, 210)        # ledger rule — calm oatmeal, breathier
HAIRLINE = (194, 180, 148)    # plate border — aged bone
INK = (28, 36, 28)            # monastic ink
WHISPER = (140, 130, 110)     # marginalia grey
GOLD = (168, 118, 39)         # ceremonial hairline

# Six pigments — lifted from generate.py (rich-menu). Each entry gives
# (wash, accent). Latin codenames chosen from pigment taxonomy.
PIGMENTS = [
    {"pig": "sand",    "wash": (234, 220, 188), "accent": (166, 118,  45), "thai": "สัญญาของฉัน",   "code": "SIDHOOR WHEAT",    "rgb": "234·220·188"},
    {"pig": "emerald", "wash": (196, 224, 200), "accent": (  4, 120,  87), "thai": "ชำระค่างวด",    "code": "CEREMONIAL JADE",  "rgb": "196·224·200"},
    {"pig": "coral",   "wash": (247, 219, 205), "accent": (195,  92,  56), "thai": "ประวัติชำระ",   "code": "SUNLIT CORAL",     "rgb": "247·219·205"},
    {"pig": "ruby",    "wash": (238, 200, 208), "accent": (161,  50,  75), "thai": "ปิดยอด ๕๐%",    "code": "LUCKY THREAD",     "rgb": "238·200·208"},
    {"pig": "indigo",  "wash": (204, 207, 226), "accent": ( 63,  60, 140), "thai": "ชวนเพื่อน",     "code": "MONASTIC INDIGO",  "rgb": "204·207·226"},
    {"pig": "teal",    "wash": (192, 217, 220), "accent": ( 23,  96, 111), "thai": "ติดต่อเรา",     "code": "SUKHOTHAI CELADON","rgb": "192·217·220"},
]

# ─── Fonts ──────────────────────────────────────────────
SKILL_FONTS = Path(".claude/skills/canvas-design/canvas-fonts").resolve()
RICH_MENU_FONTS = Path(__file__).parent.parent / "rich-menu"

F_TITLE = ImageFont.truetype(str(RICH_MENU_FONTS / "IBMPlexSansThai-SemiBold.ttf"), 52)
F_THAI_SM = ImageFont.truetype(str(RICH_MENU_FONTS / "IBMPlexSansThai-Regular.ttf"), 28)
F_THAI_PLATE = ImageFont.truetype(str(RICH_MENU_FONTS / "IBMPlexSansThai-Medium.ttf"), 34)
F_MONO_S = ImageFont.truetype(str(SKILL_FONTS / "IBMPlexMono-Regular.ttf"), 16)
F_MONO_XS = ImageFont.truetype(str(SKILL_FONTS / "IBMPlexMono-Regular.ttf"), 13)
F_MONO_MD = ImageFont.truetype(str(SKILL_FONTS / "IBMPlexMono-Regular.ttf"), 20)
F_SERIF_NUM = ImageFont.truetype(str(SKILL_FONTS / "IBMPlexSerif-Regular.ttf"), 14)

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
# 1. LEDGER RULES — very subtle, every 36px across full canvas
# ═════════════════════════════════════════════════════════
RULE_GAP = 36
for y in range(160, H - 160, RULE_GAP):
    draw.line([(0, y), (W, y)], fill=RULE, width=1)


# ═════════════════════════════════════════════════════════
# 2. HEADER — title + plate mark
# ═════════════════════════════════════════════════════════
HEADER_TOP = 200

# Whispered eyebrow text (small caps Latin, spaced)
eyebrow = "P L A T E   I   ·   C H R O M A T I C   I N D E X"
text_centered((W // 2, HEADER_TOP), eyebrow, F_MONO_S, WHISPER)

# Primary title — Thai (centered, restrained)
title = "เครื่องสีแห่งสัญญา"
title_cy = HEADER_TOP + 84
text_centered((W // 2, title_cy), title, F_TITLE, INK)

# Gold ceremonial underline, sitting clear of descenders
y_rule = title_cy + 72
draw.line(
    [(W // 2 - 58, y_rule), (W // 2 + 58, y_rule)],
    fill=GOLD,
    width=2,
)

# Subtitle — Latin cataloguing line, whispered monospace
subtitle = "a specimen catalogue of six pigments"
text_centered((W // 2, y_rule + 34), subtitle, F_MONO_S, WHISPER)


# ═════════════════════════════════════════════════════════
# 3. SPECIMEN GRID — 2 columns × 3 rows, each pigment a plate
# ═════════════════════════════════════════════════════════
GRID_TOP = 460
GRID_LEFT = 160
GRID_RIGHT = W - 160
GRID_WIDTH = GRID_RIGHT - GRID_LEFT  # 1280
COL_GAP = 60
COLS = 2
ROWS = 3
TILE_W = (GRID_WIDTH - COL_GAP * (COLS - 1)) // COLS  # 610
TILE_H = 440
ROW_GAP = 40


def draw_specimen(col: int, row: int, p: dict):
    x0 = GRID_LEFT + col * (TILE_W + COL_GAP)
    y0 = GRID_TOP + row * (TILE_H + ROW_GAP)
    x1 = x0 + TILE_W
    y1 = y0 + TILE_H

    # Wash fill
    draw.rectangle([x0, y0, x1, y1], fill=p["wash"])

    # Inner hairline border (2px inset, 1px width)
    inset = 14
    draw.rectangle(
        [x0 + inset, y0 + inset, x1 - inset, y1 - inset],
        outline=HAIRLINE,
        width=1,
    )

    # ─── Icon glyph (top region) ─────────────────────────
    icon_cx = x0 + TILE_W // 2
    icon_cy = y0 + 110
    accent = p["accent"]
    # Single circular rule with 12 radial tick-marks — represents the
    # twelve-installment cycle. A quiet echo of the installment rhythm
    # shared by every chamber, rendered as a master mark on each plate.
    r = 44
    draw.ellipse(
        [icon_cx - r, icon_cy - r, icon_cx + r, icon_cy + r],
        outline=accent,
        width=3,
    )
    import math
    for i in range(12):
        ang = math.radians(i * 30 - 90)
        inner = r + 8
        outer = r + 18 if i % 3 == 0 else r + 14
        x_a = icon_cx + inner * math.cos(ang)
        y_a = icon_cy + inner * math.sin(ang)
        x_b = icon_cx + outer * math.cos(ang)
        y_b = icon_cy + outer * math.sin(ang)
        draw.line([(x_a, y_a), (x_b, y_b)], fill=accent, width=2)
    # Centered dot
    draw.ellipse(
        [icon_cx - 3, icon_cy - 3, icon_cx + 3, icon_cy + 3],
        fill=accent,
    )

    # ─── Hairline between icon and name ──────────────────
    sep_y = y0 + 200
    draw.line(
        [(x0 + 120, sep_y), (x1 - 120, sep_y)],
        fill=HAIRLINE,
        width=1,
    )

    # ─── Thai chamber name (center) ──────────────────────
    text_centered((icon_cx, y0 + 260), p["thai"], F_THAI_PLATE, INK)

    # ─── Marginalia row (code + rgb) ─────────────────────
    # Left: pigment code in small caps mono
    draw.text(
        (x0 + inset + 18, y1 - 60),
        p["code"],
        fill=INK,
        font=F_MONO_XS,
    )
    # Right: RGB triplet in mono
    rgb = p["rgb"]
    rgb_w = text_width(rgb, F_MONO_XS)
    draw.text(
        (x1 - inset - 18 - rgb_w, y1 - 60),
        rgb,
        fill=WHISPER,
        font=F_MONO_XS,
    )

    # ─── Plate number (top-left corner) ──────────────────
    plate_no = f"0{col + row * COLS + 1}"
    draw.text(
        (x0 + inset + 18, y0 + inset + 14),
        plate_no,
        fill=WHISPER,
        font=F_MONO_XS,
    )

    # ─── Stroke swatch (bottom-left) — accent as a single
    # painted brush-mark ────────────────────────────────
    bar_x = x0 + inset + 18
    bar_y = y1 - 34
    draw.line(
        [(bar_x, bar_y), (bar_x + 60, bar_y)],
        fill=accent,
        width=2,
    )


for i, pigment in enumerate(PIGMENTS):
    col = i % COLS
    row = i // COLS
    draw_specimen(col, row, pigment)


# ═════════════════════════════════════════════════════════
# 4. FOOTER — hallmark + date + seal
# ═════════════════════════════════════════════════════════
FOOTER_Y = GRID_TOP + ROWS * TILE_H + (ROWS - 1) * ROW_GAP + 90

# Gold hairline left hallmark
draw.line([(160, FOOTER_Y), (226, FOOTER_Y)], fill=GOLD, width=2)
draw.text(
    (246, FOOTER_Y - 12),
    "BESTCHOICE  FINANCE",
    fill=INK,
    font=F_MONO_MD,
)
draw.text(
    (246, FOOTER_Y + 14),
    "AN ILLUMINATED LEDGER · BE 2568",
    fill=WHISPER,
    font=F_MONO_XS,
)

# Right: edition mark
ed = "ED. 01 / 01"
ed_w = text_width(ed, F_MONO_MD)
draw.text(
    (W - 160 - ed_w, FOOTER_Y - 12),
    ed,
    fill=INK,
    font=F_MONO_MD,
)
# Small gold rule to the left of edition mark
draw.line(
    [(W - 160 - ed_w - 78, FOOTER_Y), (W - 160 - ed_w - 18, FOOTER_Y)],
    fill=GOLD,
    width=2,
)
# Subtitle under edition
sig = "VOL. I · FOLIO I"
sig_w = text_width(sig, F_MONO_XS)
draw.text(
    (W - 160 - sig_w, FOOTER_Y + 14),
    sig,
    fill=WHISPER,
    font=F_MONO_XS,
)


# ─── Export ─────────────────────────────────────────────
out = Path(__file__).parent / "bestchoice-chromatic-index.png"
img.save(out, "PNG", optimize=True)
print(f"saved {out}  ({W}x{H})")
