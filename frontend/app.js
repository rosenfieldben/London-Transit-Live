import { londonTime, isStale, isPredictionStale, currentPredictions, arrivalTiming, lineCondition, safeColor, escapeHTML as e } from './lib.mjs';

const $ = id => document.getElementById(id);
const state = { config: null, lines: [], linesEnvelope: null, mode: 'all', lineId: null, route: null, routeEnvelope: null, stationId: null, arrivals: null, lineSearch: '', stationSearch: '', routeLoading: false, arrivalLoading: false, routeError: '', arrivalError: '', lineError: '', routeSeq: 0, arrivalSeq: 0, lineSeq: 0, routeController: null, arrivalController: null, demo: false };
const modeNames = { tube: 'Underground', dlr: 'DLR', overground: 'Overground', 'elizabeth-line': 'Elizabeth line', tram: 'Tram' };
let map, routeLayers, tileFailures = 0;
const markers = new Map();

async function request(url, signal) {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`The data service returned ${response.status}. Please try again.`);
  const result = await response.json();
  if (!result || typeof result !== 'object') throw new Error('The data service returned an unreadable response.');
  return result;
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
  state.routeController?.abort(); state.arrivalController?.abort();
  ++state.routeSeq; ++state.arrivalSeq;
  Object.assign(state, { lineId: null, route: null, routeEnvelope: null, stationId: null, arrivals: null, routeLoading: false, arrivalLoading: false, routeError: '', arrivalError: '' });
  routeLayers?.clearLayers(); markers.clear();
  $('fit-route').disabled = true;
  $('route-title').textContent = 'London’s rail network';
  $('route-subtitle').textContent = 'No lines are currently available.';
  $('route-status').hidden = true;
  $('map-caption').textContent = 'NO ROUTE SELECTED';
  $('map-loading').hidden = false;
  $('map-loading').innerHTML = empty('No lines are currently reported.', 'The network will refresh automatically.');
  renderStations(); renderArrivals();
}

function renderModes() {
  const modes = state.config?.modes?.length ? state.config.modes : [...new Set(state.lines.map(item => item.mode))].map(id => ({ id, name: modeName(id) }));
  $('mode-filters').innerHTML = [{ id: 'all', name: 'All rail' }, ...modes].map(mode => `<button type="button" class="mode-button" data-mode="${e(mode.id)}" aria-pressed="${state.mode === mode.id}">${e(mode.name)}</button>`).join('');
}

function renderLines() {
  const filtered = state.lines.filter(item => (state.mode === 'all' || item.mode === state.mode) && item.name.toLowerCase().includes(state.lineSearch.toLowerCase()));
  $('line-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'LINE' : 'LINES'}`;
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
  if (!selected) return;
  const color = safeColor(selected.color);
  document.documentElement.style.setProperty('--line', color);
  $('route-title').textContent = selected.name;
  const count = state.route?.stations?.length;
  $('route-subtitle').textContent = `${modeName(selected.mode)}${count != null ? ` · ${count} stations` : ''}${state.routeEnvelope?.stale ? ' · Saved route' : ''}`;
  const condition = lineCondition(selected);
  const stale = Boolean(state.lineError) || isStale(state.linesEnvelope, Date.now(), 150000);
  const reasons = [...new Set((selected.statuses || []).map(item => item.reason).filter(Boolean))];
  $('route-status').hidden = false;
  $('route-status').className = `route-status ${stale ? 'stale' : condition.type}`;
  $('route-status').innerHTML = `<p><strong>${stale ? 'Saved status · ' : ''}${e(condition.text)}</strong>${state.demo ? ' <span>— sample data</span>' : ''}</p>${reasons.map(reason => `<p>${e(reason)}</p>`).join('')}${stale ? '<p>Status updates are unavailable or out of date.</p>' : ''}`;
  $('map-caption').textContent = `${selected.name.toUpperCase()} / ${state.demo ? 'SAMPLE ROUTE' : 'ROUTE VIEW'}`;
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
    if (!state.lineId && state.lines.length) {
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
  map = L.map('map', { zoomControl: true, scrollWheelZoom: false }).setView([51.5074, -0.1278], 11);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }).on('tileerror', () => { tileFailures++; if (tileFailures >= 2) $('tile-notice').hidden = false; }).addTo(map);
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
  fitRoute();
  $('map-loading').hidden = true;
  if (!routeLayers.getLayers().length) { $('map-loading').hidden = false; $('map-loading').innerHTML = empty('No route geometry is available.', 'Use the station list to explore this line.'); }
}

function stationIcon(selected) {
  return L.divIcon({ className: '', html: `<span class="station-marker${selected ? ' selected' : ''}" style="--marker-color:${safeColor(line()?.color)}"></span>`, iconSize: selected ? [18, 18] : [12, 12], iconAnchor: selected ? [9, 9] : [6, 6] });
}
function fitRoute() { if (map && routeLayers.getLayers().length) map.fitBounds(routeLayers.getBounds(), { padding: [35, 35], maxZoom: 14, animate: false }); }

