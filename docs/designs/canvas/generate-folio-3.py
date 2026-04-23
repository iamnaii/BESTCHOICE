"""
Ledger Illumination (1×3) — BESTCHOICE Finance Chromatic Index
A landscape specimen plate cataloguing the three pigments of the
current 1×3 rich menu — the distilled customer journey.

Canvas: 2400 × 1400 (landscape folio).
"""
from __future__ import annotations

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

# Three pigments — matching the 1×3 rich-menu chambers.
# Each pigment also declares which distinctive icon to draw — the same
# glyph family the customer will see on the rich menu itself, scaled for
# the folio and stroke-thickened so it reads cleanly at magazine size.
PIGMENTS = [
    {"wash": (204, 207, 226), "accent": ( 63,  60, 140), "thai": "ชวนเพื่อน",   "code": "MONASTIC INDIGO",   "rgb": "204·207·226", "icon": "friends"},
    {"wash": (196, 224, 200), "accent": (  4, 120,  87), "thai": "ชำระค่างวด",  "code": "CEREMONIAL JADE",   "rgb": "196·224·200", "icon": "qr",      "hero": True},
    {"wash": (192, 217, 220), "accent": ( 23,  96, 111), "thai": "ติดต่อเรา",   "code": "SUKHOTHAI CELADON", "rgb": "192·217·220", "icon": "bubble"},
]

# Uniform stroke weight across every icon — the unyielding discipline of
# the Chromatic Shrine. 8px reads as confident at the folio scale without
# feeling chunky; stays consistent with the rich-menu STROKE=11 aesthetic
# after scaling.
ICON_STROKE = 8

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


# ─── Icon glyph library ────────────────────────────────
# Three distinctive marks, drawn in pure outline with one uniform stroke.
# Ported from the rich-menu generator and rescaled for the folio.

def icon_friends(cx: int, cy: int, color):
    """Two figures standing shoulder to shoulder."""
    head_r = 48
    head_cy = cy - 70
    spacing = 130
    lx = cx - spacing // 2
    rx = cx + spacing // 2
    draw.ellipse(
        [lx - head_r, head_cy - head_r, lx + head_r, head_cy + head_r],
        outline=color, width=ICON_STROKE,
    )
    draw.ellipse(
        [rx - head_r, head_cy - head_r, rx + head_r, head_cy + head_r],
        outline=color, width=ICON_STROKE,
    )
    arc_w = 200
    arc_h = 240
    arc_top = cy + 10
    draw.arc(
        [lx - arc_w // 2, arc_top, lx + arc_w // 2, arc_top + arc_h],
        start=180, end=360, fill=color, width=ICON_STROKE,
    )
    draw.arc(
        [rx - arc_w // 2, arc_top, rx + arc_w // 2, arc_top + arc_h],
        start=180, end=360, fill=color, width=ICON_STROKE,
    )


def icon_qr(cx: int, cy: int, color):
    """Three registration corners + centre modules — a QR in repose."""
    corner = 96
    inner = 36
    off = 138
    positions = [
        (cx - off, cy - off),
        (cx + off - corner, cy - off),
        (cx - off, cy + off - corner),
    ]
    for x, y in positions:
        draw.rectangle([x, y, x + corner, y + corner],
                       outline=color, width=ICON_STROKE)
        ci = (corner - inner) // 2
        draw.rectangle([x + ci, y + ci, x + ci + inner, y + ci + inner],
                       fill=color)
    m = 22
    gap = 12
    for dx in (-m - gap, gap):
        for dy in (-m - gap, gap):
            draw.rectangle([cx + dx, cy + dy, cx + dx + m, cy + dy + m],
                           fill=color)


def icon_bubble(cx: int, cy: int, color, wash):
    """Speech chamber with three measured beads — hollow outline."""
    w, h = 290, 200
    top = cy - h // 2 - 16
    bottom = cy + h // 2 - 16
    left = cx - w // 2
    right = cx + w // 2
    draw.rounded_rectangle(
        [left, top, right, bottom],
        radius=26, outline=color, width=ICON_STROKE,
    )
    tail_a = (cx - 32, bottom)
    tail_b = (cx - 60, bottom + 60)
    tail_c = (cx + 22, bottom)
    draw.polygon([tail_a, tail_b, tail_c], fill=wash)
    draw.line([tail_a, tail_b], fill=color, width=ICON_STROKE)
    draw.line([tail_b, tail_c], fill=color, width=ICON_STROKE)
    bead_r = 11
    for dx in (-56, 0, 56):
        draw.ellipse(
            [cx + dx - bead_r, cy - 34 - bead_r,
             cx + dx + bead_r, cy - 34 + bead_r],
            fill=color,
        )


def draw_icon(kind: str, cx: int, cy: int, color, wash):
    if kind == "friends":
        icon_friends(cx, cy, color)
    elif kind == "qr":
        icon_qr(cx, cy, color)
    elif kind == "bubble":
        icon_bubble(cx, cy, color, wash)


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
COLS = 3
# Tiles share edges — no inter-column gap; widths parcelled so they sum
# exactly to GRID_WIDTH (middle column takes any remainder).
BASE_W = GRID_WIDTH // COLS              # 706
MID_EXTRA = GRID_WIDTH - BASE_W * COLS   # 2
TILE_H = 620


def tile_x0(col: int) -> int:
    # col 0: 0, col 1: BASE_W, col 2: BASE_W*2 + MID_EXTRA
    if col == 0:
        return GRID_LEFT
    if col == 1:
        return GRID_LEFT + BASE_W
    return GRID_LEFT + BASE_W * 2 + MID_EXTRA


def tile_width(col: int) -> int:
    return BASE_W + MID_EXTRA if col == 1 else BASE_W


def draw_specimen(col: int, p: dict):
    x0 = tile_x0(col)
    TILE_W = tile_width(col)
    y0 = GRID_TOP
    x1 = x0 + TILE_W
    y1 = y0 + TILE_H

    # Pigment wash — edge to edge, no inner border. Tiles touch, hairline
    # between columns drawn once after all tiles (outside this function).
    draw.rectangle([x0, y0, x1, y1], fill=p["wash"])
    inset = 16

    # ─── Icon — distinctive chamber glyph (friends / qr / bubble)
    icon_cx = x0 + TILE_W // 2
    icon_cy = y0 + 180
    accent = p["accent"]
    draw_icon(p["icon"], icon_cx, icon_cy, accent, p["wash"])

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

# Vertical hairline dividers between adjacent tiles (triptych walls)
for c in range(1, COLS):
    x = tile_x0(c)
    draw.line([(x, GRID_TOP), (x, GRID_TOP + TILE_H)], fill=HAIRLINE, width=2)

# Outer frame — single aged-bone hairline around the whole triptych
draw.rectangle(
    [GRID_LEFT, GRID_TOP, GRID_LEFT + GRID_WIDTH, GRID_TOP + TILE_H],
    outline=HAIRLINE,
    width=1,
)


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
