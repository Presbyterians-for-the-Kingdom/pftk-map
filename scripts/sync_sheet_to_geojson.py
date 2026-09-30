#!/usr/bin/env python3
"""
Pulls congregation data from the private "Master" worksheet in an Excel
workbook stored on SharePoint/OneDrive (via Microsoft Graph) and rebuilds
data/PCUSA_Congregations.geojson, keeping ONLY the public-safe columns.

This reconciles the automated pipeline with the transform the mapping
chairman was running by hand against a downloaded copy of the workbook:
  - only congregations with lib_level 0 or 1 are published
  - size is bucketed into XS/S/M/L/XL rather than published as a raw number
  - url is normalized (scheme forced to https, query/fragment stripped)
  - the public property set is church_name, lib_level, full_address, url,
    google_maps_url, size_bucket, affliate (NOT the broader set the pipeline
    used briefly before this reconciliation)

IMPORTANT: app.js currently reads address_line_1/city/state/zip, presbytery,
pastor, phone, email, and notes_public for its popups -- NONE of those exist
in this schema anymore. app.js needs a matching update (full_address,
lib_level, size_bucket, affliate) or popups will render blank for those
fields. This script intentionally does not touch app.js.

Security model: ALLOWED_COLUMNS is an allowlist, not a blocklist. Any column
that exists in the sheet but is NOT listed here is dropped silently. That
means a new column someone adds to the sheet later (another internal
tracking field, say) is private by default -- it has to be added to this
list on purpose before it will ever reach the public repo.

Required environment variables (set as GitHub Actions secrets):
  MS_TENANT_ID      -- Directory (tenant) ID from the Entra app registration
  MS_CLIENT_ID      -- Application (client) ID from the app registration
  MS_CLIENT_SECRET  -- client secret value
  MS_SITE_HOSTNAME  -- e.g. "yourorg.sharepoint.com"
  MS_SITE_PATH      -- e.g. "/sites/PFTK" (the site's path, not the file path)
  MS_FILE_PATH      -- path to the .xlsx file within that site's default
                        document library, e.g. "General/Congregation Data.xlsx"
Optional:
  WORKSHEET_NAME    -- worksheet/tab to read from (default: "Master")

The Entra app needs the Microsoft Graph *application* permission
"Sites.Selected", with admin consent granted, and then must be explicitly
granted "read" access to this one SharePoint site.
"""

import json
import os
import re
import sys
from urllib.parse import urlparse, urlunparse

import requests
import msal

# --- Config -----------------------------------------------------------

# Chairman's narrower set, per explicit sign-off. NOTE this does NOT match
# what app.js currently reads -- see the module docstring above.
ALLOWED_COLUMNS = [
    "church_name",
    "lib_level",
    "full_address",
    "url",
    "google_maps_url",
    # size_bucket and affliate are computed/renamed below, not read directly
    # off the row via this list -- see build_properties().
]

# Columns the sheet is expected to have but that must NEVER be published,
# regardless of which curated view is in use. Not used for filtering (the
# allowlist above already excludes them) -- listed here so the intent is
# explicit and this fails loudly if one of them ever shows up in
# ALLOWED_COLUMNS by mistake.
FORBIDDEN_COLUMNS = [
    "notes_private",
    "confidence",
    "date_of_review",
    "responsible",
    "removed",
    "orgs",
    "pftk",
]

# Only congregations with lib_level in this set are published at all.
PUBLISHED_LIB_LEVELS = {0, 1}

SIZE_BUCKET_BINS = [0, 40, 100, 300, 800, 100000]  # right-open: [a, b)
SIZE_BUCKET_LABELS = ["XS", "S", "M", "L", "XL"]

# The chairman's script read this from a column literally spelled "affliate"
# (missing the 'i') -- checking both spellings here so we don't have to bet
# on which one the real sheet (column AA) actually uses.
AFFILIATE_COLUMN_CANDIDATES = ["affliate", "affiliate"]
AFFILIATE_OUTPUT_KEY = "affiliate"

LAT_COLUMN_CANDIDATES = ["latitude", "lat"]
LON_COLUMN_CANDIDATES = ["longitude", "lon", "lng"]
# Fallback: a single WKT-style column, e.g. "POINT (-81.79 36.63)" (lon lat),
# which is how the sheet stores coordinates today. A literal placeholder
# like "(POINT: None  None)" simply won't match this pattern and falls
# through to "no coordinates found", same as a blank cell.
GEO_COLUMN_CANDIDATES = ["geolocation", "geo_location", "location"]
WKT_POINT_RE = re.compile(r"POINT\s*\(\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*\)", re.IGNORECASE)

OUTPUT_PATH = "data/PCUSA_Congregations.geojson"

GRAPH_ROOT = "https://graph.microsoft.com/v1.0"
SCOPES = ["https://graph.microsoft.com/.default"]


def get_token():
    app = msal.ConfidentialClientApplication(
        client_id=os.environ["MS_CLIENT_ID"],
        client_credential=os.environ["MS_CLIENT_SECRET"],
        authority=f"https://login.microsoftonline.com/{os.environ['MS_TENANT_ID']}",
    )
    result = app.acquire_token_for_client(scopes=SCOPES)
    if "access_token" not in result:
        print(f"Failed to get token: {result.get('error_description', result)}", file=sys.stderr)
        sys.exit(1)
    return result["access_token"]


def graph_get(url, token):
    resp = requests.get(url, headers={"Authorization": f"Bearer {token}"})
    if not resp.ok:
        print(f"Graph request failed ({resp.status_code}): {resp.text}", file=sys.stderr)
        sys.exit(1)
    return resp.json()


