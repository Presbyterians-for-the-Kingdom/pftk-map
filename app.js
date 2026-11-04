'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  const mobileQuery = window.matchMedia('(max-width: 760px)');
  const params = new URLSearchParams(location.search);

  const LIST_LIMIT = 150;
  const RATING_LABELS = { 3: 'Great fit', 2: 'Good fit', 1: 'Moderate' };
  const STATES = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
    CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
    HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
    KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
    MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
    NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
    NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
    OR: 'Oregon', PA: 'Pennsylvania', PR: 'Puerto Rico', RI: 'Rhode Island', SC: 'South Carolina',
    SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
    WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming'
  };

  // ---------- Safe output helpers ----------

  function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Only ever returns an http(s) URL or ''. Parsing (rather than a prefix
  // regex) means "javascript:" or "data:" can't sneak through.
  function safeHttpUrl(input) {
    if (!input) return '';
    const candidate = /^https?:\/\//i.test(input) ? input : 'https://' + input;
    try {
      const url = new URL(candidate);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  }

  function displayHost(url) {
    try {
      return new URL(url).host.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  function directionsUrl(c) {
    return safeHttpUrl(c.maps) ||
      'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(c.name + ', ' + (c.address || c.lat + ',' + c.lon));
  }

  function normalize(s) {
    return ' ' + String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  }

  function milesBetween(a, b) {
    const R = 3958.8;
    const toRad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toRad;
    const dLon = (b.lon - a.lon) * toRad;
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  let toastTimer;
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  // ---------- Map ----------

  const map = L.map('map', {
    zoomControl: false,
    worldCopyJump: true,
    minZoom: 3,
    zoomSnap: 0.5
  });
  L.control.zoom({ position: 'topright' }).addTo(map);

  // Light/dark switch under the zoom buttons. theme.js applies a saved
  // choice on load; with none saved, the device setting decides.
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M11 1h2v4h-2zM11 19h2v4h-2zM1 11h4v2H1zM19 11h4v2h-4zM4.2 5.6l1.4-1.4 2.8 2.8-1.4 1.4zM15.6 17l1.4-1.4 2.8 2.8-1.4 1.4zM17 8.4l-1.4-1.4 2.8-2.8 1.4 1.4zM5.6 19.8l-1.4-1.4L7 15.6 8.4 17z"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 2.5a9.5 9.5 0 1 0 7 15.9A8 8 0 0 1 14.5 2.5Z"/></svg>';
  function isDark() {
    const chosen = document.documentElement.dataset.theme;
    return chosen ? chosen === 'dark' : darkQuery.matches;
  }
  const ThemeControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const bar = L.DomUtil.create('div', 'leaflet-bar');
      const btn = L.DomUtil.create('a', 'theme-btn', bar);
      btn.href = '#';
      btn.setAttribute('role', 'button');
      const draw = () => {
        const dark = isDark();
        btn.innerHTML = dark ? SUN : MOON;
        btn.title = dark ? 'Light mode' : 'Dark mode';
        btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      };
      draw();
      darkQuery.addEventListener('change', draw);
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(btn, 'click', (e) => {
        L.DomEvent.preventDefault(e);
        const next = isDark() ? 'light' : 'dark';
        // Picking what the device already uses clears the choice, so the
        // map follows the device again if its setting later changes.
        const followDevice = (next === 'dark') === darkQuery.matches;
        if (followDevice) delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = next;
        try {
          if (followDevice) localStorage.removeItem('pftk-theme');
          else localStorage.setItem('pftk-theme', next);
        } catch (err) {
          // Storage blocked: the choice lasts for this visit.
        }
        draw();
      });
      return bar;
    }
  });
  new ThemeControl().addTo(map);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  const US_BOUNDS = [[24.5, -124.8], [49.4, -66.9]];

  // Leaves room for the map controls and, on phones, the sheet.
  function mapPadding() {
    return mobileQuery.matches
      ? { paddingTopLeft: [16, 60], paddingBottomRight: [16, 190] }
      : { paddingTopLeft: [32, 64], paddingBottomRight: [32, 32] };
  }

  // fitBounds on a zero-size container (hidden iframe, background tab)
  // zooms to max, so the first fit waits until the map has real dimensions.
  map.setView([38.5, -96.5], 4);
  let fitted = false;
  let pendingFit = null;
  new ResizeObserver(() => {
    map.invalidateSize();
    if (map.getSize().x === 0) return;
    if (pendingFit) {
      // A search made while the map was hidden.
      map.fitBounds(pendingFit.bounds, Object.assign({ maxZoom: pendingFit.maxZoom }, mapPadding()));
      pendingFit = null;
      fitted = true;
    } else if (!fitted) {
      fitted = true;
      // A linked church sets its own view once data loads.
      if (!params.get('church')) map.fitBounds(US_BOUNDS, mapPadding());
    }
  }).observe($('map'));

  // Flying a zero-size map (a hidden embed) throws, so the move waits
  // until the map is shown.
  function flyToFit(bounds, maxZoom, duration) {
    if (map.getSize().x === 0) {
      pendingFit = { bounds, maxZoom };
      return;
    }
    map.flyToBounds(bounds, Object.assign({ maxZoom, duration }, mapPadding()));
  }

  map.createPane('affiliates');
  map.getPane('affiliates').style.zIndex = 640;

  const icons = {};
  function iconFor(c) {
    const key = c.affiliate ? 'aff' : 'r' + (c.rating || 0);
    if (!icons[key]) {
      icons[key] = c.affiliate
        ? L.icon({ iconUrl: 'denominational-seals/pftk.png', iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -14], className: 'pin pin-aff' })
        : L.icon({ iconUrl: 'denominational-seals/presby.png', iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -11], className: 'pin pin-' + key });
    }
    return icons[key];
  }

  const clusters = L.markerClusterGroup({
    maxClusterRadius: 50,
    disableClusteringAtZoom: 12,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    chunkedLoading: true,
    iconCreateFunction(cluster) {
      // Area grows with the count (diameter with its square root), so a
      // cluster of 100 looks about ten times a cluster of 10, capped so
      // the biggest don't bury the map.
      const n = cluster.getChildCount();
      const px = Math.round(Math.min(72, 16 + 4.2 * Math.sqrt(n)));
      return L.divIcon({
        html: n,
        className: 'cluster ' + (px >= 52 ? 'cluster-l' : px >= 36 ? 'cluster-m' : 'cluster-s'),
        iconSize: L.point(px, px)
      });
    }
  }).addTo(map);

  // Affiliates stay unclustered, on their own pane above the clusters.
  const affiliateLayer = L.layerGroup().addTo(map);

  // ---------- Popups ----------

  function buildPopup(c) {
    const tags = [];
    if (c.affiliate) tags.push('<span class="tag aff">PftK affiliate</span>');
    if (RATING_LABELS[c.rating]) tags.push(`<span class="tag r${c.rating}">${c.rating} · ${RATING_LABELS[c.rating]}</span>`);

    const site = safeHttpUrl(c.url);
    return `<div class="pop">
      <h2>${esc(c.name)}</h2>
      ${c.address ? `<p class="pop-addr">${esc(c.address)}</p>` : ''}
      ${tags.length ? `<div class="pop-tags">${tags.join('')}</div>` : ''}
      ${site ? `<a class="pop-site" href="${esc(site)}" target="_blank" rel="noopener">${esc(displayHost(site))}</a>` : ''}
      <div class="pop-actions">
        <a class="primary" href="${esc(directionsUrl(c))}" target="_blank" rel="noopener">Directions</a>
        ${site ? `<a href="${esc(site)}" target="_blank" rel="noopener">Website</a>` : ''}
        <button type="button" data-share="${esc(c.id)}">Share</button>
      </div>
    </div>`;
  }

  const popupOptions = {
    maxWidth: 320,
    autoPanPaddingTopLeft: L.point(16, 16),
    autoPanPaddingBottomRight: L.point(16, 16)
  };

  // ---------- Data ----------

  let churches = [];
  const byId = new Map();
  let activeId = null;
  let userLoc = null;
  let userMarker = null;
  // A searched ZIP or town: { lat, lon, label }. The list then runs
  // nearest-first from it instead of filtering by text.
  let place = null;
  let placeMarker = null;

  const AFFILIATE_KEYS = ['affiliate', 'affliate', 'is_affiliate', 'pftk_affiliate'];
  function isTruthy(v) {
    return v === true || v === 1 ||
      (typeof v === 'string' && /^(1|true|yes|y|affiliate|affiliated)$/i.test(v.trim()));
  }

  // The sync numbers features by sheet row, which shifts whenever rows are
  // added, so shared links use a short hash of name and address instead.
  function stableId(name, address) {
    let h = 0x811c9dc5;
    const s = name + '|' + address;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(36);
  }

  // Coordinates are [lon, lat] per the GeoJSON spec.
  function parseChurches(geojson) {
    const out = [];
    for (const f of geojson.features) {
      const p = f && f.properties;
      const coords = f && f.geometry && f.geometry.type === 'Point' && f.geometry.coordinates;
      if (!p || typeof p.church_name !== 'string' || !Array.isArray(coords)) continue;
      const lon = coords[0], lat = coords[1];
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) continue;
      const address = typeof p.full_address === 'string' ? p.full_address.trim() : '';
      const rating = parseInt(p.lib_level, 10);
      const codes = [...address.matchAll(/,\s*([A-Z]{2})\b/g)].map((m) => m[1]).filter((code) => STATES[code]);
      const state = codes.length ? codes[codes.length - 1] : '';
      let id = stableId(p.church_name, address);
      while (byId.has(id)) id += 'x';
      const c = {
        id,
        name: p.church_name,
        lat, lon,
        rating: RATING_LABELS[rating] ? rating : null,
        address,
        url: p.url,
        maps: p.google_maps_url,
        affiliate: AFFILIATE_KEYS.some((k) => isTruthy(p[k])),
        state: state.toLowerCase(),
        haystack: normalize(p.church_name + ' ' + address + ' ' + (STATES[state] || '')),
        marker: null
      };
      const marker = L.marker([lat, lon], {
        icon: iconFor(c),
        title: c.name,
        riseOnHover: true,
        pane: c.affiliate ? 'affiliates' : 'markerPane'
      });
      marker.bindPopup(() => buildPopup(c), popupOptions);
      marker.on('popupopen', () => setActive(c.id));
      marker.on('popupclose', () => { if (activeId === c.id) setActive(null); });
      c.marker = marker;
      out.push(c);
      byId.set(c.id, c);
    }
    out.sort((x, y) => x.name.localeCompare(y.name));
    return out;
  }

  // ---------- Filtering & search ----------

  const filters = {
    ratings: new Set(['3', '2', '1']),
    affiliatesOnly: false,
    tokens: []
  };
  const allRatingsChecked = () => document.querySelectorAll('input[name="rating"]:not(:checked)').length === 0;

  function tokenMatches(c, token) {
    // Two-letter tokens that are state codes ("tx", "pa") match the state,
    // or a whole word, never a prefix: otherwise "pa" would match "Paul".
    if (token.length === 2 && STATES[token.toUpperCase()]) {
      return c.state === token || c.haystack.includes(' ' + token + ' ');
    }
    return c.haystack.includes(' ' + token);
  }

  function passes(c) {
    if (filters.affiliatesOnly && !c.affiliate) return false;
    if (RATING_LABELS[c.rating] ? !filters.ratings.has(String(c.rating)) : !allRatingsChecked()) return false;
    for (const t of filters.tokens) if (!tokenMatches(c, t)) return false;
    return true;
  }

  let visible = [];

  function applyFilters(fit) {
    visible = churches.filter(passes);
    const clustered = [];
    const pinned = [];
    for (const c of visible) (c.affiliate ? pinned : clustered).push(c.marker);

    clusters.clearLayers();
    clusters.addLayers(clustered);
    affiliateLayer.clearLayers();
    for (const m of pinned) affiliateLayer.addLayer(m);

    const isDefault = !filters.tokens.length && !place && !filters.affiliatesOnly &&
      allRatingsChecked();
    $('reset').hidden = isDefault;

    if (fit && visible.length && visible.length < churches.length) {
      const bounds = L.latLngBounds(visible.map((c) => [c.lat, c.lon]));
      flyToFit(bounds, 12, 0.6);
    }
    renderList();
  }

  // ---------- Results list ----------

  function renderList() {
    const searching = filters.tokens.length > 0;
    let items = visible;
    if (!searching) {
      const bounds = map.getBounds();
      items = visible.filter((c) => bounds.contains([c.lat, c.lon]));
    }
    const near = place || userLoc;
    const origin = near || (searching ? null : { lat: map.getCenter().lat, lon: map.getCenter().lng });
    if (origin) {
      for (const c of items) c.dist = milesBetween(origin, c);
      items = items.slice().sort((a, b) => a.dist - b.dist);
    }

    const n = items.length;
    let label;
    if (searching) label = n === 1 ? '1 match' : n.toLocaleString() + ' matches';
    else label = (n === 1 ? '1 church' : n.toLocaleString() + ' churches') + ' in view';
    if (near && n) label += place ? `, nearest to ${place.label} first` : ', nearest first';
    $('count').textContent = label;
    $('sheet-label').textContent = label;

    if (!n) {
      $('results').innerHTML = `<li class="results-empty">${searching
        ? 'No churches match your search and filters.'
        : 'No churches in this area. Zoom out or adjust the filters.'}</li>`;
      return;
    }

    const html = [];
    for (const c of items.slice(0, LIST_LIMIT)) {
      const badge = c.affiliate
        ? '<img src="denominational-seals/pftk.png" alt="PftK affiliate" width="26" height="26">'
        : `<span class="badge r${esc(c.rating)}" title="${esc(RATING_LABELS[c.rating] || '')}">${esc(c.rating || '?')}</span>`;
      const dist = near ? `<span class="result-dist">${c.dist < 10 ? c.dist.toFixed(1) : Math.round(c.dist)} mi</span>` : '<span></span>';
      html.push(`<li><button type="button" class="result${c.id === activeId ? ' is-active' : ''}" data-id="${esc(c.id)}">
        ${badge}
        <span><span class="result-name">${esc(c.name)}</span><span class="result-addr">${esc(c.address)}</span></span>
        ${dist}
      </button></li>`);
    }
    if (n > LIST_LIMIT) {
      html.push(`<li class="results-more">Showing the ${LIST_LIMIT} ${origin ? 'closest' : 'first'}. Zoom in or search to narrow the list.</li>`);
    }
    $('results').innerHTML = html.join('');
  }

  let listFrame = 0;
  function scheduleList() {
    if (filters.tokens.length) return; // search results don't depend on the viewport
    cancelAnimationFrame(listFrame);
    listFrame = requestAnimationFrame(renderList);
  }
  map.on('moveend', scheduleList);

  // ---------- Selection & URL state ----------

  function setActive(id) {
    if (activeId && byId.has(activeId)) {
      const el = byId.get(activeId).marker.getElement();
      if (el) el.classList.remove('is-active');
    }
    activeId = id;
    if (id && byId.has(id)) {
      const el = byId.get(id).marker.getElement();
      if (el) el.classList.add('is-active');
    }
    for (const el of document.querySelectorAll('.result.is-active')) el.classList.remove('is-active');
    if (id) {
      const row = document.querySelector(`.result[data-id="${CSS.escape(id)}"]`);
      if (row) row.classList.add('is-active');
    }
    setUrlParam('church', id);
  }

  function setUrlParam(name, value) {
    if (value) params.set(name, value);
    else params.delete(name);
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }

  function focusChurch(c) {
    if (mobileQuery.matches) setSheet('peek');
    if (c.affiliate) {
      map.setView([c.lat, c.lon], Math.max(map.getZoom(), 13));
      c.marker.openPopup();
    } else if (clusters.hasLayer(c.marker)) {
      clusters.zoomToShowLayer(c.marker, () => c.marker.openPopup());
    }
  }

  function shareUrl(id) {
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('church', id);
    return url.href;
  }

  async function share(id) {
    const c = byId.get(id);
    const url = shareUrl(id);
    if (navigator.share && mobileQuery.matches) {
      try {
        await navigator.share({ title: c ? c.name : 'The PftK Map', url });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch {
      window.prompt('Copy this link:', url);
    }
  }

  $('map').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-share]');
    if (btn) share(btn.getAttribute('data-share'));
  });

  $('results').addEventListener('click', (e) => {
    const btn = e.target.closest('.result');
    if (btn && byId.has(btn.dataset.id)) focusChurch(byId.get(btn.dataset.id));
  });

  // Highlights the pin while hovering its row (when the pin isn't clustered).
  $('results').addEventListener('mouseover', (e) => {
    const btn = e.target.closest('.result');
    const c = btn && byId.get(btn.dataset.id);
    const el = c && c.marker.getElement();
    if (el) el.classList.add('is-active');
  });
  $('results').addEventListener('mouseout', (e) => {
    const btn = e.target.closest('.result');
    const c = btn && byId.get(btn.dataset.id);
    const el = c && c.id !== activeId && c.marker.getElement();
    if (el) el.classList.remove('is-active');
  });

  // ---------- ZIP and town search ----------
  //
  // data/places/ holds Census ZIP and town locations (see
  // scripts/build_places.py), split into small files so a search only
  // downloads the one it needs.

  const placeFiles = new Map();
  function loadPlaces(file) {
    if (!placeFiles.has(file)) {
      placeFiles.set(file, fetch('data/places/' + file)
        .then((res) => {
          if (!res.ok) throw new Error(file + ': HTTP ' + res.status);
          return res.json();
        })
        .catch((err) => {
          console.error(err);
          placeFiles.delete(file); // let a later search retry
          return null;
        }));
    }
    return placeFiles.get(file);
  }

  // Same rules as key() in build_places.py.
  function placeKey(text) {
    return normalize(text).trim().replace(/\bsaint\b/g, 'st').replace(/\bmount\b/g, 'mt');
  }

  const STATE_KEYS = new Map(Object.entries(STATES).map(([code, name]) => [placeKey(name), code]));

  async function findZip(zip) {
    const zips = await loadPlaces('zip-' + zip[0] + '.json');
    const hit = zips && zips[zip];
    return hit ? { lat: hit[0], lon: hit[1], label: zip } : null;
  }

  // "dayton oh", "dayton, ohio", "st louis" -> the town, largest first when
  // no state is given. Returns null if the words aren't a known town.
  async function findTown(query) {
    let words = placeKey(query).split(' ').filter(Boolean);
    let state = '';
    const last = words[words.length - 1];
    if (words.length > 1 && last.length === 2 && STATES[last.toUpperCase()]) {
      state = last.toUpperCase();
      words = words.slice(0, -1);
    } else {
      for (let n = Math.min(3, words.length - 1); n >= 1 && !state; n--) {
        const code = STATE_KEYS.get(words.slice(-n).join(' '));
        if (code) {
          state = code;
          words = words.slice(0, -n);
        }
      }
    }
    const name = words.join(' ');
    if (!name || !/[a-z]/.test(name[0])) return null;
    const towns = await loadPlaces('town-' + name[0] + '.json');
    if (!towns) return null;
    const hits = towns.filter((t) => placeKey(t[0]) === name && (!state || t[1] === state));
    if (!hits.length) return null;
    // Without a state, "Springfield" could be any of a dozen: pick the one
    // with the most listed churches within 30 miles.
    const score = (t) => churches.filter((c) => milesBetween({ lat: t[2], lon: t[3] }, c) < 30).length;
    const best = hits.length === 1 ? hits[0] : hits.slice().sort((a, b) => score(b) - score(a))[0];
    return { lat: best[2], lon: best[3], label: best[0] + ', ' + best[1], others: hits.length - 1, state };
  }

  // A plain marker rather than L.circleMarker, which balloons while the
  // map animates a big zoom.
  function locationDot(className) {
    return L.divIcon({ className: 'loc-dot ' + className, iconSize: [18, 18], iconAnchor: [9, 9] });
  }

  function setPlace(next) {
    place = next;
    if (placeMarker) {
      placeMarker.remove();
      placeMarker = null;
    }
    if (!place) return;
    placeMarker = L.marker([place.lat, place.lon], { icon: locationDot('loc-place'), keyboard: false })
      .bindTooltip(place.label).addTo(map);
  }

  function flyNear(point) {
    const nearest = visible.slice().sort((a, b) => milesBetween(point, a) - milesBetween(point, b)).slice(0, 6);
    const bounds = L.latLngBounds([[point.lat, point.lon]]);
    for (const c of nearest) bounds.extend([c.lat, c.lon]);
    flyToFit(bounds, 13, 0.8);
  }

  // A 5-digit ZIP always searches by location. Other text filters churches
  // by name and address as before, and only falls back to a town when
  // nothing matches, or when a state is given ("dayton oh").
  let searchRun = 0;
  async function runSearch(value) {
    const run = ++searchRun;
    const text = value.trim();
    const tokens = normalize(text).trim().split(' ').filter(Boolean);
    let found = null;
    const zip = text.match(/^(\d{5})(?:-\d{4})?$/);
    if (zip) {
      found = await findZip(zip[1]);
      if (run !== searchRun) return;
      if (!found) toast('ZIP code not found');
    } else if (tokens.length) {
      const textHits = churches.filter((c) => tokens.every((t) => tokenMatches(c, t))).length;
      const town = await findTown(text);
      if (run !== searchRun) return;
      if (town && (!textHits || town.state)) {
        found = town;
        if (town.others && !town.state) toast(`Showing ${town.label}. Add a state for a different one.`);
      }
    }
    setPlace(found);
    filters.tokens = found ? [] : tokens;
    applyFilters(!found && tokens.length > 0);
    if (found) flyNear(found);
  }

  // ---------- Controls ----------

  let searchTimer;
  $('search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(e.target.value), 250);
  });
  $('search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = $('results').querySelector('.result');
      if (first) first.click();
      e.target.blur();
    }
  });
  $('search').addEventListener('focus', () => { if (mobileQuery.matches) setSheet('full'); });

  for (const input of document.querySelectorAll('input[name="rating"]')) {
    input.addEventListener('change', () => {
      if (input.checked) filters.ratings.add(input.value);
      else filters.ratings.delete(input.value);
      applyFilters(false);
    });
  }
  $('affiliates-only').addEventListener('change', (e) => {
    filters.affiliatesOnly = e.target.checked;
    applyFilters(e.target.checked);
  });

  $('reset').addEventListener('click', () => {
    $('search').value = '';
    searchRun++;
    setPlace(null);
    filters.tokens = [];
    filters.affiliatesOnly = false;
    $('affiliates-only').checked = false;
    for (const input of document.querySelectorAll('input[name="rating"]')) {
      input.checked = true;
      filters.ratings.add(input.value);
    }
    applyFilters(false);
  });

  $('near-me').addEventListener('click', () => {
    if (!navigator.geolocation) {
      toast('Location isn’t available in this browser');
      return;
    }
    const btn = $('near-me');
    btn.setAttribute('aria-busy', 'true');
    navigator.geolocation.getCurrentPosition((pos) => {
      btn.removeAttribute('aria-busy');
      // "Near me" replaces a ZIP or town search.
      if (place) {
        $('search').value = '';
        searchRun++;
        setPlace(null);
        applyFilters(false);
      }
      userLoc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (userMarker) userMarker.setLatLng([userLoc.lat, userLoc.lon]);
      else {
        userMarker = L.marker([userLoc.lat, userLoc.lon], { icon: locationDot('loc-you'), keyboard: false })
          .bindTooltip('You are here').addTo(map);
      }
      flyNear(userLoc);
      renderList();
    }, () => {
      btn.removeAttribute('aria-busy');
      toast('Couldn’t get your location');
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  });

  // ---------- Mobile bottom sheet ----------

  const panel = $('panel');
  function setSheet(state) {
    panel.dataset.state = state;
    $('sheet-handle').setAttribute('aria-expanded', String(state !== 'peek'));
  }
  $('sheet-handle').addEventListener('click', () => {
    setSheet(panel.dataset.state === 'peek' ? 'half' : panel.dataset.state === 'half' ? 'full' : 'peek');
  });

  let dragStartY = null;
  $('sheet-handle').addEventListener('pointerdown', (e) => { dragStartY = e.clientY; });
  window.addEventListener('pointerup', (e) => {
    if (dragStartY === null) return;
    const dy = e.clientY - dragStartY;
    dragStartY = null;
    if (Math.abs(dy) < 30) return;
    const order = ['peek', 'half', 'full'];
    const i = order.indexOf(panel.dataset.state);
    setSheet(order[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1)))]);
    // Swallow the click that follows a drag so it doesn't toggle again.
    $('sheet-handle').addEventListener('click', (ev) => ev.stopImmediatePropagation(), { capture: true, once: true });
  });
  map.on('dragstart', () => { if (mobileQuery.matches && panel.dataset.state !== 'peek') setSheet('peek'); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      map.closePopup();
      if (mobileQuery.matches) setSheet('peek');
    }
  });

  // ---------- Boot ----------

  fetch('data/PCUSA_Congregations.geojson')
    .then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then((geojson) => {
      if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
        throw new Error('unexpected data shape');
      }
      churches = parseChurches(geojson);
      if (churches.some((c) => c.rating === 1)) document.querySelector('.chip-r1').hidden = false;
      applyFilters(false);

      const linked = params.get('church');
      if (linked && byId.has(linked)) focusChurch(byId.get(linked));
      else if (linked) setActive(null);
    })
    .catch((err) => {
      console.error(err);
      $('count').textContent = 'Couldn’t load church data. Please refresh to try again.';
      $('sheet-label').textContent = 'Couldn’t load church data';
    });
})();
