"""
Chromatic Shrine - BESTCHOICE Finance LINE Rich Menu (6-cell, 2×3)
Canvas: 2500x1686 (LINE Rich Menu full size)

Optimised for mobile readability and aligned with the project's
admin UI which expects fixed 2×3 / 1×3 / 2×2 layouts.

The discount-percent label is read from EARLY_PAYOFF_DISCOUNT (env var,
default 50). Must be regenerated and re-uploaded if the
`contract_early_discount` system config changes — the label is baked
into the PNG, not fetched at runtime.
"""
from __future__ import annotations

import math
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Canvas
W, H = 2500, 1686
COLS, ROWS = 3, 2
CELL_W, CELL_H = W // COLS, H // ROWS

# Business config (must match `contract_early_discount` in admin → /settings)
DISCOUNT_PCT = os.environ.get("EARLY_PAYOFF_DISCOUNT", "50")

# Base palette
FIELD    = (250, 247, 240)
INK      = (24, 40, 32)
GOLD     = (168, 118, 39)
HAIRLINE = (204, 196, 178)
WHISPER  = (168, 160, 144)

# Six pigments — one per chamber
PIGMENTS = {
    "sand":    ((234, 220, 188), (166, 118,  45)),
    "emerald": ((196, 224, 200), (  4, 120,  87)),
    "coral":   ((247, 219, 205), (195,  92,  56)),
    "ruby":    ((238, 200, 208), (161,  50,  75)),
    "indigo":  ((204, 207, 226), ( 63,  60, 140)),
    "teal":    ((192, 217, 220), ( 23,  96, 111)),
}

# Fonts — sized for compressed-mobile readability
ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent.parent.parent  # docs/designs/rich-menu → repo root
CANVAS_FONTS = REPO_ROOT / ".claude/skills/canvas-design/canvas-fonts"

if not CANVAS_FONTS.exists():
    raise FileNotFoundError(
        f"canvas-fonts not found at {CANVAS_FONTS}. "
        "Run from repo root or check that .claude/skills/canvas-design is installed."
    )

F_THAI_LABEL = ImageFont.truetype(str(ROOT / "IBMPlexSansThai-SemiBold.ttf"), 78)
F_MONO_MARK  = ImageFont.truetype(str(CANVAS_FONTS / "IBMPlexMono-Regular.ttf"), 22)

img = Image.new("RGB", (W, H), FIELD)
draw = ImageDraw.Draw(img, "RGBA")

STROKE = 11


def cell_box(col: int, row: int) -> tuple[int, int, int, int]:
    return col * CELL_W, row * CELL_H, col * CELL_W + CELL_W, row * CELL_H + CELL_H


def cell_center(col: int, row: int) -> tuple[int, int]:
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


# ═════════ Icons (uniform STROKE=11) ═════════

def icon_qr(cx: int, cy: int, color, wash) -> None:
    """QR — three registration corners + four center modules."""
    del wash
    corner = 130
    inner = 50
    off = 200
    positions = [
        (cx - off, cy - off),
        (cx + off - corner, cy - off),
        (cx - off, cy + off - corner),
    ]
    for x, y in positions:
        draw.rectangle([x, y, x + corner, y + corner], outline=color, width=STROKE)
        ci = (corner - inner) // 2
        draw.rectangle([x + ci, y + ci, x + ci + inner, y + ci + inner], fill=color)
    m = 32
    for dx in (-m - 14, 14):
        for dy in (-m - 14, 14):
            draw.rectangle([cx + dx, cy + dy, cx + dx + m, cy + dy + m], fill=color)


