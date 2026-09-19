import { londonTime, isStale, isPredictionStale, currentPredictions, arrivalTiming, lineCondition, safeColor, escapeHTML as e } from './lib.mjs';
import { RouteStore, visibleLines, networkSummary } from './network.mjs';

const $ = id => document.getElementById(id);
const state = { config: null, lines: [], linesEnvelope: null, mode: 'all', lineId: null, route: null, routeEnvelope: null, stationId: null, arrivals: null, lineSearch: '', stationSearch: '', routeLoading: false, arrivalLoading: false, routeError: '', arrivalError: '', lineError: '', routeSeq: 0, arrivalSeq: 0, lineSeq: 0, arrivalController: null, demo: false, mapView: 'network', mapArea: 'england', networkRoutes: new Map(), networkErrors: new Map(), networkPending: new Set() };
const modeNames = { tube: 'Underground', dlr: 'DLR', overground: 'Overground', 'elizabeth-line': 'Elizabeth line', 'national-rail': 'National Rail', tram: 'Tram' };
let map, routeLayers, networkLayers, tileFailures = 0;
const markers = new Map();

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

function mappedLines() { return visibleLines(state.lines, state.mode); }

function renderNetworkProgress() {
  const summary = networkSummary(mappedLines(), state.networkRoutes, state.networkErrors);
  const loading = mappedLines().some(item => state.networkPending.has(item.id));
  $('network-progress').hidden = state.mapView !== 'network';
  $('network-progress-text').textContent = `${summary.loaded} of ${summary.total} routes loaded${loading ? ' · Loading…' : ''}${summary.failed ? ` · ${summary.failed} unavailable` : ''}${summary.stale ? ` · ${summary.stale} saved routes` : ''}`;
  $('retry-network').hidden = !summary.failed;
  $('retry-network').disabled = loading;
  if (state.mapView === 'network') {
    $('map-loading').hidden = Boolean(summary.loaded) || !summary.total;
    if (!summary.loaded && summary.total) $('map-loading').innerHTML = loading
      ? '<span class="spinner" aria-hidden="true"></span><span>Loading network routes…</span>'
      : empty('Network routes are unavailable.', 'Use Retry missing routes above to reconnect.');
    $('fit-route').disabled = !networkLayers?.getLayers().length;
  }
}

function ensureNetworkRoutes(retry = false) {
  for (const item of mappedLines()) {
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
      state.networkPending.delete(item.id);
      if (state.mapView === 'network') { drawNetwork(); renderNetworkProgress(); }
    });
  }
  renderNetworkProgress();
}

function drawNetwork() {
  if (!map || !networkLayers) return;
  networkLayers.clearLayers();
  if (state.mapView !== 'network') return;
  for (const item of mappedLines().sort((a, b) => Number(a.id === state.lineId) - Number(b.id === state.lineId))) {
    const envelope = state.networkRoutes.get(item.id);
    for (const path of envelope?.data.paths || []) {
      if (path.length < 2) continue;
      const selected = item.id === state.lineId;
      L.polyline(path, { color: '#fff', weight: selected ? 7 : 5, opacity: .75, interactive: false }).addTo(networkLayers);
      const layer = L.polyline(path, { color: safeColor(item.color), weight: selected ? 4 : 2.5, opacity: state.lineId && !selected ? .65 : .9 }).addTo(networkLayers);
      const label = document.createElement('span'); label.textContent = `${item.name}${envelope.stale ? ' · saved route' : ''}`;
      layer.bindTooltip(label, { sticky: true });
      layer.on('click', () => selectLine(item.id));
    }
  }
  $('fit-route').disabled = !networkLayers.getLayers().length;
}

function setMapView(view) {
  if (view === state.mapView) return;
  state.mapView = view;
  [...$('map-view-controls').querySelectorAll('button')].forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  $('fit-route').textContent = view === 'network' ? 'Fit network ↗' : 'Fit line ↗';
  if (networkLayers) { if (view === 'network') networkLayers.addTo(map); else networkLayers.remove(); }
  renderRouteHeading();
  if (view === 'network') { ensureNetworkRoutes(); drawNetwork(); renderNetworkProgress(); }
  else {
    renderNetworkProgress();
    $('map-loading').hidden = Boolean(state.route);
    if (!state.route) $('map-loading').innerHTML = state.routeLoading ? empty('Loading route and stations…') : state.routeError ? empty('The route could not be loaded.', state.routeError, 'route') : empty('Choose a line.', 'Select a line from the service overview.');
    $('fit-route').disabled = !routeLayers?.getLayers().length;
  }
  fitRoute();
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
  if (focused) [...container.querySelectorAll('button')].find(button => button.dataset[key] === focused)?.focus({ preventScroll: true });
}
function empty(message, detail = '', retry = '') {
  return `<div class="empty-state"><p>${e(message)}</p>${detail ? `<span>${e(detail)}</span>` : ''}${retry ? `<button class="retry-button" type="button" data-retry="${retry}">Try again</button>` : ''}</div>`;
}

