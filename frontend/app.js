import { londonTime, isStale, isPredictionStale, currentPredictions, arrivalTiming, lineCondition, safeColor, escapeHTML as e } from './lib.mjs';
import { RouteStore, visibleLines, networkSummary } from './network.mjs';
import { routeBounds, distinctPaths, AutoFrame, spacedStations, stationLabels } from './map.mjs';
import { stationIndex, searchStations, favouriteKey, readFavourites, parseView, viewHash } from './explorer.mjs';

const $ = id => document.getElementById(id);
const state = { config: null, lines: [], linesEnvelope: null, mode: 'all', lineId: null, route: null, routeEnvelope: null, stationId: null, arrivals: null, lineSearch: '', stationSearch: '', routeLoading: false, arrivalLoading: false, routeError: '', arrivalError: '', lineError: '', routeSeq: 0, arrivalSeq: 0, lineSeq: 0, arrivalController: null, demo: false, mapView: 'network', mapArea: 'england', networkRoutes: new Map(), networkErrors: new Map(), networkPending: new Set(), hiddenLines: new Set(), stationScope: 'all', index: [], favourites: [], restoring: false, navigationSeq: 0 };
const modeNames = { tube: 'Underground', dlr: 'DLR', overground: 'Overground', 'elizabeth-line': 'Elizabeth line', 'national-rail': 'National Rail', tram: 'Tram' };
let map, routeLayers, networkLayers, stationLayers, tileFailures = 0;
const autoFrame = new AutoFrame();
let programmaticCamera = false;
const markers = new Map();
const networkGroups = new Map();
const favouritesStorage = 'london-transit-live:favourites:v1';
try { state.favourites = readFavourites(localStorage.getItem(favouritesStorage)); } catch { /* Storage is optional. */ }

async function request(url, signal) {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error.slice(0, 300) : `The data service returned ${response.status}. Please try again.`);
  if (!result || typeof result !== 'object') throw new Error('The data service returned an unreadable response.');
  return result;
}

const routes = new RouteStore(async id => {
  const result = await request(`/api/lines/${encodeURIComponent(id)}/route`);
  if (!result.data || !Array.isArray(result.data.stations) || !Array.isArray(result.data.paths)) throw new Error('Route information is unavailable.');
  return result;
});

function mappedLines() { return visibleLines(state.lines, state.mode).filter(item => !state.hiddenLines.has(item.id)); }
function filteredLines() { return visibleLines(state.lines, state.mode).filter(item => item.name.toLowerCase().includes(state.lineSearch.toLowerCase())); }
function refreshIndex() { state.index = stationIndex(state.lines, state.networkRoutes); renderStations(); }

function renderNetworkProgress() {
  const summary = networkSummary(mappedLines(), state.networkRoutes, state.networkErrors);
  const loading = mappedLines().some(item => state.networkPending.has(item.id));
  $('network-progress').hidden = state.mapView !== 'network';
  $('network-progress-text').textContent = `${summary.loaded} of ${summary.total} routes${loading ? ' · Loading…' : ''}${summary.failed ? ` · ${summary.failed} unavailable` : ''}${summary.stale ? ` · ${summary.stale} saved routes` : ''}`;
  $('retry-network').hidden = !summary.failed;
  $('retry-network').disabled = loading;
  if (state.mapView === 'network') {
    $('map-loading').hidden = Boolean(summary.loaded);
    if (!summary.total) $('map-loading').innerHTML = empty('No routes selected.', 'Tick a service in the service overview to show it on the map.');
    if (!summary.loaded && summary.total) $('map-loading').innerHTML = loading
      ? '<span class="spinner" aria-hidden="true"></span><span>Loading network routes…</span>'
      : empty('Network routes are unavailable.', 'Use Retry missing routes above to reconnect.');
    $('fit-route').disabled = !networkLayers?.getLayers().length;
  }
}

function ensureNetworkRoutes(retry = false) {
  for (const item of state.lines) {
    if (state.networkPending.has(item.id) || routes.peek(item.id) || (!retry && state.networkErrors.has(item.id))) continue;
    state.networkPending.add(item.id);
    state.networkErrors.delete(item.id);
    routes.get(item.id).then(result => {
      state.networkRoutes.set(item.id, result); state.networkErrors.delete(item.id); noteSource(result);
    }).catch(error => {
      state.networkErrors.set(item.id, error.message);
      const saved = state.networkRoutes.get(item.id);
      if (saved) state.networkRoutes.set(item.id, { ...saved, stale: true });
    }).finally(() => {
      state.networkPending.delete(item.id); refreshIndex();
      if (state.mapView === 'network') { drawNetwork(); renderNetworkProgress(); }
      tryAutoFrame();
    });
  }
  renderNetworkProgress();
}

