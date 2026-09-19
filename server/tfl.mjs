import { BoundedCache, HttpError, TokenBucket } from './cache.mjs';

export const MODES = [
  { id: 'tube', name: 'Underground' },
  { id: 'dlr', name: 'DLR' },
  { id: 'overground', name: 'Overground' },
  { id: 'elizabeth-line', name: 'Elizabeth line' },
  { id: 'national-rail', name: 'National Rail' },
];
export const ATTRIBUTION = 'Powered by TfL Open Data. Independent project; not affiliated with Transport for London.';
export const COLORS = {
  bakerloo: '#B36305', central: '#E32017', circle: '#FFD300', district: '#00782A',
  'hammersmith-city': '#F3A9BB', jubilee: '#A0A5A9', metropolitan: '#9B0056',
  northern: '#2A2A2A', piccadilly: '#003688', victoria: '#0098D4', 'waterloo-city': '#95CDBA',
  dlr: '#00A4A7', 'elizabeth': '#6950A1', 'elizabeth-line': '#6950A1',
  lioness: '#FAA61A', mildmay: '#0077AD', windrush: '#E42313', weaver: '#9B0058',
  suffragette: '#5BBD72', liberty: '#61686B', 'london-overground': '#EE7C0E',
  thameslink: '#C91475', 'avanti-west-coast': '#007B83', 'c2c': '#B11E8E',
  'chiltern-railways': '#254A86', crosscountry: '#A9234A', 'east-midlands-railway': '#674070',
  'gatwick-express': '#D32931', 'grand-central': '#E87812', 'greater-anglia': '#C72736',
  'great-northern': '#52779C', 'great-western-railway': '#17624C', 'heathrow-express': '#705291',
  'hull-trains': '#A02B7F', 'island-line': '#286CBA', 'london-north-eastern-railway': '#BC253A',
  lumo: '#126BE5', merseyrail: '#B48100', 'northern-rail': '#34468E', scotrail: '#215C85',
  southeastern: '#2874A6', southern: '#43844A', 'south-western-railway': '#087F95',
  'transpennine-express': '#7F4F9D', 'transport-for-wales': '#B52330', 'west-midlands-trains': '#B56618',
};
const modeIds = new Set(MODES.map(mode => mode.id));
export const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,79}$/.test(value);
const clean = (value, fallback = '') => typeof value === 'string' ? value.slice(0, 2500) : fallback;
const array = value => Array.isArray(value) ? value : [];
const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

export function normalizeLines(raw) {
  if (!Array.isArray(raw)) throw new HttpError(502, 'TfL returned an unexpected line response.');
  const lines = raw.filter(line => safeId(line?.id) && modeIds.has(line.modeName)).map(line => ({
    id: line.id, name: clean(line.name, line.id), mode: line.modeName,
    color: COLORS[line.id] || '#687C92',
    boardProvider: line.modeName === 'national-rail' && line.id !== 'thameslink' ? 'national-rail' : 'tfl',
    statuses: array(line.lineStatuses).map(status => ({
      description: clean(status.statusSeverityDescription, 'Status unavailable'),
      reason: clean(status.reason), severity: Number.isFinite(status.statusSeverity) ? status.statusSeverity : null,
    })),
  }));
  return lines.sort((a, b) => MODES.findIndex(mode => mode.id === a.mode) - MODES.findIndex(mode => mode.id === b.mode) || a.name.localeCompare(b.name));
}

// TfL lineStrings contain JSON-encoded coordinate arrays. We accept both
// longitude/latitude and latitude/longitude, checking Great Britain before
// normalizing to the browser contract [latitude, longitude]. Unknown points are
// rejected rather than drawing a route in the wrong part of the world.
function britainPoint(point) {
  if (!Array.isArray(point) || point.length < 2 || !point.slice(0, 2).every(Number.isFinite)) return null;
  const [a, b] = point;
  if (a >= -9 && a <= 3 && b >= 49 && b <= 61) return [b, a];
  if (b >= -9 && b <= 3 && a >= 49 && a <= 61) return [a, b];
  return null;
}

