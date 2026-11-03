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
  new ResizeObserver(() => {
    map.invalidateSize();
    if (!fitted && map.getSize().x > 0) {
      fitted = true;
      // A linked church sets its own view once data loads.
      if (!params.get('church')) map.fitBounds(US_BOUNDS, mapPadding());
    }
  }).observe($('map'));

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
      const n = cluster.getChildCount();
      const tier = n >= 100 ? 'l' : n >= 20 ? 'm' : 's';
      const px = tier === 'l' ? 46 : tier === 'm' ? 40 : 34;
      return L.divIcon({
        html: n,
        className: 'cluster cluster-' + tier,
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
      // Puerto Rico ZIPs arrive without their leading zeros ("PR 901").
      const m = address.match(/,\s*([A-Z]{2})\s+(\d{3,5})/);
      const state = m ? m[1] : '';
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

    const isDefault = !filters.tokens.length && !filters.affiliatesOnly &&
      allRatingsChecked();
    $('reset').hidden = isDefault;

    if (fit && visible.length && visible.length < churches.length) {
      const bounds = L.latLngBounds(visible.map((c) => [c.lat, c.lon]));
      map.flyToBounds(bounds, Object.assign({ maxZoom: 12, duration: 0.6 }, mapPadding()));
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
    const origin = userLoc || (searching ? null : { lat: map.getCenter().lat, lon: map.getCenter().lng });
    if (origin) {
      for (const c of items) c.dist = milesBetween(origin, c);
      items = items.slice().sort((a, b) => a.dist - b.dist);
    }

    const n = items.length;
    let label;
    if (searching) label = n === 1 ? '1 match' : n.toLocaleString() + ' matches';
    else label = (n === 1 ? '1 church' : n.toLocaleString() + ' churches') + ' in view';
    if (userLoc && n) label += ', nearest first';
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
      const dist = userLoc ? `<span class="result-dist">${c.dist < 10 ? c.dist.toFixed(1) : Math.round(c.dist)} mi</span>` : '<span></span>';
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

  // ---------- Controls ----------

  let searchTimer;
  $('search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      filters.tokens = normalize(e.target.value).trim().split(' ').filter(Boolean);
      applyFilters(filters.tokens.length > 0);
    }, 150);
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
      userLoc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (userMarker) userMarker.setLatLng([userLoc.lat, userLoc.lon]);
      else {
        userMarker = L.circleMarker([userLoc.lat, userLoc.lon], {
          radius: 8, weight: 3, color: '#fff', fillColor: '#3d7bff', fillOpacity: 1
        }).bindTooltip('You are here').addTo(map);
      }
      const nearest = visible.slice().sort((a, b) => milesBetween(userLoc, a) - milesBetween(userLoc, b)).slice(0, 6);
      const bounds = L.latLngBounds([[userLoc.lat, userLoc.lon]]);
      for (const c of nearest) bounds.extend([c.lat, c.lon]);
      map.flyToBounds(bounds, Object.assign({ maxZoom: 13, duration: 0.8 }, mapPadding()));
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