def icon_contract(cx: int, cy: int, color, wash) -> None:
    """Inscription tablet — document with four rules."""
    del wash
    w_outer, h_outer = 270, 350
    draw.rounded_rectangle(
        [cx - w_outer // 2, cy - h_outer // 2, cx + w_outer // 2, cy + h_outer // 2],
        radius=14, outline=color, width=STROKE,
    )
    rules_y = [cy - 110, cy - 30, cy + 40, cy + 110]
    rules_w = [170, 210, 210, 130]
    for ry, rw in zip(rules_y, rules_w):
        draw.line([(cx - rw // 2, ry), (cx + rw // 2, ry)], fill=color, width=STROKE - 3)


def icon_history(cx: int, cy: int, color, wash) -> None:
    """Cycle — clock face with two hands and cardinal ticks."""
    del wash
    r = 175
    ring(cx, cy, r, STROKE, color)
    # Hour hand: pointing 10 o'clock direction (slightly NW)
    hr = r * 0.55
    hx = cx + int(hr * math.cos(math.radians(-120)))
    hy = cy + int(hr * math.sin(math.radians(-120)))
    draw.line([(cx, cy), (hx, hy)], fill=color, width=STROKE)
    # Minute hand: pointing 2 o'clock direction (slightly NE)
    mr = r * 0.78
    mx = cx + int(mr * math.cos(math.radians(-60)))
    my = cy + int(mr * math.sin(math.radians(-60)))
    draw.line([(cx, cy), (mx, my)], fill=color, width=STROKE - 2)
    # Center pin
    disc(cx, cy, 12, color)
    # Cardinal tick marks (12, 3, 6, 9)
    for deg in (0, 90, 180, 270):
        a = math.radians(deg - 90)
        x1 = cx + int((r - 6) * math.cos(a))
        y1 = cy + int((r - 6) * math.sin(a))
        x2 = cx + int((r + 18) * math.cos(a))
        y2 = cy + int((r + 18) * math.sin(a))
        draw.line([(x1, y1), (x2, y2)], fill=color, width=STROKE - 3)


def icon_percent(cx: int, cy: int, color, wash) -> None:
    """Discount — two rings + a single diagonal stroke."""
    del wash
    dot_r = 48
    offset = 140
    ring(cx - offset, cy - offset, dot_r, STROKE, color)
    ring(cx + offset, cy + offset, dot_r, STROKE, color)
    slash_len = 230
    draw.line([
        (cx + slash_len, cy - slash_len),
        (cx - slash_len, cy + slash_len),
    ], fill=color, width=STROKE + 2)


def icon_friends(cx: int, cy: int, color, wash) -> None:
    """Two figures standing side by side — 'friends/refer'."""
    del wash
    head_r = 70
    head_cy = cy - 110
    spacing = 160
    lx = cx - spacing // 2
    rx = cx + spacing // 2
    ring(lx, head_cy, head_r, STROKE, color)
    ring(rx, head_cy, head_r, STROKE, color)
    arc_w = 260
    arc_h_full = 320
    arc_top = cy
    draw.arc([lx - arc_w // 2, arc_top, lx + arc_w // 2, arc_top + arc_h_full],
             start=180, end=360, fill=color, width=STROKE)
    draw.arc([rx - arc_w // 2, arc_top, rx + arc_w // 2, arc_top + arc_h_full],
             start=180, end=360, fill=color, width=STROKE)


def icon_bubble(cx: int, cy: int, color, wash) -> None:
    """Speech chamber with three measured beads — hollow outline."""
    w, h = 380, 260
    top = cy - h // 2 - 24
    bottom = cy + h // 2 - 24
    left = cx - w // 2
    right = cx + w // 2
    draw.rounded_rectangle([left, top, right, bottom], radius=32,
                           outline=color, width=STROKE)
    tail_a = (cx - 42, bottom)
    tail_b = (cx - 78, bottom + 78)
    tail_c = (cx + 28, bottom)
    draw.polygon([tail_a, tail_b, tail_c], fill=wash)
    draw.line([tail_a, tail_b], fill=color, width=STROKE)
    draw.line([tail_b, tail_c], fill=color, width=STROKE)
    for dx in (-76, 0, 76):
        disc(cx + dx, cy - 50, 15, color)


# ═════════ Chambers (left-to-right, top-to-bottom) ═════════
CHAMBERS: list[dict] = [
    # Top row
    {"icon": icon_contract, "thai": "สัญญาของฉัน",  "pig": "sand"},
    {"icon": icon_qr,       "thai": "ชำระค่างวด",   "pig": "emerald", "hero": True},
    {"icon": icon_history,  "thai": "ประวัติชำระ",  "pig": "coral"},
    # Bottom row
    {"icon": icon_percent,  "thai": f"ปิดยอดลด {DISCOUNT_PCT}%", "pig": "ruby"},
    {"icon": icon_friends,  "thai": "ชวนเพื่อน",    "pig": "indigo"},
    {"icon": icon_bubble,   "thai": "ติดต่อเรา",    "pig": "teal"},
]


# ═════════ Pigment wash pass ═════════
for idx, ch in enumerate(CHAMBERS):
    col, row = idx % COLS, idx // COLS
    wash, _ = PIGMENTS[ch["pig"]]
    draw.rectangle(cell_box(col, row), fill=wash)


# ═════════ Hairline dividers ═════════
for c in range(1, COLS):
    x = c * CELL_W
    draw.line([(x, 0), (x, H)], fill=HAIRLINE, width=2)
for r in range(1, ROWS):
    y = r * CELL_H
    draw.line([(0, y), (W, y)], fill=HAIRLINE, width=2)


# ═════════ Render chambers ═════════
def render_chamber(idx: int, ch: dict) -> None:
    col, row = idx % COLS, idx // COLS
    cx, cy = cell_center(col, row)
    wash, accent = PIGMENTS[ch["pig"]]
    is_hero = ch.get("hero", False)

    # Icon — upper portion of cell
    icon_cy = cy - 110
    ch["icon"](cx, icon_cy, accent, wash)

    # Thai label
    label_cy = cy + 220
    draw_text_centered((cx, label_cy), ch["thai"], F_THAI_LABEL, INK)

    # Hero gold underline
    if is_hero:
        bbox = draw.textbbox((0, 0), ch["thai"], font=F_THAI_LABEL)
        tw = bbox[2] - bbox[0]
        rule_y = label_cy + 70
        draw.line([(cx - tw // 2, rule_y), (cx + tw // 2, rule_y)],
                  fill=GOLD, width=4)


for idx, ch in enumerate(CHAMBERS):
    render_chamber(idx, ch)


# ═════════ Restrained marginalia ═════════
draw.line([(48, H - 36), (114, H - 36)], fill=GOLD, width=2)
draw.text((130, H - 50), "BESTCHOICE  FINANCE", fill=INK, font=F_MONO_MARK)

sig_text = "ed. 01 / 01"
sbbox = draw.textbbox((0, 0), sig_text, font=F_MONO_MARK)
sw = sbbox[2] - sbbox[0]
draw.text((W - 48 - sw, H - 50), sig_text, fill=INK, font=F_MONO_MARK)
rule_right = W - 48 - sw - 14
draw.line([(rule_right - 28, H - 36), (rule_right, H - 36)], fill=GOLD, width=2)


# Export
out = ROOT / "bestchoice-finance-rich-menu.png"
img.save(out, "PNG", optimize=True)
print(f"saved {out}  ({W}x{H})")