function drawNetwork() {
  if (!map || !networkLayers) return;
  const visible = new Set(mappedLines().map(item => item.id));
  const focused = visible.has(state.lineId);
  const crowded = visible.size > 8;
  for (const [id, entry] of networkGroups) if (!visible.has(id)) { networkLayers.removeLayer(entry.group); networkGroups.delete(id); }
  if (state.mapView !== 'network') return;
  for (const item of mappedLines()) {
    const envelope = state.networkRoutes.get(item.id);
    if (!envelope) continue;
    let entry = networkGroups.get(item.id);
    if (!entry || entry.envelope !== envelope || entry.color !== item.color) {
      if (entry) networkLayers.removeLayer(entry.group);
      entry = { envelope, color: item.color, group: L.featureGroup(), strokes: [] };
      for (const path of distinctPaths(envelope.data.paths)) {
        if (path.length < 2) continue;
        const casing = L.polyline(path, { color: '#fff', weight: 7, opacity: .94, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(entry.group);
        const stroke = L.polyline(path, { color: safeColor(item.color), weight: 4, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(entry.group);
        const label = document.createElement('span'); label.textContent = `${item.name}${envelope.stale ? ' · saved route' : ''}`;
        stroke.bindTooltip(label, { sticky: true }).on('click', () => chooseService(item.id));
        entry.strokes.push({ casing, stroke });
      }
      entry.group.addTo(networkLayers); networkGroups.set(item.id, entry);
    }
    const selected = item.id === state.lineId;
    for (const { casing, stroke } of entry.strokes) {
      casing.setStyle({ weight: selected ? 10 : crowded ? 5 : 7, opacity: focused && !selected ? .38 : .96 });
      stroke.setStyle({ weight: selected ? 5.5 : crowded ? 2.5 : 4, opacity: focused && !selected ? .25 : .95 });
    }
  }
  networkGroups.get(state.lineId)?.group.bringToFront();
  if (visible.has(state.lineId)) routeLayers.addTo(map); else routeLayers.remove();
  drawStationMarkers();
  $('fit-route').disabled = !networkLayers.getLayers().length;
}

function setMapView(view, { frame = true, writeHistory = true } = {}) {
  cancelRestoration();
  if (view === state.mapView) { if (frame) requestAutoFrame(); return; }
  state.mapView = view;
  [...$('map-view-controls').querySelectorAll('button')].forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  $('fit-route').textContent = view === 'network' ? 'Fit visible routes' : 'Fit selected line';
  if (networkLayers) { if (view === 'network') networkLayers.addTo(map); else networkLayers.remove(); }
  drawRoute(); renderRouteHeading();
  if (view === 'network') { ensureNetworkRoutes(); drawNetwork(); renderNetworkProgress(); }
  else {
    renderNetworkProgress();
    $('map-loading').hidden = Boolean(state.route);
    if (!state.route) $('map-loading').innerHTML = state.routeLoading ? empty('Loading route and stations…') : state.routeError ? empty('The route could not be loaded.', state.routeError, 'route') : empty('Choose a line.', 'Select a line from the service overview.');
    $('fit-route').disabled = !routeLayers?.getLayers().length;
  }
  if (frame) requestAutoFrame();
  if (writeHistory) saveView();
}

function announce(message) { $('announcer').textContent = message; }
function line() { return state.lines.find(item => item.id === state.lineId); }
function station() { return state.route?.stations?.find(item => item.id === state.stationId); }
function modeName(id) { return state.config?.modes?.find(item => item.id === id)?.name || modeNames[id] || id; }
function noteSource(envelope) {
  if (envelope?.source === 'demo' || state.config?.demo) state.demo = true;
  $('demo-banner').hidden = !state.demo;
}
function restoreFocus(container, key, render) {
  const focused = container.contains(document.activeElement) ? document.activeElement?.dataset?.[key] : null;
  render();
  if (focused) [...container.querySelectorAll('button, input')].find(button => button.dataset[key] === focused)?.focus({ preventScroll: true });
}
function empty(message, detail = '', retry = '') {
  return `<div class="empty-state"><p>${e(message)}</p>${detail ? `<span>${e(detail)}</span>` : ''}${retry ? `<button class="retry-button" type="button" data-retry="${retry}">Try again</button>` : ''}</div>`;
}

function clearSelection() {
  state.arrivalController?.abort();
  ++state.routeSeq; ++state.arrivalSeq;
  Object.assign(state, { lineId: null, route: null, routeEnvelope: null, stationId: null, arrivals: null, routeLoading: false, arrivalLoading: false, routeError: '', arrivalError: '',  });
  routeLayers?.clearLayers(); markers.clear();
  $('fit-route').disabled = true;
  $('route-title').textContent = 'London’s rail network';
  $('route-subtitle').textContent = 'No lines are currently available.';
  $('route-status').hidden = true;
  $('map-caption').textContent = 'NO ROUTE SELECTED';
  $('map-loading').hidden = false;
  $('map-loading').innerHTML = empty('No lines are currently reported.', 'The network will refresh automatically.');
  renderStations(); renderArrivals();
  if (state.mapView === 'network') { drawNetwork(); renderRouteHeading(); renderNetworkProgress(); }
}

function renderModes() {
  const modes = state.config?.modes?.length ? state.config.modes : [...new Set(state.lines.map(item => item.mode))].map(id => ({ id, name: modeName(id) }));
  $('mode-filters').innerHTML = [{ id: 'all', name: 'All supported rail' }, ...modes].map(mode => `<button type="button" class="mode-button" data-mode="${e(mode.id)}" aria-pressed="${state.mode === mode.id}">${e(mode.name)}</button>`).join('');
}

function renderLines() {
  const filtered = filteredLines();
  $('line-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'SERVICE' : 'SERVICES'}`;
  restoreFocus($('line-list'), 'focusKey', () => {
    if (!filtered.length) { $('line-list').innerHTML = empty(state.lineError || 'No matching lines.', state.lineError ? 'The network could not be loaded.' : 'Try another name or transport mode.', state.lineError ? 'lines' : ''); return; }
    const groups = [...new Set(filtered.map(item => item.mode))];
    $('line-list').innerHTML = groups.map(mode => `<div class="line-group-title">${e(modeName(mode))}</div>` + filtered.filter(item => item.mode === mode).map(item => {
      const condition = lineCondition(item);
      return `<div class="service-row"><label class="layer-toggle"><input type="checkbox" data-layer="${e(item.id)}" data-focus-key="layer-${e(item.id)}" ${state.hiddenLines.has(item.id) ? '' : 'checked'} aria-label="Show ${e(item.name)} on network map" /></label><button type="button" class="line-button" data-focus-key="line-${e(item.id)}" data-line="${e(item.id)}" style="--line:${safeColor(item.color)}" aria-pressed="${item.id === state.lineId}"><span class="line-swatch" aria-hidden="true"></span><span class="line-copy"><span class="line-name">${e(item.name)}</span><span class="line-condition"><span class="status-dot ${condition.type}" aria-hidden="true"></span>${e(condition.text)}</span></span><span class="line-chevron" aria-hidden="true">›</span></button></div>`;
    }).join('')).join('');
  });
  const stale = !state.linesEnvelope || Boolean(state.lineError) || isStale(state.linesEnvelope, Date.now(), 150000);
  $('network-health').classList.toggle('stale', stale);
  $('network-updated').textContent = state.linesEnvelope ? `${stale ? 'Saved status' : state.demo ? 'Sample status' : 'Status updated'} · ${londonTime(state.linesEnvelope.fetchedAt)}` : state.lineError ? 'Network unavailable' : 'Connecting to data service';
  $('network-updated').title = state.lineError || state.linesEnvelope?.error || '';
  renderRouteHeading();
}

function renderRouteHeading() {
  const selected = state.mapView === 'line' || mappedLines().some(item => item.id === state.lineId) ? line() : null;
  if (state.mapView === 'network') {
    $('route-title').textContent = 'Rail network';
    $('route-subtitle').textContent = `${mappedLines().length} ${mappedLines().length === 1 ? 'service' : 'services'} shown${selected && mappedLines().some(item => item.id === selected.id) ? ` · ${selected.name} highlighted` : ''}`;
    $('map-caption').textContent = `${state.demo ? 'SAMPLE NETWORK' : 'NETWORK VIEW'}${selected ? ` / ${selected.name.toUpperCase()}` : ''}`;
  }
  if (!selected) { $('route-status').hidden = true; if (state.mapView === 'line') { $('route-title').textContent = 'Choose a line'; $('route-subtitle').textContent = 'Select a line from the service overview.'; $('map-caption').textContent = 'LINE VIEW'; } return; }
  const color = safeColor(selected.color);
  document.documentElement.style.setProperty('--line', color);
  if (state.mapView === 'line') $('route-title').textContent = selected.name;
  const count = state.route?.stations?.length;
  if (state.mapView === 'line') $('route-subtitle').textContent = `${modeName(selected.mode)}${count != null ? ` · ${count} stations` : ''}${state.routeEnvelope?.stale ? ' · Saved route' : ''}`;
  const condition = lineCondition(selected);
  const stale = Boolean(state.lineError) || isStale(state.linesEnvelope, Date.now(), 150000);
  const reasons = [...new Set((selected.statuses || []).map(item => item.reason).filter(Boolean))];
  $('route-status').hidden = false;
  $('route-status').className = `route-status ${stale ? 'stale' : condition.type}`;
  const nationalCoverage = selected.mode === 'national-rail' ? '<p class="coverage-note">TfL route coverage may be incomplete. This is not a complete operator timetable.</p>' : '';
  $('route-status').innerHTML = `<p><strong>${e(selected.name)} · ${stale ? 'Saved status · ' : ''}${e(condition.text)}</strong>${state.demo ? ' <span>— sample data</span>' : ''}</p>${reasons.map(reason => `<p>${/^https:\/\/(www\.)?(nationalrail\.co\.uk|tfl\.gov\.uk)\//.test(reason) ? `<a href="${e(reason)}" target="_blank" rel="noopener noreferrer">View disruption details ↗</a>` : e(reason)}</p>`).join('')}${stale ? '<p>Status updates are unavailable or out of date.</p>' : ''}${nationalCoverage}<p class="coverage-note">${state.routeLoading ? 'Map: loading' : state.routeError ? 'Map: unavailable' : state.route ? 'Map: available' : 'Map: not loaded'} · Status: ${stale ? 'saved' : 'reported'} · Boards: ${selected.boardProvider === 'national-rail' ? state.config?.nationalRailConfigured ? 'National Rail connected' : 'National Rail not connected' : 'TfL predictions where available'}</p>`;
  if (state.mapView === 'line') $('map-caption').textContent = `${selected.name.toUpperCase()} / ${state.demo ? 'SAMPLE ROUTE' : 'ROUTE VIEW'}`;
}

async function loadLines(initial = false) {
  const seq = ++state.lineSeq;
  try {
    const result = await request('/api/lines');
    if (seq !== state.lineSeq) return;
    if (!Array.isArray(result.data)) throw new Error('Line information is unavailable.');
    state.lines = result.data;
    state.linesEnvelope = result;
    state.lineError = result.error || '';
    noteSource(result);
    if (state.lineId && !state.lines.some(item => item.id === state.lineId)) clearSelection();
    if (initial) renderModes();
    renderLines(); refreshIndex(); ensureNetworkRoutes();
    if (state.mapView === 'network') drawNetwork();
    if (!state.lineId && state.lines.length && state.mapView === 'line' && !state.restoring) {
      const candidates = state.mode === 'all' ? state.lines : state.lines.filter(item => item.mode === state.mode);
      const first = candidates.find(item => item.id === 'elizabeth') || candidates[0] || state.lines[0];
      if (state.mode !== 'all' && first.mode !== state.mode) { state.mode = 'all'; renderModes(); }
      await selectLine(first.id);
    } else if (!state.lines.length) clearSelection();
  } catch (error) {
    if (seq !== state.lineSeq) return;
    state.lineError = error.message || 'Unable to load line status.';
    renderLines();
    if (initial) { $('map-loading').innerHTML = empty('The network is unavailable.', 'Use “Try again” in the service overview to reconnect.'); announce('The rail network could not be loaded.'); }
  }
}

function initializeMap() {
  if (!window.L) { $('map').parentElement.classList.add('map-disabled'); $('map-loading').innerHTML = empty('Map unavailable.', 'You can still choose stations and view arrivals from the station list.'); return; }
  map = L.map('map', { zoomControl: true, scrollWheelZoom: false, zoomSnap: .25, zoomDelta: .5, minZoom: 4, maxZoom: 18, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).fitBounds([[49.85, -5.9], [55.82, 1.85]], { padding: [15, 15], animate: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19, className: 'quiet-basemap' }).on('tileerror', () => { tileFailures++; if (tileFailures >= 2) $('tile-notice').hidden = false; }).addTo(map);
  networkLayers = L.featureGroup().addTo(map);
  routeLayers = L.featureGroup().addTo(map);
  stationLayers = L.featureGroup().addTo(routeLayers);
  map.on('moveend zoomend', drawStationMarkers);
  const explore = () => { if (!programmaticCamera) { cancelRestoration(); autoFrame.cancel(); $('map-fit-note').textContent = 'Free explore · change services to fit again'; } };
  map.on('dragstart', explore);
  $('map').addEventListener('pointerdown', explore);
  $('map').addEventListener('wheel', explore, { passive: true });
  $('map').addEventListener('keydown', event => { if (['+', '-', '=', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) || (['Enter', ' '].includes(event.key) && event.target.closest('.leaflet-control-zoom'))) explore(); });
  new ResizeObserver(() => { map.invalidateSize({ animate: false }); tryAutoFrame(); drawStationMarkers(); }).observe($('map'));
}

function drawRoute() {
  markers.clear();
  if (!map) { $('map-loading').innerHTML = empty('Map unavailable.', 'Choose a station from the list to see its arrivals.'); return; }
  routeLayers.clearLayers(); stationLayers.clearLayers(); stationLayers.addTo(routeLayers);
  const color = safeColor(line()?.color);
  routeLayers.addTo(map);
  const paths = state.mapView === 'line' ? distinctPaths(state.route?.paths) : [];
  for (const path of paths) L.polyline(path, { color: '#fff', weight: 10, opacity: 1, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayers);
  for (const path of paths) L.polyline(path, { color, weight: 5.5, opacity: 1, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayers);
  if (state.mapView === 'network' && !mappedLines().some(item => item.id === state.lineId)) routeLayers.remove();
  drawStationMarkers();
  $('fit-route').disabled = !routeBounds(state.route ? [state.route] : []);
  $('map-loading').hidden = true;
  if (state.mapView === 'line' && !routeBounds(state.route ? [state.route] : [])) { $('map-loading').hidden = false; $('map-loading').innerHTML = empty('No route geometry is available.', 'Use the station list to explore this line.'); }
}

function drawStationMarkers() {
  if (!map || !stationLayers) return;
  stationLayers.clearLayers(); markers.clear();
  if (!state.route || (state.mapView === 'network' && !mappedLines().some(item => item.id === state.lineId))) return;
  const size = map.getSize(), zoom = map.getZoom();
  if (!size.x || !size.y) return;
  const points = state.route.stations.filter(stop => Number.isFinite(stop.lat) && Number.isFinite(stop.lon)).map(stop => {
    const point = map.latLngToContainerPoint([stop.lat, stop.lon]);
    return { ...stop, x: point.x, y: point.y };
  });
  const visible = spacedStations(points, state.stationId, { width: size.x, height: size.y, gap: zoom < 9 ? 28 : 17 });
  const labels = stationLabels(visible, state.stationId, { width: size.x, height: size.y, zoom });
  for (const stop of visible) {
    const selected = stop.id === state.stationId;
    const marker = L.marker([stop.lat, stop.lon], { icon: stationIcon(selected, zoom), zIndexOffset: selected ? 1000 : 0, title: `${stop.name}: show arrivals`, alt: `${stop.name}: show arrivals`, keyboard: false }).addTo(stationLayers);
    const tooltip = document.createElement('span'); tooltip.textContent = stop.name.replace(/ (Rail|Underground|DLR) Station$/, '');
    const direction = labels.get(stop.id);
    marker.bindTooltip(tooltip, { permanent: Boolean(direction), direction: direction || 'top', offset: direction ? [direction === 'left' ? -9 : 9, 0] : [0, -6], className: direction ? `station-name-label${selected ? ' selected-label' : ''}` : '', opacity: 1 });
    marker.on('click', () => selectStation(stop.id, true));
    markers.set(stop.id, marker);
  }
}

function stationIcon(selected, zoom = map?.getZoom() || 10) {
  const size = selected ? 16 : zoom < 9 ? 7 : 10;
  return L.divIcon({ className: '', html: `<span class="station-marker${selected ? ' selected' : ''}" style="--marker-color:${safeColor(line()?.color)};width:${size}px;height:${size}px"></span>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}
function mapFrame() {
  const ids = state.mapView === 'line' ? state.lineId ? [state.lineId] : [] : mappedLines().map(item => item.id).sort();
  return { key: `${state.mapView}:${ids.join(',')}`, bounds: routeBounds(ids.map(id => state.networkRoutes.get(id)?.data)), pending: ids.some(id => state.networkPending.has(id) || (id === state.lineId && state.routeLoading) || (!state.networkRoutes.has(id) && !state.networkErrors.has(id) && !(id === state.lineId && state.routeError))) };
}
function applyMapBounds(bounds) {
  if (!map || !bounds) return;
  map.invalidateSize({ animate: false });
  const small = map.getSize().x < 500;
  programmaticCamera = true;
  map.fitBounds(bounds, { paddingTopLeft: small ? [28, 35] : [48, 40], paddingBottomRight: small ? [28, 65] : [48, 65], maxZoom: 14, animate: false });
  programmaticCamera = false;
}
function requestAutoFrame({ writeHistory = true } = {}) {
  if (writeHistory) saveView();
  autoFrame.request(mapFrame().key);
  $('map-fit-note').textContent = state.mapView === 'line' ? 'Fitting the selected line' : 'Fitting visible routes';
  tryAutoFrame();
}
function tryAutoFrame() {
  if (!map || !autoFrame.intent || state.restoring || $('map').clientWidth < 20 || $('map').clientHeight < 20) return;
  const target = mapFrame(), bounds = autoFrame.take(target.key, target.bounds, target.pending);
  if (bounds) { applyMapBounds(bounds); saveView(true); }
  if (!autoFrame.intent) $('map-fit-note').textContent = 'Zoom follows service changes';
}
function fitRoute() {
  autoFrame.cancel();
  applyMapBounds(mapFrame().bounds);
  $('map-fit-note').textContent = 'Zoom follows service changes';
}

async function selectLine(id, { restoring = false, writeHistory = true } = {}) {
  if (!state.lines.some(item => item.id === id)) return false;
  if (!restoring) { state.restoring = false; ++state.navigationSeq; }
  if (id === state.lineId && state.route && !state.routeError) { renderLines(); renderStations(); drawNetwork(); renderNetworkProgress(); if (!restoring && writeHistory) requestAutoFrame(); if (writeHistory) saveView(); return true; }
  state.arrivalController?.abort();
  const seq = ++state.routeSeq; ++state.arrivalSeq;
  state.lineId = id; state.route = null; state.routeEnvelope = null; state.stationId = null; state.arrivals = null; state.routeLoading = true; state.arrivalLoading = false; state.routeError = ''; state.arrivalError = '';
  routeLayers?.clearLayers(); markers.clear(); $('fit-route').disabled = true;
  renderLines(); renderStations(); renderArrivals(); if (!restoring && writeHistory) requestAutoFrame(); if (writeHistory) saveView();
  if (state.mapView === 'line') { $('map-loading').hidden = false; $('map-loading').innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Loading route and stations…</span>'; }
  else { drawNetwork(); renderNetworkProgress(); }
  try {
    const result = await routes.get(id, { priority: true });
    if (seq !== state.routeSeq) return;
    if (!result.data || !Array.isArray(result.data.stations)) throw new Error('Station information is unavailable.');
    state.route = result.data; state.routeEnvelope = result; state.routeLoading = false;
    state.networkRoutes.set(id, result); state.networkErrors.delete(id);
    noteSource(result); refreshIndex(); renderRouteHeading(); drawRoute();
    tryAutoFrame();
    if (writeHistory) saveView(true);
    if (state.mapView === 'network') { drawNetwork(); renderNetworkProgress(); }
    announce(`${line()?.name || 'Line'} selected. ${result.data.stations.length} stations available.`);
    return true;
  } catch (error) {
    if (error.name === 'AbortError' || seq !== state.routeSeq) return;
    state.routeLoading = false; state.routeError = error.message || 'Unable to load the route.';
    if (state.mapView === 'line') $('map-loading').innerHTML = empty('The route could not be loaded.', state.routeError, 'route');
    renderStations(); tryAutoFrame(); announce('The route could not be loaded.');
  }
}

function renderStations() {
  const scope = state.stationScope;
  $('stations-heading').textContent = scope === 'favourites' ? 'Saved stations' : scope === 'line' && line() ? `${line().name} stations` : 'Find a station';
  $('station-search').disabled = false;
  const loaded = networkSummary(state.lines, state.networkRoutes, state.networkErrors);
  $('search-coverage').textContent = scope === 'favourites' ? 'Saved on this device. Choose a service to reopen its board.' : `Search covers ${loaded.loaded} of ${loaded.total} supported routes${state.networkPending.size ? ' · Loading more…' : ''}${loaded.failed ? ` · ${loaded.failed} unavailable` : ''}. National route coverage may be incomplete.`;
  $('retry-search').hidden = !loaded.failed;
  let matches = searchStations(state.index, state.stationSearch);
  if (scope === 'line') matches = matches.map(stop => ({ ...stop, services: stop.services.filter(service => service.lineId === state.lineId) })).filter(stop => stop.services.length);
  if (scope === 'favourites') {
    const known = new Map(state.index.flatMap(stop => stop.services).map(service => [favouriteKey(service), service]));
    matches = state.favourites.map(saved => known.get(favouriteKey(saved)) || saved).filter(item => item.name.toLowerCase().includes(state.stationSearch.toLowerCase())).map(item => ({ id: favouriteKey(item), name: item.name, services: [item] }));
  }
  $('station-count').textContent = String(matches.length);
  restoreFocus($('station-list'), 'choice', () => {
    if (scope === 'line' && state.routeLoading) { $('station-list').innerHTML = empty('Loading stations…'); return; }
    if (scope === 'line' && state.routeError) { $('station-list').innerHTML = empty('Stations unavailable.', 'Retry the route to reconnect.', 'route'); return; }
    if (scope === 'line' && !state.lineId) { $('station-list').innerHTML = empty('Choose a line or operator.', 'Or switch to All stations to search the network.'); return; }
    if (scope === 'all' && !state.stationSearch.trim()) { $('station-list').innerHTML = empty('Where are you heading?', 'Search a station name across London and the supported national network. Map filters do not limit search.'); return; }
    if (!matches.length) { $('station-list').innerHTML = empty(scope === 'favourites' ? 'No saved stations match.' : 'No matching stations loaded.', scope === 'favourites' ? 'Open a station board and choose Save station.' : 'Try another name. More results may appear as routes load.'); return; }
    $('station-list').innerHTML = matches.slice(0, 60).map(stop => `<article class="station-result"><h3>${e(stop.name)}</h3>${stop.services.map(service => {
      const selected = service.stationId === state.stationId && service.lineId === state.lineId;
      return `<div class="station-choice"><button type="button" class="station-button" data-choice="${e(favouriteKey(service))}" data-station="${e(service.stationId)}" data-service="${e(service.lineId)}" aria-pressed="${selected}" aria-label="${e(stop.name)} via ${e(service.lineName)}"><span class="station-dot" aria-hidden="true"></span><span>${e(service.lineName)}</span><span class="station-arrow" aria-hidden="true">↗</span></button>${scope === 'favourites' ? `<button class="remove-favourite" type="button" data-remove-favourite="${e(favouriteKey(service))}" aria-label="Remove ${e(stop.name)} via ${e(service.lineName)} from saved stations">×</button>` : ''}</div>`;
    }).join('')}</article>`).join('') + (matches.length > 60 ? '<p class="empty-copy">Showing the first 60 matches. Refine your search for more stations.</p>' : '');
  });
}

async function openStation(lineId, stationId) {
  state.restoring = false;
  const selected = state.lines.find(item => item.id === lineId);
  if (!selected) { showViewMessage('This saved service is no longer available. Choose another station.'); return; }
  if (state.mode !== 'all' && state.mode !== selected.mode) state.mode = 'all';
  state.hiddenLines.delete(lineId); renderModes();
  ++state.navigationSeq;
  // selectLine starts a fresh navigation; capture its sequence after calling it.
  const pending = selectLine(lineId, { writeHistory: false }); const navigation = state.navigationSeq;
  const loaded = await pending;
  if (navigation !== state.navigationSeq || state.lineId !== lineId) return;
  if (!loaded) { showViewMessage('This station’s route could not be loaded. Please retry the route.'); return; }
  if (!state.route.stations.some(stop => stop.id === stationId)) { showViewMessage('This saved station is no longer listed on that service. Choose another station.'); return; }
  $('view-message').hidden = true; drawNetwork(); renderLines();
  await selectStation(stationId);
}

async function selectStation(id, fromMap = false, restoring = false) {
  if (!state.route?.stations.some(stop => stop.id === id)) return;
  if (!restoring) { state.restoring = false; ++state.navigationSeq; }
  showPanel('board');
  if (id === state.stationId) { saveView(); return; }
  autoFrame.cancel();
  state.arrivalController?.abort(); ++state.arrivalSeq;
  state.stationId = id; state.arrivals = null; state.arrivalError = ''; state.arrivalLoading = true;
  const stop = station();
  if (map && stop && !fromMap && !restoring) map.setView([stop.lat, stop.lon], Math.max(map.getZoom(), 12), { animate: false });
  drawStationMarkers();
  renderStations(); renderArrivals(); saveView(); announce(`${station()?.name || 'Station'} selected. Loading arrivals.`);
  await loadArrivals();
}

async function loadArrivals() {
  if (!state.stationId || !line() || state.arrivals?.availability) return;
  state.arrivalController?.abort();
  const seq = ++state.arrivalSeq; const stationId = state.stationId; const lineId = state.lineId;
  const firstBoard = state.arrivalLoading && !state.arrivals;
  const controller = new AbortController(); state.arrivalController = controller;
  try {
    const query = new URLSearchParams({ lineId, mode: line().mode });
    const result = await request(`/api/stations/${encodeURIComponent(stationId)}/arrivals?${query}`, controller.signal);
    if (seq !== state.arrivalSeq || stationId !== state.stationId || lineId !== state.lineId) return;
    if (!Array.isArray(result.data)) throw new Error('Arrival information is unavailable.');
    state.arrivals = result; state.arrivalLoading = false; state.arrivalError = result.error || '';
    noteSource(result); renderArrivals();
    if (firstBoard) announce(result.availability ? result.message : `${currentPredictions(result.data).length} predictions loaded for ${station()?.name || 'this station'}.`);
  } catch (error) {
    if (error.name === 'AbortError' || seq !== state.arrivalSeq) return;
    state.arrivalLoading = false; state.arrivalError = error.message || 'Unable to load arrivals.';
    if (state.arrivals) state.arrivals = { ...state.arrivals, stale: true };
    renderArrivals();
    if (firstBoard) announce(`Predictions are unavailable for ${station()?.name || 'this station'}.`);
  }
}

function renderArrivals() {
  restoreFocus($('arrivals-list'), 'retry', renderArrivalsContent);
}

function renderArrivalsContent() {
  const selected = station();
  $('save-station').hidden = !selected;
  const saved = state.favourites.some(item => favouriteKey(item) === favouriteKey(state));
  $('save-station').textContent = saved ? '★ Saved on this device' : '☆ Save station';
  $('save-station').setAttribute('aria-pressed', String(saved));
  $('board-label').textContent = line()?.boardProvider === 'national-rail' ? 'NATIONAL RAIL DEPARTURES' : 'NEXT ARRIVALS';
  $('arrivals-heading').textContent = selected?.name || 'Choose a station';
  $('arrivals-subtitle').textContent = selected ? line()?.boardProvider === 'national-rail' ? 'National Rail · All operators at this station' : `${line()?.name || 'Selected line'} · All destinations` : 'Arrival predictions for your selected line.';
  $('arrival-notice').hidden = true; $('arrivals-updated').textContent = '';
  if (!selected) { $('arrival-source').textContent = '—'; $('arrival-source').className = 'source-chip'; $('arrivals-list').innerHTML = empty('Choose a station.', 'Select a station from the list or map.'); return; }
  if (state.arrivalLoading && !state.arrivals) { $('arrival-source').textContent = 'LOADING'; $('arrivals-list').innerHTML = '<div class="empty-state"><span class="spinner" aria-hidden="true"></span><p>Checking the next arrivals…</p></div>'; return; }
  if (state.arrivals?.availability) {
    $('arrival-source').textContent = state.arrivals.availability === 'not-configured' ? 'NOT CONNECTED' : 'UNAVAILABLE';
    $('arrival-source').className = 'source-chip stale';
    $('board-label').textContent = 'NATIONAL RAIL DEPARTURES';
    $('arrivals-list').innerHTML = empty(state.arrivals.message, 'The route and station map remain available.') + '<p class="board-link"><a href="https://www.nationalrail.co.uk/live-trains/" target="_blank" rel="noopener noreferrer">Check National Rail live departures ↗</a></p>';
    if (state.arrivals.crs) $('arrivals-updated').textContent = `Station code: ${state.arrivals.crs}`;
    return;
  }
  const remaining = state.arrivals ? currentPredictions(state.arrivals.data) : [];
  const stale = state.arrivals && (isStale(state.arrivals) || remaining.some(item => isPredictionStale(item, state.arrivals)));
  const demo = state.arrivals?.source === 'demo' || state.config?.demo;
  $('arrival-source').textContent = stale ? (demo ? 'SAVED DEMO' : 'SAVED') : demo ? 'DEMO' : state.arrivals ? 'LIVE' : 'UNAVAILABLE';
  $('arrival-source').className = `source-chip ${stale ? 'stale' : demo ? 'demo' : ''}`;
  if (state.arrivalError || stale) {
    $('arrival-notice').hidden = false;
    $('arrival-notice').textContent = stale ? 'Saved predictions and schedules show their original expected times instead of a live countdown.' : 'Arrival predictions are temporarily unavailable.';
  }
  if (!state.arrivals) { $('arrivals-list').innerHTML = empty('Arrivals unavailable.', state.arrivalError, 'arrivals'); return; }
  const boardTime = state.arrivals.providerTimestamp || state.arrivals.fetchedAt;
  if (Number.isFinite(Date.parse(boardTime))) $('arrivals-updated').textContent = `${stale ? 'Last update' : demo ? 'Sample generated' : 'Updated'} ${londonTime(boardTime, { second: '2-digit' })} · London time${document.hidden ? ' · Updates paused' : ''}`;
  const arrivals = remaining.sort((a, b) => Date.parse(a.expectedArrival) - Date.parse(b.expectedArrival)).slice(0, 12);
  if (!arrivals.length) { $('arrivals-list').innerHTML = empty(stale ? 'No current predictions remain in the saved data.' : 'No predictions currently reported.', 'This may be a terminus, outside service hours, or a gap in prediction coverage.'); return; }
  const hasDepartures = arrivals.some(item => item.eventType === 'departure');
  $('board-label').textContent = state.arrivals.source === 'national-rail' ? 'NATIONAL RAIL DEPARTURES' : hasDepartures ? 'ARRIVALS & DEPARTURES' : 'NEXT ARRIVALS';
  $('arrivals-list').innerHTML = arrivals.map(arrival => {
    const timing = arrivalTiming(arrival, state.arrivals);
    return `<article class="arrival-row"><div><p class="arrival-destination">${e(arrival.destination || 'Destination not reported')}</p><p class="arrival-details"><span class="arrival-line">${e(arrival.lineName || line()?.name || '')}</span><br>${arrival.eventType === 'departure' ? 'Departs' : 'Arrives'}${arrival.platform ? ` · ${e(arrival.platform)}` : ''}</p></div><div class="arrival-timing"><p class="arrival-time${timing.small ? ' small' : ''}">${e(timing.value)}</p><p class="arrival-time-label">${e(timing.label)}</p></div></article>`;
  }).join('');
}

function chooseService(id) {
  setMapView('line', { frame: false, writeHistory: false });
  state.hiddenLines.delete(id); state.stationScope = 'line'; $('station-scope').value = 'line';
  state.stationSearch = ''; $('station-search').value = '';
  void selectLine(id); showPanel('map');
}
function cancelRestoration() { state.restoring = false; ++state.navigationSeq; }
function showViewMessage(message) {
  $('view-message').hidden = false; $('view-message').textContent = message; announce(message);
}
function showPanel(panel) {
  document.body.dataset.panel = panel;
  for (const button of $('mobile-navigation').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.panel === panel));
  if (matchMedia('(max-width: 700px)').matches) {
    const heading = $(panel === 'stations' ? 'stations-heading' : panel === 'board' ? 'arrivals-heading' : panel === 'services' ? 'network-heading' : 'route-title');
    heading.focus({ preventScroll: true });
    if (panel === 'map') requestAnimationFrame(() => { map?.invalidateSize({ animate: false }); tryAutoFrame(); drawStationMarkers(); });
  }
}
function saveView(replace = false) {
  if (state.restoring || !state.lines.length) return;
  const center = map?.getCenter();
  const hash = viewHash(state, center ? { lat: center.lat, lon: center.lng, zoom: map.getZoom() } : null);
  if (hash !== location.hash) history[replace ? 'replaceState' : 'pushState'](null, '', hash);
}
async function restoreView() {
  const requested = parseView(location.hash); const navigation = ++state.navigationSeq;
  autoFrame.cancel();
  state.restoring = true; $('view-message').hidden = true;
  clearSelection();
  Object.assign(state, { mode: requested.mode, mapArea: requested.mapArea, hiddenLines: requested.hiddenLines });
  state.mapView = requested.mapView;
  renderModes(); renderLines();
  for (const button of $('map-view-controls').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.view === state.mapView));
  $('fit-route').textContent = state.mapView === 'network' ? 'Fit visible routes' : 'Fit selected line';
  if (networkLayers) state.mapView === 'network' ? networkLayers.addTo(map) : networkLayers.remove();
  if (requested.lineId) {
    if (!state.lines.some(item => item.id === requested.lineId)) showViewMessage('The service in this link is unavailable. Choose another service or station.');
    else {
      const loaded = await selectLine(requested.lineId, { restoring: true });
      if (navigation !== state.navigationSeq) return;
      if (requested.stationId && loaded) {
        if (state.route.stations.some(stop => stop.id === requested.stationId)) void selectStation(requested.stationId, false, true);
        else showViewMessage('The station in this link is no longer listed on that service. Choose another station.');
      }
    }
  }
  if (navigation !== state.navigationSeq) return;
  if (map) {
    if (requested.camera) map.setView([requested.camera.lat, requested.camera.lon], requested.camera.zoom, { animate: false });
    else if (state.mapArea === 'london') map.setView([51.5074, -.1278], 11, { animate: false });
    else map.fitBounds([[49.85, -5.9], [55.82, 1.85]], { animate: false });
  }
  drawNetwork(); renderRouteHeading(); renderNetworkProgress();
  if (!state.stationId) showPanel('map');
  if (state.mapView === 'line' && !state.route) { $('map-loading').hidden = false; $('map-loading').innerHTML = empty(state.routeError || 'Choose a line.', 'Use Services to select a route.'); }
  state.restoring = false;
  if (!requested.camera && (state.mapView === 'line' || state.mapArea !== 'london')) requestAutoFrame({ writeHistory: false });
  else $('map-fit-note').textContent = requested.camera ? 'Saved map view · change services to fit again' : 'London overview';
}
function persistFavourites() {
  try { localStorage.setItem(favouritesStorage, JSON.stringify({ version: 1, items: state.favourites })); return true; }
  catch { showViewMessage('Your browser could not save stations on this device. They remain available until this page is closed.'); return false; }
}
$('save-station').addEventListener('click', () => {
  const stop = station(), service = line(); if (!stop || !service) return;
  const key = favouriteKey(state), saved = state.favourites.some(item => favouriteKey(item) === key);
  if (saved) state.favourites = state.favourites.filter(item => favouriteKey(item) !== key);
  else {
    if (state.favourites.length >= 50) { showViewMessage('You have 50 saved stations. Remove one before saving another.'); return; }
    state.favourites.push({ stationId: stop.id, lineId: service.id, name: stop.name, lineName: service.name });
  }
  const persisted = persistFavourites(); renderArrivals(); renderStations(); if (persisted) announce(saved ? 'Station removed from saved stations.' : 'Station saved on this device.');
});
$('copy-view').addEventListener('click', async () => {
  cancelRestoration(); autoFrame.cancel(); saveView(true);
  try { await navigator.clipboard.writeText(location.href); announce('View link copied. This site remains private.'); $('copy-feedback').textContent = 'Link copied · Access remains private'; }
  catch { $('view-link-field').hidden = false; $('view-link').value = location.href; $('view-link').focus(); $('view-link').select(); $('copy-feedback').textContent = 'Copy the selected link'; }
});
$('mobile-navigation').addEventListener('click', event => { const panel = event.target.closest('[data-panel]')?.dataset.panel; if (panel) { if (state.restoring) cancelRestoration(); showPanel(panel); } });
document.querySelector('.skip-link').addEventListener('click', event => { event.preventDefault(); if (state.restoring) cancelRestoration(); showPanel('stations'); $('station-search').focus(); });
$('retry-search').addEventListener('click', () => ensureNetworkRoutes(true));
window.addEventListener('hashchange', restoreView);
window.addEventListener('storage', event => { if (event.key === favouritesStorage) { state.favourites = readFavourites(event.newValue); renderStations(); renderArrivals(); } });

$('mode-filters').addEventListener('click', event => {
  const button = event.target.closest('[data-mode]'); if (!button) return;
  cancelRestoration(); state.mode = button.dataset.mode; setMapView('network', { frame: false, writeHistory: false }); renderModes(); renderLines(); drawNetwork(); renderNetworkProgress(); requestAutoFrame(); saveView();
});
$('line-search').addEventListener('input', event => { state.lineSearch = event.target.value; renderLines(); });
$('station-search').addEventListener('input', event => { state.stationSearch = event.target.value; renderStations(); });
$('station-scope').addEventListener('change', event => { state.stationScope = event.target.value; renderStations(); });
$('line-list').addEventListener('click', event => { const button = event.target.closest('[data-line]'); if (button) chooseService(button.dataset.line); });
$('line-list').addEventListener('change', event => { const id = event.target.dataset.layer; if (!id) return; cancelRestoration(); event.target.checked ? state.hiddenLines.delete(id) : state.hiddenLines.add(id); setMapView('network', { frame: false, writeHistory: false }); drawNetwork(); renderNetworkProgress(); renderRouteHeading(); requestAutoFrame(); saveView(); });
$('layer-actions').addEventListener('click', event => { const action = event.target.closest('[data-layers]')?.dataset.layers; if (!action) return; cancelRestoration(); for (const item of filteredLines()) action === 'show' ? state.hiddenLines.delete(item.id) : state.hiddenLines.add(item.id); setMapView('network', { frame: false, writeHistory: false }); renderLines(); drawNetwork(); renderNetworkProgress(); requestAutoFrame(); saveView(); });
$('station-list').addEventListener('click', event => {
  const remove = event.target.closest('[data-remove-favourite]');
  if (remove) { state.favourites = state.favourites.filter(item => favouriteKey(item) !== remove.dataset.removeFavourite); persistFavourites(); renderStations(); renderArrivals(); return; }
  const button = event.target.closest('[data-station]'); if (button) openStation(button.dataset.service, button.dataset.station);
});
$('fit-route').addEventListener('click', () => { cancelRestoration(); fitRoute(); saveView(); });
$('map-area-controls').addEventListener('click', event => {
  const area = event.target.closest('[data-area]')?.dataset.area; if (!area) return;
  cancelRestoration(); autoFrame.cancel(); state.mapArea = area;
  if (state.mapView !== 'network') setMapView('network', { frame: false, writeHistory: false });
  if (map) { if (area === 'london') map.setView([51.5074, -0.1278], 11, { animate: false }); else map.fitBounds([[49.85, -5.9], [55.82, 1.85]], { padding: [15, 15], animate: false }); }
  $('map-fit-note').textContent = area === 'london' ? 'London overview' : 'England overview';
  renderRouteHeading(); saveView();
});
$('map-view-controls').addEventListener('click', event => { const view = event.target.closest('[data-view]')?.dataset.view; if (view) setMapView(view); });
$('retry-network').addEventListener('click', () => ensureNetworkRoutes(true));
document.addEventListener('click', event => {
  const retry = event.target.closest('[data-retry]')?.dataset.retry;
  if (retry === 'lines') loadLines(true);
  if (retry === 'route') { state.routeError = 'retry'; selectLine(state.lineId); }
  if (retry === 'arrivals') { state.arrivalLoading = true; renderArrivals(); loadArrivals(); }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { loadLines(); if (state.stationId) loadArrivals(); updateClock(); renderArrivals(); }
});
function updateClock() { $('london-clock').textContent = londonTime(); }

async function start() {
  const bootNavigation = state.navigationSeq; state.restoring = true;
  initializeMap(); updateClock();
  try { state.config = await request('/api/config'); noteSource(null); renderModes(); if (state.config.attribution) $('data-attribution').textContent = state.config.attribution; }
  catch { $('global-error').hidden = false; $('global-error').textContent = 'App settings could not be loaded. Available network data will still be shown.'; }
  renderStations(); renderArrivals();
  await loadLines(true);
  if (state.navigationSeq === bootNavigation) await restoreView();
  else state.restoring = false;
  ensureNetworkRoutes();
  setInterval(() => { if (!document.hidden) loadLines(); }, 60000);
  setInterval(() => { if (!document.hidden && state.stationId) loadArrivals(); }, 20000);
  setInterval(() => { if (!document.hidden) { updateClock(); if (state.arrivals) renderArrivals(); } }, 15000);
}
start();
