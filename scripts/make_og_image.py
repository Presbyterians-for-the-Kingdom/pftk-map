#!/usr/bin/env python3
"""
Draws og-image.png, the 1200x630 preview shown when the map's link is
shared on Facebook, LinkedIn, iMessage, Slack, etc.

    pip install pillow
    python scripts/make_og_image.py [fonts_dir]

The map is drawn from data/PCUSA_Congregations.geojson, so re-run this after big data
changes if the dot pattern should stay current. Fonts default to Georgia
and Segoe UI from C:/Windows/Fonts; pass another folder that has
georgiab.ttf, segoeui.ttf and segoeuib.ttf to use it elsewhere.
"""

import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = Path(sys.argv[1] if len(sys.argv) > 1 else "C:/Windows/Fonts")
SCALE = 2  # draw at 2x and downsample for smooth edges
W, H = 1200, 630

NAVY = (11, 9, 36)
INK_SOFT = (190, 192, 214)
R3 = (63, 170, 115)
R2 = (88, 145, 220)
GOLD = (222, 172, 70)


def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size * SCALE)


def main():
    features = json.loads((ROOT / "data" / "PCUSA_Congregations.geojson").read_text(encoding="utf-8"))["features"]
    f = {"lat": 0, "lon": 1, "rating": 2, "affiliate": 3}
    rows = [
        [ft["geometry"]["coordinates"][1], ft["geometry"]["coordinates"][0],
         ft["properties"].get("lib_level"), ft["properties"].get("affiliate")]
        for ft in features
        if (ft.get("geometry") or {}).get("type") == "Point"
    ]

    img = Image.new("RGB", (W * SCALE, H * SCALE), NAVY)
    draw = ImageDraw.Draw(img, "RGBA")

    # Map of the lower 48 on the right, as a simple conic-ish projection.
    left, top, right, bottom = 470, 70, 1160, 560
    lon0, lat0 = -96.0, 38.0

    def project(lat, lon):
        x = (lon - lon0) * math.cos(math.radians(lat))
        y = lat - lat0
        return x, y

    pts = [(r, project(r[f["lat"]], r[f["lon"]])) for r in rows
           if 24 < r[f["lat"]] < 50 and -125 < r[f["lon"]] < -66]
    xs = [p[1][0] for p in pts]
    ys = [p[1][1] for p in pts]
    sx = (right - left) / (max(xs) - min(xs))
    sy = (bottom - top) / (max(ys) - min(ys))
    s = min(sx, sy)
    ox = left + ((right - left) - (max(xs) - min(xs)) * s) / 2
    oy = top + ((bottom - top) - (max(ys) - min(ys)) * s) / 2

    def to_px(x, y):
        return (ox + (x - min(xs)) * s) * SCALE, (oy + (max(ys) - y) * s) * SCALE

    # Soft glow first, then crisp dots, affiliates last so they sit on top.
    for row, (x, y) in pts:
        px, py = to_px(x, y)
        color = R3 if row[f["rating"]] == 3 else R2
        g = 9 * SCALE
        draw.ellipse([px - g, py - g, px + g, py + g], fill=color + (22,))
    for row, (x, y) in pts:
        if row[f["affiliate"]]:
            continue
        px, py = to_px(x, y)
        color = R3 if row[f["rating"]] == 3 else R2
        d = 3.2 * SCALE
        draw.ellipse([px - d, py - d, px + d, py + d], fill=color + (235,))
    for row, (x, y) in pts:
        if row[f["affiliate"]]:
            px, py = to_px(x, y)
            d = 8 * SCALE
            draw.ellipse([px - d, py - d, px + d, py + d], fill=GOLD, outline=(255, 255, 255), width=2 * SCALE)

    # Left-hand text block over a fade so dots never fight the title.
    fade = Image.new("L", (W * SCALE, 1))
    for x in range(W * SCALE):
        t = x / SCALE
        fade.putpixel((x, 0), 255 if t < 420 else max(0, int(255 * (1 - (t - 420) / 160))))
    fade = fade.resize((W * SCALE, H * SCALE))
    img.paste(Image.new("RGB", img.size, NAVY), (0, 0), fade)
    draw = ImageDraw.Draw(img, "RGBA")

    seal = Image.open(ROOT / "denominational-seals" / "pftk.png").convert("RGBA")
    seal = seal.resize((96 * SCALE, 96 * SCALE), Image.LANCZOS)
    img.paste(seal, (64 * SCALE, 70 * SCALE), seal)

    x0 = 64 * SCALE
    draw.text((x0, 196 * SCALE), "The PftK Map", font=font("georgiab.ttf", 64), fill=(255, 255, 255))
    body = font("segoeui.ttf", 27)
    for i, line in enumerate(["Find PC(USA) congregations", "rated for theological fit"]):
        draw.text((x0, (292 + i * 38) * SCALE), line, font=body, fill=INK_SOFT)

    count = f"{len(rows) // 100 * 100:,}+" if len(rows) >= 100 else str(len(rows))
    small_b = font("segoeuib.ttf", 21)
    small = font("segoeui.ttf", 21)
    y = 410 * SCALE
    for color, label in [(R3, "Great fit"), (R2, "Good fit"), (GOLD, "PftK affiliate")]:
        d = 7 * SCALE
        cy = y + 14 * SCALE
        draw.ellipse([x0, cy - d, x0 + 2 * d, cy + d], fill=color)
        draw.text((x0 + 26 * SCALE, y), label, font=small, fill=(230, 231, 240))
        y += 36 * SCALE

    draw.text((x0, 548 * SCALE), f"{count} congregations  ·  Search by city, state or ZIP",
              font=small_b, fill=(255, 255, 255))

    img = img.resize((W, H), Image.LANCZOS)
    out = ROOT / "og-image.png"
    img.save(out, optimize=True)
    print(f"{out.name}: {out.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
