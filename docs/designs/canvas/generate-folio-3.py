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
HAIRLINE = (180, 164, 128)    # plate border — aged bone (slightly darker)
INK = (28, 36, 28)            # monastic ink
WHISPER = (104, 92, 70)       # marginalia — darker for legibility
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

F_TITLE = ImageFont.truetype(str(RICH_MENU_FONTS / "IBMPlexSansThai-SemiBold.ttf"), 68)
F_THAI_PLATE = ImageFont.truetype(str(RICH_MENU_FONTS / "IBMPlexSansThai-SemiBold.ttf"), 54)
F_MONO_S = ImageFont.truetype(str(SKILL_FONTS / "IBMPlexMono-Regular.ttf"), 20)
F_MONO_XS = ImageFont.truetype(str(SKILL_FONTS / "IBMPlexMono-Regular.ttf"), 17)
F_MONO_MD = ImageFont.truetype(str(SKILL_FONTS / "IBMPlexMono-Regular.ttf"), 24)

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
    """Two figures standing shoulder to shoulder — centred on (cx, cy).

    Head atop, inverted-U shoulder arc below (PIL 180→360 draws the
    TOP half of the ellipse box). Geometry: head spans [cy−90, cy−10],
    arc peaks at the neck (cy−10) and ends at the shoulder hem (cy+90).
    """
    head_r = 40
    spacing = 130
    arc_w = 200
    arc_h = 200  # ellipse box; visible (top-half) arc is arc_h/2 = 100 tall
    head_cy = cy - 50             # head centre; head_top = cy-90, bottom = cy-10
    arc_top = cy - 10             # arc peak sits on the neck
    lx = cx - spacing // 2
    rx = cx + spacing // 2
    # Heads drawn AFTER the arcs so the outline stays crisp at the neck.
    draw.arc(
        [lx - arc_w // 2, arc_top, lx + arc_w // 2, arc_top + arc_h],
        start=180, end=360, fill=color, width=ICON_STROKE,
    )
    draw.arc(
        [rx - arc_w // 2, arc_top, rx + arc_w // 2, arc_top + arc_h],
        start=180, end=360, fill=color, width=ICON_STROKE,
    )
    draw.ellipse(
        [lx - head_r, head_cy - head_r, lx + head_r, head_cy + head_r],
        outline=color, width=ICON_STROKE,
    )
    draw.ellipse(
        [rx - head_r, head_cy - head_r, rx + head_r, head_cy + head_r],
        outline=color, width=ICON_STROKE,
    )


def icon_qr(cx: int, cy: int, color):
    """Three registration corners + centre modules — centred on (cx, cy).

    Bounding box is [-off, +off] square in both axes (symmetric). The
    L-shaped corner arrangement biases perceived weight toward the
    top-left, so an optical +14/+14 shift is applied to counter it.
    """
    ox, oy = cx + 14, cy + 14
    corner = 72
    inner = 28
    off = 100
    positions = [
        (ox - off, oy - off),
        (ox + off - corner, oy - off),
        (ox - off, oy + off - corner),
    ]
    for x, y in positions:
        draw.rectangle([x, y, x + corner, y + corner],
                       outline=color, width=ICON_STROKE)
        ci = (corner - inner) // 2
        draw.rectangle([x + ci, y + ci, x + ci + inner, y + ci + inner],
                       fill=color)
    m = 18
    gap = 10
    for dx in (-m - gap, gap):
        for dy in (-m - gap, gap):
            draw.rectangle([ox + dx, oy + dy, ox + dx + m, oy + dy + m],
                           fill=color)


def icon_bubble(cx: int, cy: int, color, wash):
    """Speech chamber + three beads + down-left tail, centred on (cx, cy).

    The tail pulls visual mass down and slightly to the left, so the
    rectangle rides up 30px above the midline and the whole glyph is
    nudged 10px right to balance.
    """
    ox = cx + 10
    w, h = 260, 170
    top = cy - h // 2 - 30
    bottom = cy + h // 2 - 30
    left = ox - w // 2
    right = ox + w // 2
    draw.rounded_rectangle(
        [left, top, right, bottom],
        radius=24, outline=color, width=ICON_STROKE,
    )
    tail_a = (ox - 28, bottom)
    tail_b = (ox - 52, bottom + 52)
    tail_c = (ox + 20, bottom)
    draw.polygon([tail_a, tail_b, tail_c], fill=wash)
    draw.line([tail_a, tail_b], fill=color, width=ICON_STROKE)
    draw.line([tail_b, tail_c], fill=color, width=ICON_STROKE)
    bead_r = 10
    beads_cy = (top + bottom) // 2
    for dx in (-50, 0, 50):
        draw.ellipse(
            [ox + dx - bead_r, beads_cy - bead_r,
             ox + dx + bead_r, beads_cy + bead_r],
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

    # ─── Content block — vertically centred within the tile ────
    # The icon / hairline / name column is treated as one composition
    # balanced around the tile's vertical midline. 180px icon + 40px
    # breath + 50px to the name baseline leaves equal 126px margins
    # above (below the plate-number corner) and below (above the
    # marginalia row), so the eye settles on the centre without the
    # familiar AI tell of everything floating in the top third.
    icon_cx = x0 + TILE_W // 2
    icon_cy = y0 + 216
    accent = p["accent"]
    draw_icon(p["icon"], icon_cx, icon_cy, accent, p["wash"])

    sep_y = y0 + 356
    draw.line(
        [(x0 + 160, sep_y), (x1 - 160, sep_y)],
        fill=HAIRLINE,
        width=1,
    )

    name_y = y0 + 436
    text_centered((icon_cx, name_y), p["thai"], F_THAI_PLATE, INK)

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
