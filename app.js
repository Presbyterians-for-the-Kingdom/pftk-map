'use strict';

const map = L.map('map').setView([39.5, -98.35], 5);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  maxNativeZoom: 14,          // ← this is the key line for less detail
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  updateWhenIdle: false,
  updateWhenZooming: true,
  referrerPolicy: 'strict-origin-when-cross-origin',   // ← required

}).addTo(map);

const churchIcon = L.icon({
  iconUrl: 'denominational-seals/presby.png',
  iconSize: [34, 34],
  iconAnchor: [17, 34],
  popupAnchor: [0, -32],
  className: 'presby-marker'
});

const clusters = L.markerClusterGroup({
  maxClusterRadius: 45,
  disableClusteringAtZoom: 11,
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  animate: true,
  animateAddingMarkers: false,
  chunkedLoading: true,
  iconCreateFunction: function (cluster) {
    const count = cluster.getChildCount();
    let size = 'small';
    if (count >= 100) size = 'large';
    else if (count >= 25) size = 'medium';
    return L.divIcon({
      html: '<div><span>' + count + '</span></div>',
      className: 'marker-cluster marker-cluster-' + size,
      iconSize: L.point(40, 40)
    });
  }
});

let clusterUpdateTimer;

map.on('zoomend moveend', function () {
  clearTimeout(clusterUpdateTimer);

  clusterUpdateTimer = setTimeout(function () {
    // Forces MarkerCluster to re-evaluate the current view
    clusters.refreshClusters();
  }, 300); // ← change this number (ms). 250–400 feels good
});

// Escapes all HTML-significant characters. Attributes below are always
// double-quoted, so escaping the double quote (and, defensively, the
// single quote) closes off every injection route through this function.
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only ever returns an http(s) URL or ''. Using the URL parser (rather than
// a prefix regex) means schemes like "javascript:" or "data:" can't sneak
// through no matter how they're formatted, and malformed input safely
// degrades to "no link" instead of a best-effort guess.
function safeHttpUrl(input) {
  if (!input) return '';
  const candidate = /^https?:\/\//i.test(input) ? input : 'https://' + input;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  return parsed.href;
}

// Conservative email allowlist. If a record ever contained something
// mailto-syntax-legal but unexpected (e.g. an embedded "?" that appends
// headers), it's rejected rather than rendered as a live link.
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
function safeMailto(email) {
  if (!email || !EMAIL_RE.test(email)) return '';
  return 'mailto:' + encodeURIComponent(email).replace(/%40/g, '@');
}

const sizeMap = { XS: 'Extra Small', S: 'Small', M: 'Medium', L: 'Large', XL: 'Extra Large' };
function sizeLabel(sz) {
  return sizeMap[sz] || sz;
}

function buildPopup(c, lat, lon) {
  const addr1 = c.address_line_1 ? esc(c.address_line_1) : '';
  const addr2 = [c.address_city, c.address_state].filter(Boolean).join(', ') + (c.address_zip ? ' ' + c.address_zip : '');
  const addressParts = [addr1, addr2 ? esc(addr2) : ''].filter(Boolean).join('<br>');

  const rowsParts = [];
  if (c.presbytery) rowsParts.push(`<tr><td class="label">Presbytery</td><td>${esc(c.presbytery)}</td></tr>`);
  if (c.pastor) rowsParts.push(`<tr><td class="label">Pastor</td><td>${esc(c.pastor)}</td></tr>`);

  if (c.size) rowsParts.push(
    `<tr><td class="label">Size</td><td>${esc(sizeLabel(c.size))}</td></tr>`
  );
  if (c.phone) rowsParts.push(`<tr><td class="label">Phone</td><td>${esc(c.phone)}</td></tr>`);

  const mailto = safeMailto(c.email);
  if (mailto) {
    rowsParts.push(`<tr><td class="label">Email</td><td><a href="${esc(mailto)}">${esc(c.email)}</a></td></tr>`);
  } else if (c.email) {
    rowsParts.push(`<tr><td class="label">Email</td><td>${esc(c.email)}</td></tr>`);
  }

  const website = safeHttpUrl(c.url);
  if (website) {
    rowsParts.push(
      `<tr><td class="label">Website</td><td><a href="${esc(website)}" target="_blank" rel="noopener noreferrer">${esc(c.url)}</a></td></tr>`
    );
  }

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const mapsUrl = safeHttpUrl(c.google_maps_url) || safeHttpUrl(
      'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lon
    );
    if (mapsUrl) {
      rowsParts.push(
        `<tr><td class="label">Directions</td><td><a href="${esc(mapsUrl)}" target="_blank" rel="noopener noreferrer">Google Maps</a></td></tr>`
      );
    }
  }

  let html = `<div class="church-popup">
      <h3>${esc(c.church_name)}</h3>
      <p class="addr">${addressParts}</p>
      <table>${rowsParts.join('')}</table>`;

  if (c.notes_public) {
    html += `<div class="note">${esc(c.notes_public)}</div>`;
  }

  html += `</div>`;
  return html;
}

// Validates a GeoJSON Feature: well-formed Point geometry plus the
// properties buildPopup() relies on. Coordinates are [lon, lat] per the
// GeoJSON spec, so the range check is applied to the correct axis.
function isValidChurchFeature(f) {
  if (!f || typeof f !== 'object' || f.type !== 'Feature') return false;

  const geom = f.geometry;
  if (!geom || typeof geom !== 'object' || geom.type !== 'Point') return false;

  const coords = geom.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return false;
  const [lon, lat] = coords;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return false;
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return false;

  const props = f.properties;
  if (!props || typeof props !== 'object') return false;
  if (typeof props.church_name !== 'string') return false;

  return true;
}

fetch('data/PCUSA_Congregations.geojson')
  .then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  })
  .then(data => {
    if (!data || typeof data !== 'object' || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
      throw new Error('unexpected response shape');
    }

    const markers = [];
    for (const feature of data.features) {
      if (!isValidChurchFeature(feature)) continue;
      const [lon, lat] = feature.geometry.coordinates;
      const c = feature.properties;
      const marker = L.marker([lat, lon], { icon: churchIcon });
      marker.bindPopup(() => buildPopup(c, lat, lon), { maxWidth: 320 });
      markers.push(marker);
    }
    clusters.addLayers(markers);
    map.addLayer(clusters);
    const el = document.getElementById('status');
    el.textContent = markers.length.toLocaleString() + ' PC(USA) churches';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
  })
  .catch(err => {
    document.getElementById('status').textContent = 'Failed to load church data.';
    console.error(err);
  });
