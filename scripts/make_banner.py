#!/usr/bin/env python3
"""
Draws banner.jpg, the wide "Finding a Congregation" header image for the
map page on pftk.org (upload it to that Wix strip by hand). Same dot map
as og-image.png, with no text: Wix puts the page title on top.

    pip install pillow
    python scripts/make_banner.py

Wix crops the strip from the centre to fit each screen width: on a wide
desktop only the middle band of the height shows, so the map sits in that
band. The middle is darkened a little so the white title stays readable.
"""

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SCALE = 2
W, H = 2560, 800

NAVY = (17, 14, 58)        # a shade darker than the site's #1B165A header
R3 = (63, 170, 115)
R2 = (88, 145, 220)
GOLD = (222, 172, 70)


def main():
    features = json.loads((ROOT / "data" / "PCUSA_Congregations.geojson").read_text(encoding="utf-8"))["features"]
    rows = [
        (ft["geometry"]["coordinates"][1], ft["geometry"]["coordinates"][0],
         ft["properties"].get("lib_level"), ft["properties"].get("affiliate"))
        for ft in features
        if (ft.get("geometry") or {}).get("type") == "Point"
    ]
    rows = [r for r in rows if 24 < r[0] < 50 and -125 < r[1] < -66]

    lon0, lat0 = -96.0, 38.0

    def project(lat, lon):
        return (lon - lon0) * math.cos(math.radians(lat)), lat - lat0

    xy = [project(r[0], r[1]) for r in rows]
    xs = [p[0] for p in xy]
    ys = [p[1] for p in xy]
    # On a wide desktop Wix shows only about the middle 60% of the height,
    # so the whole lower 48 is fitted into that band, centred.
    band = 0.62 * H
    s = band / (max(ys) - min(ys))
    ox = (W - (max(xs) - min(xs)) * s) / 2
    oy = (H - band) / 2

    def to_px(x, y):
        return ((ox + (x - min(xs)) * s) * SCALE, (oy + (max(ys) - y) * s) * SCALE)

    img = Image.new("RGB", (W * SCALE, H * SCALE), NAVY)

    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    for r, (x, y) in zip(rows, xy):
        px, py = to_px(x, y)
        c = R3 if r[2] == 3 else R2
        d = 12 * SCALE
        g.ellipse([px - d, py - d, px + d, py + d], fill=c + (40,))
    glow = glow.filter(ImageFilter.GaussianBlur(8 * SCALE))
    img.paste(glow, (0, 0), glow)

    draw = ImageDraw.Draw(img, "RGBA")
    for r, (x, y) in zip(rows, xy):
        if r[3]:
            continue
        px, py = to_px(x, y)
        c = R3 if r[2] == 3 else R2
        d = 4 * SCALE
        draw.ellipse([px - d, py - d, px + d, py + d], fill=c + (235,))
    for r, (x, y) in zip(rows, xy):
        if r[3]:
            px, py = to_px(x, y)
            d = 9.5 * SCALE
            draw.ellipse([px - d, py - d, px + d, py + d], fill=GOLD, outline=(255, 255, 255), width=2 * SCALE)

    # Darken an oval in the middle so the white title on top stays readable.
    shade = Image.new("L", (W, H), 0)
    sd = ImageDraw.Draw(shade)
    sd.ellipse([W * 0.3, H * 0.3, W * 0.7, H * 0.7], fill=110)
    shade = shade.filter(ImageFilter.GaussianBlur(120)).resize(img.size)
    img.paste(Image.new("RGB", img.size, NAVY), (0, 0), shade)

    img = img.resize((W, H), Image.LANCZOS)
    out = ROOT / "banner.jpg"
    img.save(out, quality=88, optimize=True, progressive=True)
    print(f"{out.name}: {W}x{H}, {out.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