async function selectLine(id) {
  if (id === state.lineId && !state.routeError) return;
  state.routeController?.abort(); state.arrivalController?.abort();
  const seq = ++state.routeSeq; ++state.arrivalSeq;
  state.lineId = id; state.route = null; state.routeEnvelope = null; state.stationId = null; state.arrivals = null; state.stationSearch = ''; state.routeLoading = true; state.arrivalLoading = false; state.routeError = ''; state.arrivalError = '';
  $('station-search').value = '';
  routeLayers?.clearLayers(); markers.clear(); $('fit-route').disabled = true;
  renderLines(); renderStations(); renderArrivals();
  $('map-loading').hidden = false; $('map-loading').innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Loading route and stations…</span>';
  const controller = new AbortController(); state.routeController = controller;
  try {
    const result = await request(`/api/lines/${encodeURIComponent(id)}/route`, controller.signal);
    if (seq !== state.routeSeq) return;
    if (!result.data || !Array.isArray(result.data.stations)) throw new Error('Station information is unavailable.');
    state.route = result.data; state.routeEnvelope = result; state.routeLoading = false;
    noteSource(result); renderRouteHeading(); renderStations(); drawRoute();
    announce(`${line()?.name || 'Line'} selected. ${result.data.stations.length} stations available.`);
  } catch (error) {
    if (error.name === 'AbortError' || seq !== state.routeSeq) return;
    state.routeLoading = false; state.routeError = error.message || 'Unable to load the route.';
    $('map-loading').innerHTML = empty('The route could not be loaded.', state.routeError, 'route'); renderStations(); announce('The route could not be loaded.');
  }
}

function renderStations() {
  const stops = state.route?.stations || [];
  const filtered = stops.filter(stop => stop.name.toLowerCase().includes(state.stationSearch.toLowerCase()));
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
  if (!state.stationId || !line()) return;
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
    if (firstBoard) announce(`${currentPredictions(result.data).length} predictions loaded for ${station()?.name || 'this station'}.`);
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
  $('board-label').textContent = 'NEXT ARRIVALS';
  $('arrivals-heading').textContent = selected?.name || 'Choose a station';
  $('arrivals-subtitle').textContent = selected ? `${line()?.name || 'Selected line'} · All destinations` : 'Arrival predictions for your selected line.';
  $('arrival-notice').hidden = true; $('arrivals-updated').textContent = '';
  if (!selected) { $('arrival-source').textContent = '—'; $('arrival-source').className = 'source-chip'; $('arrivals-list').innerHTML = empty('Choose a station.', 'Select a station from the list or map.'); return; }
  if (state.arrivalLoading && !state.arrivals) { $('arrival-source').textContent = 'LOADING'; $('arrivals-list').innerHTML = '<div class="empty-state"><span class="spinner" aria-hidden="true"></span><p>Checking the next arrivals…</p></div>'; return; }
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
  if (Number.isFinite(Date.parse(state.arrivals.fetchedAt))) $('arrivals-updated').textContent = `${stale ? 'Last received' : demo ? 'Sample generated' : 'Updated'} ${londonTime(state.arrivals.fetchedAt, { second: '2-digit' })} · London time${document.hidden ? ' · Updates paused' : ''}`;
  const arrivals = remaining.sort((a, b) => Date.parse(a.expectedArrival) - Date.parse(b.expectedArrival)).slice(0, 12);
  if (!arrivals.length) { $('arrivals-list').innerHTML = empty(stale ? 'No current predictions remain in the saved data.' : 'No predictions currently reported.', 'This may be a terminus, outside service hours, or a gap in prediction coverage.'); return; }
  const hasDepartures = arrivals.some(item => item.eventType === 'departure');
  $('board-label').textContent = hasDepartures ? 'ARRIVALS & DEPARTURES' : 'NEXT ARRIVALS';
  $('arrivals-list').innerHTML = arrivals.map(arrival => {
    const timing = arrivalTiming(arrival, state.arrivals);
    return `<article class="arrival-row"><div><p class="arrival-destination">${e(arrival.destination || 'Destination not reported')}</p><p class="arrival-details"><span class="arrival-line">${e(arrival.lineName || line()?.name || '')}</span><br>${arrival.eventType === 'departure' ? 'Departs' : 'Arrives'}${arrival.platform ? ` · ${e(arrival.platform)}` : ''}</p></div><div class="arrival-timing"><p class="arrival-time${timing.small ? ' small' : ''}">${e(timing.value)}</p><p class="arrival-time-label">${e(timing.label)}</p></div></article>`;
  }).join('');
}

$('mode-filters').addEventListener('click', event => {
  const button = event.target.closest('[data-mode]'); if (!button) return;
  state.mode = button.dataset.mode;
  [...$('mode-filters').children].forEach(item => item.setAttribute('aria-pressed', String(item.dataset.mode === state.mode)));
  renderLines();
  if (state.mode !== 'all' && line()?.mode !== state.mode) { const first = state.lines.find(item => item.mode === state.mode); if (first) selectLine(first.id); }
});
$('line-search').addEventListener('input', event => { state.lineSearch = event.target.value; renderLines(); });
$('station-search').addEventListener('input', event => { state.stationSearch = event.target.value; renderStations(); });
$('line-list').addEventListener('click', event => { const button = event.target.closest('[data-line]'); if (button) selectLine(button.dataset.line); });
$('station-list').addEventListener('click', event => { const button = event.target.closest('[data-station]'); if (button) selectStation(button.dataset.station); });
$('fit-route').addEventListener('click', fitRoute);
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
  await loadLines(true);
  setInterval(() => { if (!document.hidden) loadLines(); }, 60000);
  setInterval(() => { if (!document.hidden && state.stationId) loadArrivals(); }, 20000);
  setInterval(() => { if (!document.hidden) { updateClock(); if (state.arrivals) renderArrivals(); } }, 15000);
}
start();