export function normalizeRoute(raw, line) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(502, 'TfL returned an unexpected route response.');
  const paths = [];
  const visit = value => {
    if (!Array.isArray(value)) return;
    if (value.length && Array.isArray(value[0]) && typeof value[0][0] === 'number') {
      const points = value.map(britainPoint).filter(Boolean);
      if (points.length >= 2) paths.push(points);
    } else value.forEach(visit);
  };
  for (const value of array(raw.lineStrings)) {
    try { visit(typeof value === 'string' ? JSON.parse(value) : value); } catch { /* A missing shape is preferable to a fabricated one. */ }
  }
  const stations = new Map();
  // `stations` can contain HUB interchange IDs, while stopPointSequences holds
  // the actual mode-specific NaPTAN IDs accepted by arrivals endpoints. Do not
  // turn the interchange and its child platform/station into duplicate stops.
  const sequenceStops = array(raw.stopPointSequences).flatMap(sequence => array(sequence.stopPoint));
  const candidates = sequenceStops.length ? sequenceStops : array(raw.stations).filter(stop => !stop?.id?.startsWith('HUB'));
  for (const stop of candidates) {
    if (!stop || !safeId(stop.id) || !Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) continue;
    if (stop.lat < 49 || stop.lat > 61 || stop.lon < -9 || stop.lon > 3) continue;
    if (stations.has(stop.id)) continue;
    stations.set(stop.id, {
      id: stop.id, name: clean(stop.name ?? stop.commonName, stop.id), lat: stop.lat, lon: stop.lon,
      modes: Array.from(new Set([...array(stop.modes).filter(mode => modeIds.has(mode)), line.mode])),
      lines: Array.from(new Set([...array(stop.lines).map(item => typeof item === 'string' ? item : item?.id).filter(safeId), line.id])),
    });
  }
  return { lineId: line.id, name: line.name, paths, stations: [...stations.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

export function normalizeArrivals(raw, line, now = Date.now()) {
  if (!Array.isArray(raw)) throw new HttpError(502, 'TfL returned an unexpected arrivals response.');
  const rail = ['overground', 'elizabeth-line', 'national-rail'].includes(line.mode);
  const arrivals = [];
  for (const [index, arrival] of raw.entries()) {
    if (!arrival || typeof arrival !== 'object') continue;
    if (arrival.departureStatus === 'NotStoppingAtStation') continue;
    // The rail endpoint is queried for exactly one line. Its documented base
    // response omits lineId; use the requested line only when that field is absent.
    if (arrival.lineId && arrival.lineId !== line.id) continue;
    const sourceTimestamp = iso(arrival.timestamp);
    const validUntil = iso(arrival.timeToLive);
    if (validUntil && Date.parse(validUntil) <= now) continue;
    const estimated = rail
      ? iso(arrival.estimatedTimeOfArrival) || iso(arrival.estimatedTimeOfDeparture)
      : iso(arrival.expectedArrival);
    const scheduledTime = rail ? iso(arrival.scheduledTimeOfArrival) || iso(arrival.scheduledTimeOfDeparture) : null;
    const expectedArrival = estimated || scheduledTime;
    if (!expectedArrival) continue;
    if (Date.parse(expectedArrival) < now - 60_000) continue;
    arrivals.push({
      id: clean(String(arrival.id ?? `${line.id}:${arrival.vehicleId ?? index}:${expectedArrival}:${arrival.platformName ?? ''}`)),
      lineId: line.id, lineName: clean(arrival.lineName, line.name),
      destination: clean(arrival.destinationName, 'Destination unavailable'),
      platform: clean(arrival.platformName), expectedArrival,
      scheduled: !estimated,
      eventType: rail && !(estimated ? iso(arrival.estimatedTimeOfArrival) : iso(arrival.scheduledTimeOfArrival)) ? 'departure' : 'arrival',
      cancelled: arrival.departureStatus === 'Cancelled',
      ...(sourceTimestamp ? { sourceTimestamp } : {}),
      ...(validUntil ? { validUntil } : {}),
    });
  }
  return arrivals.sort((a, b) => Date.parse(a.expectedArrival) - Date.parse(b.expectedArrival)).slice(0, 80);
}

export class TflService {
  constructor({ appKey = '', fetchImpl = globalThis.fetch.bind(globalThis), now = Date.now, cache = new BoundedCache({ now }),
    diagnostics = record => console.warn('TfL request failed', record) } = {}) {
    this.appKey = appKey;
    // Workers checks fetch's receiver. Storing the unbound global and calling
    // this.fetch() makes the service its receiver and throws before any I/O.
    this.fetch = fetchImpl;
    this.diagnostics = diagnostics;
    this.now = now;
    this.cache = cache;
    this.upstream = new TokenBucket({ now, capacity: 64, perMinute: 60 });
    this.backoffUntil = 0;
  }

  async request(path, params = {}) {
    if (this.now() < this.backoffUntil) throw new HttpError(503, 'TfL is temporarily unavailable. Requests are paused briefly.');
    if (!this.upstream.take()) throw new HttpError(503, 'TfL request allowance reached. Please try again shortly.');
    const url = new URL(path, 'https://api.tfl.gov.uk');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    if (this.appKey) url.searchParams.set('app_key', this.appKey);
    const startedAt = this.now();
    let upstreamStatus = null;
    try {
      // Workers accepts manual/follow, but rejects redirect:'error'. Manual
      // keeps credentials on the original host; the status check rejects 3xx.
      const response = await this.fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(9_000), redirect: 'manual' });
      upstreamStatus = response.status;
      if (!response.ok) {
        if (response.status === 429) {
          const retry = Number(response.headers.get('retry-after'));
          this.backoffUntil = this.now() + Math.min(300_000, Math.max(60_000, Number.isFinite(retry) ? retry * 1000 : 60_000));
          throw new HttpError(503, 'TfL rate limit reached. Requests are paused briefly.');
        }
        this.backoffUntil = this.now() + (response.status >= 500 ? 10_000 : 2_000);
        throw new HttpError(502, response.status === 401 || response.status === 403 ? 'TfL access was declined. Check the server API key and network access.' : 'TfL data is temporarily unavailable.');
      }
      const text = await response.text();
      if (text.length > 12_000_000) throw new HttpError(502, 'TfL returned an oversized response.');
      return JSON.parse(text);
    } catch (cause) {
      // Log fixed categories only: exception messages, URLs, bodies and keys
      // can contain secrets and must never enter either logs or API responses.
      const category = upstreamStatus !== null && upstreamStatus >= 400 ? 'http-error'
        : cause?.name === 'TimeoutError' || cause?.name === 'AbortError' ? 'timeout'
        : cause instanceof SyntaxError ? 'invalid-json'
        : cause?.message?.includes('Illegal invocation') ? 'invalid-fetch-receiver'
        : 'network-or-runtime-error';
      try { this.diagnostics({ category, upstreamStatus, elapsedMs: Math.max(0, this.now() - startedAt) }); }
      catch { /* Diagnostics must not interfere with the error response. */ }
      if (cause instanceof HttpError) throw cause;
      this.backoffUntil = this.now() + 5_000;
      throw new HttpError(502, 'TfL data is temporarily unavailable.');
    }
  }

  lines() {
    return this.cache.get('lines', {
      ttl: 60_000, maxStale: 300_000,
      load: async () => normalizeLines(await this.request(`/Line/Mode/${MODES.map(mode => mode.id).join(',')}/Status`)),
    });
  }

  async line(id, mode) {
    if (!safeId(id)) throw new HttpError(400, 'A valid lineId is required.');
    if (mode && !modeIds.has(mode)) throw new HttpError(400, 'Unsupported transport mode.');
    const line = (await this.lines()).data.find(item => item.id === id);
    if (!line) throw new HttpError(404, 'Line is not available in this rail network.');
    if (mode && line.mode !== mode) throw new HttpError(400, 'The selected mode does not match this line.');
    return line;
  }

  async route(id) {
    const line = await this.line(id);
    return this.cache.get(`route:${id}`, {
      ttl: 86_400_000, maxStale: 7 * 86_400_000,
      load: async () => normalizeRoute(await this.request(`/Line/${line.id}/Route/Sequence/all`), line),
    });
  }

  async arrivals(stationId, lineId, mode) {
    if (!safeId(stationId)) throw new HttpError(400, 'A valid station id is required.');
    const line = await this.line(lineId, mode);
    const route = await this.route(line.id);
    if (!route.data.stations.some(station => station.id === stationId)) throw new HttpError(404, 'Station is not on the selected line.');
    return this.cache.get(`arrivals:${line.id}:${stationId}`, {
      ttl: 20_000, maxStale: 60_000,
      load: async () => {
        const rail = ['overground', 'elizabeth-line', 'national-rail'].includes(line.mode);
        const raw = await this.request(`/StopPoint/${stationId}/${rail ? 'ArrivalDepartures' : 'Arrivals'}`, rail ? { lineIds: line.id } : {});
        return normalizeArrivals(raw, line, this.now());
      },
    });
  }
}
