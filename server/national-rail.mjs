import { BoundedCache, HttpError, TokenBucket } from './cache.mjs';
import stationCodes from '../data/naptan-rail-codes.json' with { type: 'json' };

// RDM consumer keys belong to a subscribed product URL, not the direct
// National Rail Basic-Auth service. Keep the host and API shape constrained.
export function nationalRailBase(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'api1.raildata.org.uk' || url.port || url.username || url.password || url.search || url.hash) return null;
    if (!/^\/[A-Za-z0-9_-]+\/LDBWS\/api\/20220120\/?$/.test(url.pathname)) return null;
    return url.href.replace(/\/$/, '');
  } catch { return null; }
}

export function stationCrs(station) {
  const reference = stationCodes.stations[station?.id];
  // Exact stop-area identity and nearby coordinates prevent guessed or
  // ambiguous CRS substitutions. Missing mappings remain unavailable.
  if (!reference || !Number.isFinite(station.lat) || !Number.isFinite(station.lon) || Math.abs(reference.lat - station.lat) > .025 || Math.abs(reference.lon - station.lon) > .04) return null;
  return reference.crs;
}

const wallFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const wall = value => Object.fromEntries(wallFormatter.formatToParts(new Date(value)).filter(part => ['year', 'month', 'day', 'hour', 'minute'].includes(part.type)).map(part => [part.type, Number(part.value)]));

// Darwin's board clock fields are London HH:mm, including over midnight and
// daylight-saving transitions. Resolve both GMT/BST candidates explicitly.
export function railClockIso(clock, reference, nearest = false) {
  if (typeof clock !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) return null;
  const stamp = Date.parse(reference); if (!Number.isFinite(stamp)) return null;
  const parts = wall(stamp), [hour, minute] = clock.split(':').map(Number);
  const candidates = [];
  for (const day of [-1, 0, 1, 2]) {
    const target = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + day, hour, minute));
    for (const offset of [0, 60]) {
      const time = target.getTime() - offset * 60000, local = wall(time);
      if (local.year !== target.getUTCFullYear() || local.month !== target.getUTCMonth() + 1 || local.day !== target.getUTCDate() || local.hour !== hour || local.minute !== minute) continue;
      if (nearest || time >= stamp - 60000) candidates.push(time);
    }
  }
  candidates.sort((a, b) => nearest ? Math.abs(a - stamp) - Math.abs(b - stamp) : a - b);
  return candidates.length ? new Date(candidates[0]).toISOString() : null;
}

export function normalizeNationalBoard(raw, crs, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.crs !== crs || !Number.isFinite(Date.parse(raw.generatedAt))) throw new HttpError(502, 'National Rail returned an unexpected station board.');
  if (raw.trainServices != null && !Array.isArray(raw.trainServices)) throw new HttpError(502, 'National Rail returned an unexpected service list.');
  const generated = new Date(raw.generatedAt).toISOString();
  return (raw.trainServices || []).flatMap((service, index) => {
    if (!service || service.serviceType && service.serviceType !== 'train') return [];
    const scheduled = railClockIso(service.std, generated, true);
    if (!scheduled) return [];
    const cancelled = Boolean(service.isCancelled) || service.etd === 'Cancelled';
    const delayed = service.etd === 'Delayed';
    const onTime = service.etd === 'On time';
    const estimate = railClockIso(service.etd, generated);
    const confirmedEstimate = estimate && Date.parse(estimate) - Date.parse(scheduled) <= 12 * 3600000 ? estimate : null;
    const expectedArrival = confirmedEstimate || scheduled;
    if (Date.parse(expectedArrival) < now - 60000 && !delayed && !cancelled) return [];
    return [{
      id: String(service.serviceID || `${crs}:${index}:${scheduled}`).slice(0, 200),
      lineId: String(service.operatorCode || '').slice(0, 20), lineName: String(service.operator || 'National Rail').slice(0, 200),
      destination: (service.destination || []).map(item => item.locationName).filter(value => typeof value === 'string').join(' / ').slice(0, 400) || 'Destination unavailable',
      platform: raw.platformAvailable !== false && service.platform ? `Platform ${String(service.platform).slice(0, 40)}` : 'Platform not announced',
      expectedArrival, scheduledTime: scheduled, scheduled: !confirmedEstimate && !onTime,
      cancelled, delayed, eventType: 'departure', sourceTimestamp: generated,
      ...(cancelled || delayed ? { retainUntil: new Date(Date.parse(generated) + 90000).toISOString() } : {}),
    }];
  }).sort((a, b) => Date.parse(a.expectedArrival) - Date.parse(b.expectedArrival)).slice(0, 80);
}

export class NationalRailService {
  constructor({ apiKey = '', apiBase = '', fetchImpl = globalThis.fetch.bind(globalThis), now = Date.now } = {}) {
    this.apiKey = apiKey; this.apiBase = nationalRailBase(apiBase); this.fetch = fetchImpl; this.now = now;
    this.configured = Boolean(this.apiKey && this.apiBase);
    this.cache = new BoundedCache({ now }); this.budget = new TokenBucket({ capacity: 10, perMinute: 30, now }); this.backoffUntil = 0;
  }
  async board(station) {
    const crs = stationCrs(station);
    if (!this.configured || !crs) return { source: 'national-rail', fetchedAt: null, stale: false, data: [],
      availability: this.configured ? 'unmapped-station' : 'not-configured',
      message: this.configured ? 'A verified National Rail station code is not available for this stop.' : 'National Rail live boards are not connected yet.',
      crs, boardScope: 'all-operators' };
    const result = await this.cache.get(`board:${crs}`, { source: 'national-rail', ttl: 30000, maxStale: 60000,
      load: async () => {
        if (this.now() < this.backoffUntil || !this.budget.take()) throw new HttpError(503, 'National Rail requests are paused briefly. Please try again shortly.');
        try {
          const url = new URL(`${this.apiBase}/GetDepBoardWithDetails/${crs}`);
          url.searchParams.set('numRows', '50'); url.searchParams.set('timeWindow', '120');
          const response = await this.fetch(url, { headers: { Accept: 'application/json', 'x-apikey': this.apiKey }, signal: AbortSignal.timeout(9000), redirect: 'manual' });
          if (!response.ok) {
            this.backoffUntil = this.now() + (response.status === 429 ? 60000 : 10000);
            throw new HttpError(response.status === 429 ? 503 : 502, response.status === 401 || response.status === 403 ? 'National Rail access was declined. Check the subscribed product and server credentials.' : 'National Rail departure boards are temporarily unavailable.');
          }
          const body = await response.text();
          if (body.length > 2000000) throw new HttpError(502, 'National Rail returned an oversized station board.');
          const raw = JSON.parse(body);
          return { arrivals: normalizeNationalBoard(raw, crs, this.now()), generatedAt: raw.generatedAt };
        } catch (error) {
          if (error instanceof HttpError) throw error;
          throw new HttpError(502, 'National Rail departure boards are temporarily unavailable.');
        }
      } });
    return { ...result, data: result.data.arrivals, providerTimestamp: result.data.generatedAt,
      stale: result.stale || this.now() - Date.parse(result.data.generatedAt) > 90000, crs, boardScope: 'all-operators' };
  }
}
