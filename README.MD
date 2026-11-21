# Run Instructions

To run this map, open terminal to whatever directory you copied it, and type `python3 -m http.server 8000`.
Then, go to your browser and type the URL: http://localhost:8000 to see the PC(USA) map.

# Layout

- `index.html`, `app.js`, `styles.css` and `theme.js` (applies a saved light/dark choice before the page draws) are the whole site. There's no build step: the page loads `data/PCUSA_Congregations.geojson` (kept current by the SharePoint sync workflow) and filters it in the browser.
- The sidebar holds search, "near me", rating and affiliate filters, and a list of the churches in view. On phones it becomes a bottom sheet you can drag up.
- Church links (`?church=<id>`) use a short hash of the church's name and address, so they keep working when the sync reorders rows. They change if a church's name or address changes.
- Everything shown comes from the SharePoint sheet (via the sync) or is PftK's own wording.
- Churches rated 2 or 3 are published. A church with any other rating is also published when its `map_override` cell (column AB) is TRUE: it appears as "Included by PftK", without its rating, which stays private.
- Searching a ZIP code, or a town with no listed church (or with a state, like "Dayton OH"), shows the churches nearest it. The ZIP and town locations in `data/places/` come from the US Census Bureau's public-domain Gazetteer files. They're only used to place a search, and a search downloads only the one small file it needs. Rebuild them with `python scripts/build_places.py <gazetteer_dir>` when the Census publishes a new year.
- `data/PCUSA_Congregations.geojson` is written compactly, one church per line, so it loads faster and a change to one church is a one-line diff.
- After each sync, `scripts/check_locations.py` checks every pin against its address's ZIP and town and lists any that are more than 25 miles off on the workflow run's summary page. Run it locally with `python scripts/check_locations.py > location-report.csv`.
- When you change `app.js`, `styles.css` or `theme.js`, bump the `?v=` number on all three links in `index.html`. Otherwise returning visitors can get the old file from their browser's cache for a while.
- `og-image.png` is the link preview image for Facebook, iMessage, Slack and similar. Regenerate it with `python scripts/make_og_image.py` (needs Pillow) after big data changes.
- `banner.jpg` is the "Finding a Congregation" header image on pftk.org/map. Regenerate it with `python scripts/make_banner.py` (needs Pillow), then upload it to that strip in the Wix editor by hand. Its overlay looks best at about 20%.

# Visit counts

The map sends anonymous counts to GoatCounter (no cookies, no personal data). The dashboard is at https://pftk-map.goatcounter.com. Counting only runs on map.pftk.org, never on a local copy.

What's counted, each at most once per visit:
- The map being opened, directly (`/`) or inside the pftk.org embed (`/embed`), with the site it came from.
- Opening a shared church link, opening a church, and its Directions, Website and Share buttons (by church name and town).
- Searching, and whether it was by ZIP code, town or church name. What was typed is never sent.
- The location request on open: allowed, refused, refused on an earlier visit, not found, or not supported. The location itself is never sent. Taps on Near me.

The total number of visits (direct plus embed) is shown under "About the ratings". It comes from GoatCounter's public counter, which needs "Allow using the visitor counter" switched on in GoatCounter's settings; if that's off, the line stays hidden.

Staff can stop their own visits being counted by opening `https://map.pftk.org/#skip-count` once in each browser they use; `#count-me` turns counting back on. `#count-debug` logs each count to the browser console instead of sending it.

The GoatCounter site code is `pftk-map`. If it ever changes, update `COUNT_URL` in `app.js` and the two `goatcounter.com` addresses in the security policy at the top of `index.html`.
