# DO NOT INCLUDE IN PRODUCTION.
# THIS IS A TEMPORARY TOOL TO CONVERT THE XLSX CHURCH LIST TO GeoJSON.
# pandas, openpyxl, geopandas, and shapely are needed to run this.

import json

import pandas as pd
import geopandas as gpd
from shapely import wkt

# Read the Excel file
df = pd.read_excel("PCUSA_Congregations.xlsx")

# Convert the invalid geolocation value to a missing value
df["geolocation"] = df["geolocation"].replace("(POINT: None  None)", None)

# Convert WKT strings to Shapely geometries
df["geometry"] = df["geolocation"].apply(
    lambda x: wkt.loads(x) if pd.notna(x) else None
)

# Create a GeoDataFrame
gdf = gpd.GeoDataFrame(
    df,
    geometry="geometry",
    crs="EPSG:4326"
)

# Remove the original geolocation column
gdf = gdf.drop(columns=["geolocation"])

# Convert to GeoJSON
geojson = gdf.to_json()

# Pretty-print the GeoJSON
with open("PCUSA_Congregations.geojson", "w", encoding="utf-8") as f:
    json.dump(
        json.loads(geojson),
        f,
        indent=2,
        ensure_ascii=False
    )