def get_site_id(token):
    hostname = os.environ["MS_SITE_HOSTNAME"]
    site_path = os.environ["MS_SITE_PATH"]
    url = f"{GRAPH_ROOT}/sites/{hostname}:{site_path}"
    data = graph_get(url, token)
    return data["id"]


def get_used_range(token, site_id, file_path, worksheet_name):
    url = (
        f"{GRAPH_ROOT}/sites/{site_id}/drive/root:/{file_path}:"
        f"/workbook/worksheets('{worksheet_name}')/usedRange(valuesOnly=true)"
    )
    data = graph_get(url, token)
    return data["values"]  # 2D array; first row is headers


def find_column(headers, candidates):
    lower = {h.lower(): h for h in headers if isinstance(h, str)}
    for c in candidates:
        if c in lower:
            return lower[c]
    return None


def clean_url(value):
    """Mirrors the chairman's clean_url(): force https, strip query/fragment,
    drop a bare "/" path. Non-URL-looking strings pass through unchanged."""
    if value is None:
        return ""
    s = str(value).strip()
    if not s:
        return ""
    p = urlparse(s)
    if not p.netloc:
        return s
    path = p.path if p.path != "/" else ""
    return urlunparse((p.scheme or "https", p.netloc, path, "", "", ""))


def bucket_size(raw_size):
    """Mirrors the chairman's pd.cut(bins=SIZE_BUCKET_BINS, right=False):
    values <= 0, non-numeric, or >= the top bin edge come back as None."""
    try:
        s = float(raw_size)
    except (TypeError, ValueError):
        return None
    if s <= 0:
        return None
    for i in range(len(SIZE_BUCKET_BINS) - 1):
        if SIZE_BUCKET_BINS[i] <= s < SIZE_BUCKET_BINS[i + 1]:
            return SIZE_BUCKET_LABELS[i]
    return None


def parse_lib_level(value):
    """Returns an int if value cleanly represents one of the published
    levels' underlying numeric type, else None."""
    if value is None or value == "":
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f != int(f):
        return None
    return int(f)


def build_properties(row, affiliate_col):
    properties = {}
    for col in ALLOWED_COLUMNS:
        value = row.get(col, "")
        properties[col] = value if value not in ("", None) else None

    properties["url"] = clean_url(row.get("url")) or None
    properties["size_bucket"] = bucket_size(row.get("size"))
    properties[AFFILIATE_OUTPUT_KEY] = (row.get(affiliate_col) or None) if affiliate_col else None

    return properties


def main():
    overlap = set(ALLOWED_COLUMNS) & set(FORBIDDEN_COLUMNS)
    if overlap:
        print(f"REFUSING TO RUN: {overlap} listed as both allowed and forbidden.", file=sys.stderr)
        sys.exit(1)

    worksheet_name = os.environ.get("WORKSHEET_NAME", "Master")
    file_path = os.environ["MS_FILE_PATH"]

    token = get_token()
    site_id = get_site_id(token)
    values = get_used_range(token, site_id, file_path, worksheet_name)

    if not values or len(values) < 2:
        print("No data rows returned from the sheet -- refusing to overwrite existing file.", file=sys.stderr)
        sys.exit(1)

    headers = values[0]
    data_rows = values[1:]
    rows = []
    for raw_row in data_rows:
        padded = list(raw_row) + [None] * (len(headers) - len(raw_row))
        rows.append(dict(zip(headers, padded)))

    lat_col = find_column(headers, LAT_COLUMN_CANDIDATES)
    lon_col = find_column(headers, LON_COLUMN_CANDIDATES)
    geo_col = find_column(headers, GEO_COLUMN_CANDIDATES)

    if not (lat_col and lon_col) and not geo_col:
        print(
            f"Could not find latitude/longitude columns, nor a WKT geolocation "
            f"column, among headers: {headers}",
            file=sys.stderr,
        )
        sys.exit(1)

    affiliate_col = find_column(headers, AFFILIATE_COLUMN_CANDIDATES)
    if not affiliate_col:
        print(
            f"WARNING: no column matching {AFFILIATE_COLUMN_CANDIDATES} found in "
            f"headers -- '{AFFILIATE_OUTPUT_KEY}' will be null for every feature. "
            f"Headers seen: {headers}",
            file=sys.stderr,
        )

    features = []
    skipped_no_coords = 0
    skipped_no_name = 0
    skipped_lib_level = 0

    for i, row in enumerate(rows):
        lat = lon = None

        if lat_col and lon_col:
            try:
                lat = float(row[lat_col])
                lon = float(row[lon_col])
            except (TypeError, ValueError):
                lat = lon = None

        if (lat is None or lon is None) and geo_col:
            m = WKT_POINT_RE.search(str(row.get(geo_col) or ""))
            if m:
                lon, lat = float(m.group(1)), float(m.group(2))

        if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            skipped_no_coords += 1
            continue

        church_name = str(row.get("church_name") or "").strip()
        if not church_name:
            skipped_no_name += 1
            continue

        lib_level = parse_lib_level(row.get("lib_level"))
        if lib_level not in PUBLISHED_LIB_LEVELS:
            skipped_lib_level += 1
            continue

        properties = build_properties(row, affiliate_col)
        properties["lib_level"] = lib_level

        features.append({
            "id": str(i),
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": properties,
        })

    geojson = {"type": "FeatureCollection", "features": features}

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(geojson, f, indent=2)
        f.write("\n")

    print(
        f"Wrote {len(features)} features to {OUTPUT_PATH} "
        f"({skipped_no_coords} skipped for missing/invalid coordinates, "
        f"{skipped_no_name} skipped for missing church_name, "
        f"{skipped_lib_level} skipped for lib_level not in {sorted(PUBLISHED_LIB_LEVELS)})."
    )


if __name__ == "__main__":
    main()
