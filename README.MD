# Run Instructions

To run this map, open terminal to whatever directory you copied it, and type `python3 -m http.server 8000`.
Then, go to your browser and type the URL: http://localhost:8000 to see the PC(USA) map.

# Layout

- `index.html`, `app.js`, `styles.css` and `theme.js` (applies a saved light/dark choice before the page draws) are the whole site. There's no build step: the page loads `data/PCUSA_Congregations.geojson` (kept current by the SharePoint sync workflow) and filters it in the browser.
- The sidebar holds search, "near me", rating and affiliate filters, and a list of the churches in view. On phones it becomes a bottom sheet you can drag up.
- Church links (`?church=<id>`) use a short hash of the church's name and address, so they keep working when the sync reorders rows. They change if a church's name or address changes.
- Everything shown comes from the SharePoint sheet (via the sync) or is PftK's own wording.
- Searching a ZIP code, or a town with no listed church (or with a state, like "Dayton OH"), shows the churches nearest it. The ZIP and town locations in `data/places/` come from the US Census Bureau's public-domain Gazetteer files. They're only used to place a search, and a search downloads only the one small file it needs. Rebuild them with `python scripts/build_places.py <gazetteer_dir>` when the Census publishes a new year.
- `data/PCUSA_Congregations.geojson` is written compactly, one church per line, so it loads faster and a change to one church is a one-line diff.
- After each sync, `scripts/check_locations.py` checks every pin against its address's ZIP and town and lists any that are more than 25 miles off on the workflow run's summary page. Run it locally with `python scripts/check_locations.py > location-report.csv`.
- When you change `app.js`, `styles.css` or `theme.js`, bump the `?v=` number on all three links in `index.html`. Otherwise returning visitors can get the old file from their browser's cache for a while.
- `og-image.png` is the link preview image for Facebook, iMessage, Slack and similar. Regenerate it with `python scripts/make_og_image.py` (needs Pillow) after big data changes.
