"""
Chromatic Shrine (1×3) — BESTCHOICE Finance LINE Rich Menu
Canvas: 2500x843 (half-height LINE Rich Menu)

Three chambers only — simpler rich menu:
  ชวนเพื่อน  ·  ชำระค่างวด (hero)  ·  ติดต่อเรา

Same pigment/icon system as generate.py but single-row.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Canvas (half height for 1×3)
W, H = 2500, 843
COLS, ROWS = 3, 1
CELL_W, CELL_H = W // COLS, H // ROWS

# Base palette
FIELD = (250, 247, 240)
INK = (24, 40, 32)
GOLD = (168, 118, 39)
HAIRLINE = (204, 196, 178)

# Three pigments — one per chamber
PIGMENTS = {
    "indigo":  ((204, 207, 226), ( 63,  60, 140)),
    "emerald": ((196, 224, 200), (  4, 120,  87)),
    "teal":    ((192, 217, 220), ( 23,  96, 111)),
}

# Fonts — only the Thai chamber label is drawn on the customer-facing menu.
ROOT = Path(__file__).parent
F_THAI_LABEL = ImageFont.truetype(str(ROOT / "IBMPlexSansThai-SemiBold.ttf"), 84)

img = Image.new("RGB", (W, H), FIELD)
draw = ImageDraw.Draw(img, "RGBA")

STROKE = 11


def cell_box(col: int, row: int):
    return col * CELL_W, row * CELL_H, col * CELL_W + CELL_W, row * CELL_H + CELL_H


def cell_center(col: int, row: int):
    return col * CELL_W + CELL_W // 2, row * CELL_H + CELL_H // 2


def draw_text_centered(xy, text, font, fill):
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x, y = xy
    draw.text((x - w // 2, y - h // 2 - bbox[1]), text, fill=fill, font=font)


def ring(cx, cy, r, width, fill):
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=fill, width=width)


def disc(cx, cy, r, fill):
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)


def icon_friends(cx, cy, color, wash):
    """Two figures standing shoulder to shoulder — 'refer a friend'."""
    del wash
    head_r = 74
    head_cy = cy - 115
    spacing = 170
    lx = cx - spacing // 2
    rx = cx + spacing // 2
    ring(lx, head_cy, head_r, STROKE, color)
    ring(rx, head_cy, head_r, STROKE, color)
    arc_w = 280
    arc_h_full = 340
    arc_top = cy
    draw.arc([lx - arc_w // 2, arc_top, lx + arc_w // 2, arc_top + arc_h_full],
             start=180, end=360, fill=color, width=STROKE)
    draw.arc([rx - arc_w // 2, arc_top, rx + arc_w // 2, arc_top + arc_h_full],
             start=180, end=360, fill=color, width=STROKE)


def icon_qr(cx, cy, color, wash):
    del wash
    corner = 140
    inner = 54
    off = 215
    positions = [
        (cx - off, cy - off),
        (cx + off - corner, cy - off),
        (cx - off, cy + off - corner),
    ]
    for x, y in positions:
        draw.rectangle([x, y, x + corner, y + corner], outline=color, width=STROKE)
        ci = (corner - inner) // 2
        draw.rectangle([x + ci, y + ci, x + ci + inner, y + ci + inner], fill=color)
    m = 34
    for dx in (-m - 16, 16):
        for dy in (-m - 16, 16):
            draw.rectangle([cx + dx, cy + dy, cx + dx + m, cy + dy + m], fill=color)


def icon_bubble(cx, cy, color, wash):
    w, h = 400, 280
    top = cy - h // 2 - 24
    bottom = cy + h // 2 - 24
    left = cx - w // 2
    right = cx + w // 2
    draw.rounded_rectangle([left, top, right, bottom], radius=34,
                           outline=color, width=STROKE)
    tail_a = (cx - 46, bottom)
    tail_b = (cx - 82, bottom + 82)
    tail_c = (cx + 30, bottom)
    draw.polygon([tail_a, tail_b, tail_c], fill=wash)
    draw.line([tail_a, tail_b], fill=color, width=STROKE)
    draw.line([tail_b, tail_c], fill=color, width=STROKE)
    for dx in (-82, 0, 82):
        disc(cx + dx, cy - 55, 16, color)


# Three chambers — left to right
CHAMBERS = [
    {"icon": icon_friends, "thai": "ชวนเพื่อน",    "pig": "indigo"},
    {"icon": icon_qr,      "thai": "ชำระค่างวด",  "pig": "emerald", "hero": True},
    {"icon": icon_bubble,  "thai": "ติดต่อเรา",   "pig": "teal"},
]


# Pigment wash pass
for idx, ch in enumerate(CHAMBERS):
    col = idx
    wash, _ = PIGMENTS[ch["pig"]]
    draw.rectangle(cell_box(col, 0), fill=wash)


# Hairline dividers (vertical only — single row)
for c in range(1, COLS):
    x = c * CELL_W
    draw.line([(x, 0), (x, H)], fill=HAIRLINE, width=2)


def render_chamber(idx: int, ch: dict):
    col = idx
    cx, cy = cell_center(col, 0)
    wash, accent = PIGMENTS[ch["pig"]]
    is_hero = ch.get("hero", False)

    # Icon — upper portion
    icon_cy = cy - 120
    ch["icon"](cx, icon_cy, accent, wash)

    # Thai label
    label_cy = cy + 220
    draw_text_centered((cx, label_cy), ch["thai"], F_THAI_LABEL, INK)

    # Hero gold underline
    if is_hero:
        bbox = draw.textbbox((0, 0), ch["thai"], font=F_THAI_LABEL)
        tw = bbox[2] - bbox[0]
        rule_y = label_cy + 78
        draw.line([(cx - tw // 2, rule_y), (cx + tw // 2, rule_y)],
                  fill=GOLD, width=4)


for idx, ch in enumerate(CHAMBERS):
    render_chamber(idx, ch)


# Marginalia removed — the customer-facing rich menu needs only the three
# chamber labels. Brand + edition hallmarks stayed as folio-flavoured
# decoration; at LINE chatbar scale they were reading as visual noise.


out = ROOT / "bestchoice-finance-rich-menu-3.png"
img.save(out, "PNG", optimize=True)
print(f"saved {out}  ({W}x{H})")
