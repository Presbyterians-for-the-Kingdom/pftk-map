#!/usr/bin/env python3
"""
Draws banner.jpg, the wide "Finding a Congregation" header image for the
map page on pftk.org (upload it to that Wix strip by hand). Same dot map
as og-image.png, with no title: Wix puts the page title on top.

    pip install pillow
    python scripts/make_banner.py

Wix crops the strip from the centre to fit each screen width: on a wide
desktop only the middle band of the height shows, so the map sits in that
band. Alaska and Hawaii are drawn as insets to the left of the mainland
and Puerto Rico to the right. Faint outlines come from
scripts/banner-outlines.json (simplified US Census shapes). The middle is
darkened a little so the white title stays readable.
"""

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SCALE = 2
W, H = 2560, 800

NAVY = (17, 14, 58)        # a shade darker than the site's #1B165A header
OUTLINE = (150, 152, 205, 70)
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

    outlines = json.loads((ROOT / "scripts" / "banner-outlines.json").read_text(encoding="utf-8"))

    def outline_xy(name):
        _, lon0, lat0 = REGIONS[name]
        return [[project(lat, lon, lon0, lat0) for lon, lat in line] for line in outlines[name]]

    def place(name, fit):
        """Project a region's dots and outline to output pixels. fit(xs, ys)
        returns (scale, x0, y0) for the region's projected outline box."""
        lines = outline_xy(name)
        xs = [x for line in lines for x, _ in line]
        ys = [y for line in lines for _, y in line]
        k, x0, y0 = fit(xs, ys)

        def to_out(x, y):
            return x0 + (x - min(xs)) * k, y0 + (max(ys) - y) * k

        dots = [(r,) + to_out(x, y) for r, (x, y) in groups[name]]
        drawn = [[to_out(x, y) for x, y in line] for line in lines]
        return dots, drawn, (x0, y0, x0 + (max(xs) - min(xs)) * k, y0 + (max(ys) - min(ys)) * k)

    # Mainland: its outline fitted into the band Wix shows on a wide desktop
    # (about the middle 60% of the height) with a little room, centred.
    band = 0.56 * H

    def fit_mainland(xs, ys):
        k = band / (max(ys) - min(ys))
        return k, (W - (max(xs) - min(xs)) * k) / 2, (H - band) / 2

    placed, shapes, (left, top, right, bottom) = place("mainland", fit_mainland)

    # Insets beside the mainland: (centre x, centre y, width, height) of the
    # box each one is fitted into, in output pixels. Alaska is shrunk, as on
    # most US maps; Hawaii and Puerto Rico are enlarged to stay legible.
    insets = {
        "Alaska": (left - 250, H * 0.37, 330, 150),
        "Hawaii": (left - 170, H * 0.69, 190, 80),
        "Puerto Rico": (right + 10, H * 0.74, 120, 50),
    }
    for name, (cx, cy, bw, bh) in insets.items():
        def fit_inset(xs, ys, cx=cx, cy=cy, bw=bw, bh=bh):
            w, h = max(xs) - min(xs), max(ys) - min(ys)
            k = min(bw / w, bh / h)
            return k, cx - w * k / 2, cy - h * k / 2
        dots, drawn, _ = place(name, fit_inset)
        placed += dots
        shapes += drawn

    def px(v):
        return v * SCALE

    img = Image.new("RGB", (W * SCALE, H * SCALE), NAVY)

    # Faint coastline and border, under the dots.
    lines = ImageDraw.Draw(img, "RGBA")
    for line in shapes:
        lines.line([(px(x), px(y)) for x, y in line], fill=OUTLINE, width=round(1.5 * SCALE), joint="curve")

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
