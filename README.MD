# Run Instructions

To run this map, open terminal to whatever directory you copied it, and type `python3 -m http.server 8000`.
Then, go to your browser and type the URL: http://localhost:8000 to see the PC(USA) map.

To instead visit the seminary map, go to http://localhost:8000/seminary-map.html in your browser.
# Layout

- `index.html`, `app.js` and `styles.css` are the whole site. There's no build step: the page loads `data/PCUSA_Congregations.geojson` (kept current by the SharePoint sync workflow) and filters it in the browser.
- The sidebar holds search, "near me", rating and affiliate filters, and a list of the churches in view. On phones it becomes a bottom sheet you can drag up.
- Church links (`?church=<id>`) use a short hash of the church's name and address, so they keep working when the sync reorders rows. They change if a church's name or address changes.
- `seminary-map.html` now redirects to the main map with the seminary layer on (`?seminaries=1`).
- `og-image.png` is the link preview image for Facebook, iMessage, Slack and similar. Regenerate it with `python scripts/make_og_image.py` (needs Pillow) after big data changes.
