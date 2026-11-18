#!/usr/bin/env python3
"""
Draws banner.jpg, the wide "Finding a Congregation" header image for the
map page on pftk.org (upload it to that Wix strip by hand). Same dot map
as og-image.png, with no title: Wix puts the page title on top.

    pip install pillow
    python scripts/make_banner.py [fonts_dir]

Wix crops the strip from the centre to fit each screen width: on a wide
desktop only the middle band of the height shows, so the map sits in that
band. Alaska and Hawaii are drawn as insets to the left of the mainland
and Puerto Rico to the right, each with a small label. The middle is
darkened a little so the white title stays readable. Fonts default to
Segoe UI from C:/Windows/Fonts; pass a folder with segoeuib.ttf otherwise.
"""

import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = Path(sys.argv[1] if len(sys.argv) > 1 else "C:/Windows/Fonts")
SCALE = 2
W, H = 2560, 800

NAVY = (17, 14, 58)        # a shade darker than the site's #1B165A header
LABEL = (150, 152, 190)
R3 = (63, 170, 115)
R2 = (88, 145, 220)
GOLD = (222, 172, 70)

# Each region: which points belong to it, and the centre of its projection.
REGIONS = {
    "mainland": (lambda lat, lon: 24 < lat < 50 and -125 < lon < -66, -96.0, 38.0),
    "Alaska": (lambda lat, lon: lat > 50 and lon < -129, -150.0, 62.0),
    "Hawaii": (lambda lat, lon: 18 < lat < 23 and -161 < lon < -154, -157.0, 20.5),
    "Puerto Rico": (lambda lat, lon: 17 < lat < 19 and -68 < lon < -65, -66.5, 18.2),
}


def project(lat, lon, lon0, lat0):
    return (lon - lon0) * math.cos(math.radians(lat)), lat - lat0


def main():
    features = json.loads((ROOT / "data" / "PCUSA_Congregations.geojson").read_text(encoding="utf-8"))["features"]
    rows = [
        (ft["geometry"]["coordinates"][1], ft["geometry"]["coordinates"][0],
         ft["properties"].get("lib_level"), ft["properties"].get("affiliate"))
        for ft in features
        if (ft.get("geometry") or {}).get("type") == "Point"
    ]
    groups = {}
    for name, (inside, lon0, lat0) in REGIONS.items():
        pts = [r for r in rows if inside(r[0], r[1])]
        groups[name] = [(r, project(r[0], r[1], lon0, lat0)) for r in pts]

    # Mainland: fitted into the band Wix shows on a wide desktop (about the
    # middle 60% of the height), centred.
    main_pts = groups["mainland"]
    xs = [p[1][0] for p in main_pts]
    ys = [p[1][1] for p in main_pts]
    band = 0.62 * H
    s = band / (max(ys) - min(ys))
    left = (W - (max(xs) - min(xs)) * s) / 2
    top = (H - band) / 2
    right = left + (max(xs) - min(xs)) * s

    placed = []  # (row, x, y) in output pixels
    for r, (x, y) in main_pts:
        placed.append((r, left + (x - min(xs)) * s, top + (max(ys) - y) * s))

    # Insets: each group is scaled and centred on a spot beside the mainland.
    # Positions are in output pixels. Alaska is shrunk, as on most US maps;
    # Hawaii and Puerto Rico are enlarged so their few churches don't merge.
    insets = {
        "Alaska": (left - 170, H * 0.42, 0.5 * s),
        "Hawaii": (left - 140, H * 0.70, 2.2 * s),
        "Puerto Rico": (right + 20, H * 0.72, 2.6 * s),
    }
    labels = []
    for name, (cx, cy, k) in insets.items():
        pts = groups[name]
        if not pts:
            continue
        gx = [p[1][0] for p in pts]
        gy = [p[1][1] for p in pts]
        mx, my = (min(gx) + max(gx)) / 2, (min(gy) + max(gy)) / 2
        for r, (x, y) in pts:
            placed.append((r, cx + (x - mx) * k, cy - (y - my) * k))
        bottom = cy + (max(gy) - my) * k
        labels.append((name, cx, bottom + 22))

    def px(v):
        return v * SCALE

    img = Image.new("RGB", (W * SCALE, H * SCALE), NAVY)

    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    for r, x, y in placed:
        c = R3 if r[2] == 3 else R2
        d = 12
        g.ellipse([px(x - d), px(y - d), px(x + d), px(y + d)], fill=c + (40,))
    glow = glow.filter(ImageFilter.GaussianBlur(8 * SCALE))
    img.paste(glow, (0, 0), glow)

    draw = ImageDraw.Draw(img, "RGBA")
    for r, x, y in placed:
        if r[3]:
            continue
        c = R3 if r[2] == 3 else R2
        d = 4
        draw.ellipse([px(x - d), px(y - d), px(x + d), px(y + d)], fill=c + (235,))
    for r, x, y in placed:
        if r[3]:
            d = 9.5
            draw.ellipse([px(x - d), px(y - d), px(x + d), px(y + d)], fill=GOLD,
                         outline=(255, 255, 255), width=2 * SCALE)

    font = ImageFont.truetype(str(FONTS / "segoeuib.ttf"), 15 * SCALE)
    for name, x, y in labels:
        text = name.upper()
        spaced = " ".join(text)  # simple letter-spacing
        w = draw.textlength(spaced, font=font)
        draw.text((px(x) - w / 2, px(y)), spaced, font=font, fill=LABEL)

    # Darken an oval in the middle so the white title on top stays readable.
    shade = Image.new("L", (W, H), 0)
    sd = ImageDraw.Draw(shade)
    sd.ellipse([W * 0.3, H * 0.3, W * 0.7, H * 0.7], fill=110)
    shade = shade.filter(ImageFilter.GaussianBlur(120)).resize(img.size)
    img.paste(Image.new("RGB", img.size, NAVY), (0, 0), shade)

    img = img.resize((W, H), Image.LANCZOS)
    out = ROOT / "banner.jpg"
    img.save(out, quality=88, optimize=True, progressive=True)
    counts = ", ".join(f"{n} {len(p)}" for n, p in groups.items())
    print(f"{out.name}: {W}x{H}, {out.stat().st_size / 1024:.0f} KB ({counts})")


if __name__ == "__main__":
    main()
