#!/usr/bin/env python3
"""
Builds the ZIP and town lookup files that let search find the churches
nearest a ZIP code or town, even one with no listed church.

    python scripts/build_places.py <gazetteer_dir> [out_dir]

<gazetteer_dir> holds the US Census Bureau's Gazetteer files (public
domain), unzipped from
https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html
  - 2023_Gaz_zcta_national.txt     ZIP code areas
  - 2023_Gaz_place_national.txt    cities, towns, villages, CDPs
  - 2023_Gaz_cousubs_national.txt  New England towns (most aren't "places")

Outputs, in data/places/ by default:
  - zip-0.json ... zip-9.json  {"ZIP": [lat, lon]}, split by first digit
  - town-a.json ... town-z.json  [[name, state, lat, lon]], split by the
    first letter of the name

These only locate a search; nothing from them is shown as church data.
Re-run when the Census publishes a new year (rarely needed).
"""
import csv
import json
import re
import sys
import unicodedata
from pathlib import Path

NEW_ENGLAND = {"CT", "MA", "ME", "NH", "RI", "VT"}

# Census names end in their legal type ("Dayton city", "Avon town"),
# which nobody types into a search box.
SUFFIX_RE = re.compile(
    r"\s+(?:city and borough|unified government|consolidated government|metropolitan government|"
    r"urban county|zona urbana|CDP|city|town|village|borough|comunidad|township|municipality|"
    r"plantation|corporation)$",
    re.IGNORECASE,
)


def rows(path):
    with open(path, encoding="latin-1", newline="") as f:
        reader = csv.reader(f, delimiter="\t")
        header = [h.strip() for h in next(reader)]
        for r in reader:
            yield dict(zip(header, (v.strip() for v in r)))


def key(name):
    s = unicodedata.normalize("NFD", name.lower())
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def clean_names(raw):
    """'El Paso de Robles (Paso Robles) city' -> both names, suffix dropped."""
    name = raw.replace(" (balance)", "")
    name = SUFFIX_RE.sub("", name).strip()
    m = re.match(r"^(.*?)\s*\((.+)\)$", name)
    if m:
        return [m.group(1).strip(), m.group(2).strip()]
    return [name]


def main():
    src = Path(sys.argv[1])
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "data/places")
    out.mkdir(parents=True, exist_ok=True)

    zips = {}
    for r in rows(src / "2023_Gaz_zcta_national.txt"):
        zips[r["GEOID"]] = [round(float(r["INTPTLAT"]), 3), round(float(r["INTPTLONG"]), 3)]
    for d in "0123456789":
        part = {z: v for z, v in sorted(zips.items()) if z[0] == d}
        (out / f"zip-{d}.json").write_text(json.dumps(part, separators=(",", ":")), encoding="utf-8")

    # One entry per name and state; where several share it, the largest
    # by land area (usually the one people mean).
    towns = {}
    sources = [(src / "2023_Gaz_place_national.txt", None),
               (src / "2023_Gaz_cousubs_national.txt", NEW_ENGLAND)]
    for path, states in sources:
        for r in rows(path):
            if states and r["USPS"] not in states:
                continue
            area = float(r["ALAND"] or 0)
            for name in clean_names(r["NAME"]):
                k = (key(name), r["USPS"])
                if not k[0] or (k in towns and towns[k][0] >= area):
                    continue
                towns[k] = (area, [name, r["USPS"], round(float(r["INTPTLAT"]), 3),
                                   round(float(r["INTPTLONG"]), 3)])

    by_letter = {}
    for (k, _), (_, entry) in sorted(towns.items()):
        letter = k[0] if "a" <= k[0] <= "z" else "a"
        by_letter.setdefault(letter, []).append(entry)
    for letter, entries in by_letter.items():
        (out / f"town-{letter}.json").write_text(json.dumps(entries, separators=(",", ":"), ensure_ascii=False),
                                                 encoding="utf-8")

    print(f"{len(zips)} ZIPs, {len(towns)} towns -> {out}")


if __name__ == "__main__":
    main()