function clearSelection() {
  state.arrivalController?.abort();
  ++state.routeSeq; ++state.arrivalSeq;
  Object.assign(state, { lineId: null, route: null, routeEnvelope: null, stationId: null, arrivals: null, routeLoading: false, arrivalLoading: false, routeError: '', arrivalError: '', stationSearch: '' });
  $('station-search').value = '';
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
  const filtered = state.lines.filter(item => (state.mode === 'all' || item.mode === state.mode) && item.name.toLowerCase().includes(state.lineSearch.toLowerCase()));
  $('line-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'SERVICE' : 'SERVICES'}`;
  restoreFocus($('line-list'), 'line', () => {
    if (!filtered.length) { $('line-list').innerHTML = empty(state.lineError || 'No matching lines.', state.lineError ? 'The network could not be loaded.' : 'Try another name or transport mode.', state.lineError ? 'lines' : ''); return; }
    const groups = [...new Set(filtered.map(item => item.mode))];
    $('line-list').innerHTML = groups.map(mode => `<div class="line-group-title">${e(modeName(mode))}</div>` + filtered.filter(item => item.mode === mode).map(item => {
      const condition = lineCondition(item);
      return `<button type="button" class="line-button" data-line="${e(item.id)}" style="--line:${safeColor(item.color)}" aria-pressed="${item.id === state.lineId}"><span class="line-swatch" aria-hidden="true"></span><span class="line-copy"><span class="line-name">${e(item.name)}</span><span class="line-condition"><span class="status-dot ${condition.type}" aria-hidden="true"></span>${e(condition.text)}</span></span><span class="line-chevron" aria-hidden="true">›</span></button>`;
    }).join('')).join('');
  });
  const stale = !state.linesEnvelope || Boolean(state.lineError) || isStale(state.linesEnvelope, Date.now(), 150000);
  $('network-health').classList.toggle('stale', stale);
  $('network-updated').textContent = state.linesEnvelope ? `${stale ? 'Saved status' : state.demo ? 'Sample status' : 'Status updated'} · ${londonTime(state.linesEnvelope.fetchedAt)}` : state.lineError ? 'Network unavailable' : 'Connecting to data service';
  $('network-updated').title = state.lineError || state.linesEnvelope?.error || '';
  renderRouteHeading();
}

function renderRouteHeading() {
  const selected = line();
  if (state.mapView === 'network') {
    $('route-title').textContent = state.mapArea === 'england' ? 'England rail network' : 'London rail network';
    $('route-subtitle').textContent = `${state.mode === 'all' ? 'All supported rail' : modeName(state.mode)} · Select a line or operator for stations`;
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
  const nationalCoverage = selected.boardProvider === 'national-rail' ? '<p class="coverage-note">TfL route coverage may be incomplete. This is not a complete operator timetable.</p>' : '';
  $('route-status').innerHTML = `<p><strong>${e(selected.name)} · ${stale ? 'Saved status · ' : ''}${e(condition.text)}</strong>${state.demo ? ' <span>— sample data</span>' : ''}</p>${reasons.map(reason => `<p>${/^https:\/\/(www\.)?(nationalrail\.co\.uk|tfl\.gov\.uk)\//.test(reason) ? `<a href="${e(reason)}" target="_blank" rel="noopener noreferrer">View disruption details ↗</a>` : e(reason)}</p>`).join('')}${stale ? '<p>Status updates are unavailable or out of date.</p>' : ''}${nationalCoverage}`;
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
    renderLines();
    if (state.mapView === 'network') { ensureNetworkRoutes(); drawNetwork(); }
    if (!state.lineId && state.lines.length && state.mapView === 'line') {
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
  map = L.map('map', { zoomControl: true, scrollWheelZoom: false, zoomSnap: .25, zoomDelta: .5 }).fitBounds([[49.85, -5.9], [55.82, 1.85]], { padding: [15, 15], animate: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }).on('tileerror', () => { tileFailures++; if (tileFailures >= 2) $('tile-notice').hidden = false; }).addTo(map);
  networkLayers = L.featureGroup().addTo(map);
  routeLayers = L.featureGroup().addTo(map);
  new ResizeObserver(() => map.invalidateSize({ animate: false })).observe($('map'));
}

function drawRoute() {
  markers.clear();
  if (!map) { $('map-loading').innerHTML = empty('Map unavailable.', 'Choose a station from the list to see its arrivals.'); return; }
  routeLayers.clearLayers();
  const color = safeColor(line()?.color);
  for (const path of state.route?.paths || []) {
    const coordinates = path.filter(point => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]));
    if (coordinates.length > 1) { L.polyline(coordinates, { color: '#fff', weight: 8, opacity: .92, interactive: false }).addTo(routeLayers); L.polyline(coordinates, { color, weight: 4, opacity: .95, interactive: false }).addTo(routeLayers); }
  }
  for (const stop of state.route?.stations || []) {
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) continue;
    const marker = L.marker([stop.lat, stop.lon], { icon: stationIcon(false), title: `${stop.name}: show arrivals`, alt: `${stop.name}: show arrivals`, keyboard: true }).addTo(routeLayers);
    const tooltip = document.createElement('span'); tooltip.textContent = stop.name;
    marker.bindTooltip(tooltip, { direction: 'top', offset: [0, -7] });
    marker.on('click', () => selectStation(stop.id, true));
    markers.set(stop.id, marker);
  }
  $('fit-route').disabled = !routeLayers.getLayers().length;
  if (state.mapView === 'line') fitRoute();
  $('map-loading').hidden = true;
  if (state.mapView === 'line' && !routeLayers.getLayers().length) { $('map-loading').hidden = false; $('map-loading').innerHTML = empty('No route geometry is available.', 'Use the station list to explore this line.'); }
}

function stationIcon(selected) {
  return L.divIcon({ className: '', html: `<span class="station-marker${selected ? ' selected' : ''}" style="--marker-color:${safeColor(line()?.color)}"></span>`, iconSize: selected ? [18, 18] : [12, 12], iconAnchor: selected ? [9, 9] : [6, 6] });
}
function fitRoute() {
  const layers = state.mapView === 'network' ? networkLayers : routeLayers;
  if (map && layers?.getLayers().length) map.fitBounds(layers.getBounds(), { padding: [35, 35], maxZoom: 14, animate: false });
}

async function selectLine(id) {
  if (id === state.lineId && !state.routeError) return;
  state.arrivalController?.abort();
  const seq = ++state.routeSeq; ++state.arrivalSeq;
  state.lineId = id; state.route = null; state.routeEnvelope = null; state.stationId = null; state.arrivals = null; state.stationSearch = ''; state.routeLoading = true; state.arrivalLoading = false; state.routeError = ''; state.arrivalError = '';
  $('station-search').value = '';
  routeLayers?.clearLayers(); markers.clear(); $('fit-route').disabled = true;
  renderLines(); renderStations(); renderArrivals();
  if (state.mapView === 'line') { $('map-loading').hidden = false; $('map-loading').innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Loading route and stations…</span>'; }
  else { drawNetwork(); renderNetworkProgress(); }
  try {
    const result = await routes.get(id, { priority: true });
    if (seq !== state.routeSeq) return;
    if (!result.data || !Array.isArray(result.data.stations)) throw new Error('Station information is unavailable.');
    state.route = result.data; state.routeEnvelope = result; state.routeLoading = false;
    state.networkRoutes.set(id, result); state.networkErrors.delete(id);
    noteSource(result); renderRouteHeading(); renderStations(); drawRoute();
    if (state.mapView === 'network') { drawNetwork(); renderNetworkProgress(); }
    announce(`${line()?.name || 'Line'} selected. ${result.data.stations.length} stations available.`);
  } catch (error) {
    if (error.name === 'AbortError' || seq !== state.routeSeq) return;
    state.routeLoading = false; state.routeError = error.message || 'Unable to load the route.';
    if (state.mapView === 'line') $('map-loading').innerHTML = empty('The route could not be loaded.', state.routeError, 'route');
    renderStations(); announce('The route could not be loaded.');
  }
}

function renderStations() {
  const stops = state.route?.stations || [];
  const filtered = stops.filter(stop => stop.name.toLowerCase().includes(state.stationSearch.toLowerCase()));
  $('stations-heading').textContent = line() ? `${line().name} stations` : 'Stations';
  $('station-count').textContent = String(stops.length);
  $('station-search').disabled = state.routeLoading || !state.route;
  restoreFocus($('station-list'), 'station', () => {
    if (state.routeLoading) { $('station-list').innerHTML = empty('Loading stations…'); return; }
    if (state.routeError) { $('station-list').innerHTML = empty('Stations unavailable.', 'Retry the route to reconnect.', 'route'); return; }
    if (!state.route) { $('station-list').innerHTML = '<p class="empty-copy">Stations will appear when you select a line.</p>'; return; }
    if (!filtered.length) { $('station-list').innerHTML = empty('No matching stations.', state.stationSearch ? 'Try a different station name.' : 'No stations are available for this route.'); return; }
    $('station-list').innerHTML = filtered.map(stop => `<button type="button" class="station-button" data-station="${e(stop.id)}" aria-pressed="${stop.id === state.stationId}"><span class="station-dot" aria-hidden="true"></span><span>${e(stop.name)}</span><span class="station-arrow" aria-hidden="true">↗</span></button>`).join('');
  });
}

async function selectStation(id, fromMap = false) {
  if (id === state.stationId) return;
  const oldId = state.stationId;
  state.arrivalController?.abort(); ++state.arrivalSeq;
  state.stationId = id; state.arrivals = null; state.arrivalError = ''; state.arrivalLoading = true;
  if (markers.has(oldId)) markers.get(oldId).setIcon(stationIcon(false)).setZIndexOffset(0);
  if (markers.has(id)) { markers.get(id).setIcon(stationIcon(true)); markers.get(id).setZIndexOffset(1000); if (!fromMap) map.panTo(markers.get(id).getLatLng(), { animate: false }); }
  renderStations(); renderArrivals(); announce(`${station()?.name || 'Station'} selected. Loading arrivals.`);
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

$('mode-filters').addEventListener('click', event => {
  const button = event.target.closest('[data-mode]'); if (!button) return;
  state.mode = button.dataset.mode;
  [...$('mode-filters').children].forEach(item => item.setAttribute('aria-pressed', String(item.dataset.mode === state.mode)));
  if (state.mapView === 'network') {
    if (state.mode !== 'all' && line() && line().mode !== state.mode) clearSelection();
    renderLines(); ensureNetworkRoutes(); drawNetwork(); renderNetworkProgress(); return;
  }
  renderLines();
  if (state.mode !== 'all' && line()?.mode !== state.mode) { const first = state.lines.find(item => item.mode === state.mode); if (first) selectLine(first.id); else clearSelection(); }
});
$('line-search').addEventListener('input', event => { state.lineSearch = event.target.value; renderLines(); });
$('station-search').addEventListener('input', event => { state.stationSearch = event.target.value; renderStations(); });
$('line-list').addEventListener('click', event => { const button = event.target.closest('[data-line]'); if (button) selectLine(button.dataset.line); });
$('station-list').addEventListener('click', event => { const button = event.target.closest('[data-station]'); if (button) selectStation(button.dataset.station); });
$('fit-route').addEventListener('click', fitRoute);
$('map-area-controls').addEventListener('click', event => {
  const area = event.target.closest('[data-area]')?.dataset.area; if (!area) return;
  state.mapArea = area;
  [...$('map-area-controls').querySelectorAll('button')].forEach(button => button.setAttribute('aria-pressed', String(button.dataset.area === area)));
  if (state.mapView !== 'network') setMapView('network');
  if (map) { if (area === 'london') map.setView([51.5074, -0.1278], 11, { animate: false }); else map.fitBounds([[49.85, -5.9], [55.82, 1.85]], { padding: [15, 15], animate: false }); }
  renderRouteHeading();
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
  initializeMap(); updateClock();
  try { state.config = await request('/api/config'); noteSource(null); renderModes(); if (state.config.attribution) $('data-attribution').textContent = state.config.attribution; }
  catch { $('global-error').hidden = false; $('global-error').textContent = 'App settings could not be loaded. Available network data will still be shown.'; }
  renderStations(); renderArrivals();
  await loadLines(true);
  setInterval(() => { if (!document.hidden) loadLines(); }, 60000);
  setInterval(() => { if (!document.hidden && state.stationId) loadArrivals(); }, 20000);
  setInterval(() => { if (!document.hidden) { updateClock(); if (state.arrivals) renderArrivals(); } }, 15000);
}
start();
