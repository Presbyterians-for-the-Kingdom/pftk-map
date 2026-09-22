#!/usr/bin/env python3
"""
Pulls congregation data from the private "Master" worksheet in an Excel
workbook stored on SharePoint/OneDrive (via Microsoft Graph) and rebuilds
data/PCUSA_Congregations.geojson, keeping ONLY the public-safe columns.

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
granted "read" access to this one SharePoint site (see the setup notes --
this is the Microsoft equivalent of sharing a Google Sheet with a service
account instead of making the whole Drive public).
"""

import json
import os
import re
import sys

import requests
import msal

# --- Config -----------------------------------------------------------

ALLOWED_COLUMNS = [
    "church_name",
    "address_line_1",
    "address_city",
    "address_state",
    "address_zip",
    "presbytery",
    "pastor",
    "size",
    "phone",
    "email",
    "url",
    "google_maps_url",
    "notes_public",
    "lib_level",
    "confidence",
    "date_of_review",
    "responsible",
    "removed",
    "orgs",
    "pftk",
]

# Columns the sheet is expected to have but that must NEVER be published.

FORBIDDEN_COLUMNS = [
    "notes_private",
]

LAT_COLUMN_CANDIDATES = ["latitude", "lat"]
LON_COLUMN_CANDIDATES = ["longitude", "lon", "lng"]
# Fallback: a single WKT-style column, e.g. "POINT (-81.79 36.63)" (lon lat),
# which is how PCUSA_MAP_TEST.xlsx stores coordinates today.
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
    # Path-based addressing straight to the worksheet's used range --
    # no need to look up a separate drive-item ID first.
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
        # Pad ragged rows so zip() doesn't silently drop trailing columns.
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

    features = []
    skipped = 0
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

        if lat is None or lon is None:
            skipped += 1
            continue

        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            skipped += 1
            continue

        church_name = str(row.get("church_name") or "").strip()
        if not church_name:
            skipped += 1
            continue

        properties = {}
        for col in ALLOWED_COLUMNS:
            value = row.get(col, "")
            properties[col] = value if value not in ("", None) else None

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

    print(f"Wrote {len(features)} features to {OUTPUT_PATH} ({skipped} rows skipped).")


if __name__ == "__main__":
    main()
