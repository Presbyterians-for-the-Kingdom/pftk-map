#!/usr/bin/env python3
"""
Lists churches whose map pin doesn't match their address, which usually
means the sheet's coordinates or the address need fixing.

    python scripts/check_locations.py [miles] > location-report.csv

Each pin is compared with the centre of the ZIP code in its address, or,
when that ZIP has no Census area (PO box ZIPs, typos), the centre of the
town. Both come from the lookup files build_places.py writes to
data/places/. Large rural ZIPs and towns can be 20+ miles across, so the
default threshold is 25 miles: check the biggest distances first.

The "problem" column says what was found:
  far from ZIP / far from town   pin is more than [miles] away from both
  ZIP not recognised             no ZIP area or town matched; check the ZIP
  no state or ZIP                the address couldn't be read
"""
import csv
import json
import math
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# "..., Town, ST 12345", "..., ST 12345-6789, USA", "..., ST, United States, 12345"
ADDRESS_RE = re.compile(r",\s*([^,]+?),\s*([A-Z]{2})\b[\s,]*(?:United States|USA)?[\s,]*(\d{3,9})?(?:-\d*)?[\s,]*(?:USA)?\s*$")


def miles(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 3958.8 * math.asin(math.sqrt(h))


def key(name):
    s = unicodedata.normalize("NFD", name.lower())
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return re.sub(r"\bsaint\b", "st", re.sub(r"\bmount\b", "mt", s))


def main():
    threshold = float(sys.argv[1]) if len(sys.argv) > 1 else 25
    places = ROOT / "data" / "places"
    zips, towns = {}, {}
    for path in places.glob("zip-*.json"):
        zips.update(json.loads(path.read_text(encoding="utf-8")))
    for path in places.glob("town-*.json"):
        for name, state, lat, lon in json.loads(path.read_text(encoding="utf-8")):
            towns[(key(name), state)] = (lat, lon)
    features = json.loads((ROOT / "data" / "PCUSA_Congregations.geojson").read_text(encoding="utf-8"))["features"]

    flagged = []
    for f in features:
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"]
        address = (p.get("full_address") or "").strip()
        row = [p["church_name"], address, lat, lon]
        m = ADDRESS_RE.search(address)
        if not m:
            flagged.append(["no state or ZIP", ""] + row)
            continue
        town, state, z = m.group(1), m.group(2), m.group(3) or ""
        # ZIPs stored as numbers lose their leading zeros ("NJ 7660");
        # 9-digit ZIP+4 sometimes has no dash.
        z = z[:5] if len(z) >= 5 else z.zfill(5) if z else ""
        if z in zips:
            d = miles((lat, lon), zips[z])
            if d < threshold:
                continue
            # Some ZIP areas are huge (rural Alaska); if the town agrees, the pin is fine.
            t = towns.get((key(town), state))
            if not (t and miles((lat, lon), t) < threshold):
                flagged.append(["far from ZIP", round(d)] + row)
            continue
        t = towns.get((key(town), state))
        if t:
            d = miles((lat, lon), t)
            if d >= threshold:
                flagged.append(["far from town", round(d)] + row)
        else:
            flagged.append(["ZIP not recognised", ""] + row)

    flagged.sort(key=lambda r: (r[0] not in ("far from ZIP", "far from town"), -(r[1] or 0)))
    out = csv.writer(sys.stdout, lineterminator="\n")
    out.writerow(["problem", "miles", "church_name", "full_address", "pin_lat", "pin_lon"])
    out.writerows(flagged)
    print(f"{len(flagged)} of {len(features)} churches flagged", file=sys.stderr)


if __name__ == "__main__":
    main()
