import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { BoundedCache } from '../server/cache.mjs';
import { TflService, normalizeArrivals, normalizeRoute } from '../server/tfl.mjs';
import { createApp } from '../server/index.mjs';
import { DemoService } from '../server/demo.mjs';

const now = Date.parse('2026-09-19T12:00:00Z');
const at = offset => new Date(now + offset * 1000).toISOString();
const central = { id: 'central', name: 'Central', mode: 'tube' };
const elizabeth = { id: 'elizabeth', name: 'Elizabeth line', mode: 'elizabeth-line' };
const tflLines = [
  { id: 'central', name: 'Central', modeName: 'tube', lineStatuses: [{ statusSeverity: 10, statusSeverityDescription: 'Good Service' }] },
  { id: 'elizabeth', name: 'Elizabeth line', modeName: 'elizabeth-line', lineStatuses: [] },
];
const routeRaw = {
  lineStrings: ['[[[-0.12,51.51],[-0.13,51.52]]]'],
  stations: [{ id: '940GZZLUBNK', name: 'Bank', lat: 51.51, lon: -0.12, lines: [{ id: 'central' }] }],
};
const response = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('cache deduplicates concurrent reads, preserves empty data, bounds stale duration, and suppresses retry storms', async () => {
  let clock = 0;
  let calls = 0;
  let fail = false;
  const cache = new BoundedCache({ now: () => clock, failureTtl: 20 });
  const options = { ttl: 10, maxStale: 30, load: async () => { calls++; await Promise.resolve(); if (fail) throw new Error('SECRET'); return []; } };
  const [first, duplicate] = await Promise.all([cache.get('x', options), cache.get('x', options)]);
  assert.deepEqual(first.data, []);
  assert.deepEqual(duplicate, first);
  assert.equal(calls, 1);
  clock = 11;
  fail = true;
  const stale = await cache.get('x', options);
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, first.fetchedAt);
  assert.doesNotMatch(stale.error, /SECRET/);
  await cache.get('x', options);
  assert.equal(calls, 2);
  clock = 41;
  await assert.rejects(cache.get('x', options), /temporarily unavailable/);
  assert.equal(calls, 3);
});

test('cache evicts oldest entries at its bound and never fabricates first-failure data', async () => {
  const cache = new BoundedCache({ maxEntries: 2 });
  for (const id of ['a', 'b', 'c']) await cache.get(id, { ttl: 20, maxStale: 0, load: async () => id });
  assert.equal(cache.entries.size, 2);
  assert.equal(cache.entries.has('a'), false);
  await assert.rejects(cache.get('broken', { ttl: 20, maxStale: 20, load: async () => { throw new Error('app_key=secret'); } }), /temporarily unavailable/);
});

test('a synchronous loader failure is removed from inflight and can recover after retry delay', async () => {
  let clock = 0;
  const cache = new BoundedCache({ now: () => clock, failureTtl: 10 });
  await assert.rejects(cache.get('sync', { ttl: 10, maxStale: 0, load: () => { throw new Error('sync failure'); } }));
  assert.equal(cache.inflight.size, 0);
  clock = 11;
  const recovered = await cache.get('sync', { ttl: 10, maxStale: 0, load: () => ['recovered'] });
  assert.deepEqual(recovered.data, ['recovered']);
});

test('Tube adapter filters line, expiry and missing times; retains source timestamps and sorts predictions', () => {
  const raw = [
    { id: 'later', lineId: 'central', expectedArrival: at(180), timestamp: at(-10), timeToLive: at(100), destinationName: 'Epping', platformName: 'Eastbound' },
    { id: 'first', lineId: 'central', expectedArrival: at(60) },
    { id: 'wrong-line', lineId: 'northern', expectedArrival: at(30) },
    { id: 'expired', lineId: 'central', expectedArrival: at(40), timeToLive: at(-1) },
    { id: 'already-passed', lineId: 'central', expectedArrival: at(-61) },
    { id: 'no-time', lineId: 'central', timeToStation: 300 },
  ];
  const arrivals = normalizeArrivals(raw, central, now);
  assert.deepEqual(arrivals.map(item => item.id), ['first', 'later']);
  assert.equal(arrivals[1].sourceTimestamp, at(-10));
  assert.equal(arrivals[1].validUntil, at(100));
  assert.equal(arrivals[1].scheduled, false);
  assert.equal(arrivals[1].eventType, 'arrival');
  assert.deepEqual(normalizeArrivals([], central, now), []);
});

test('rail adapter preserves estimated departures, scheduled-only arrival, cancellation, and per-line context', () => {
  const arrivals = normalizeArrivals([
    { estimatedTimeOfDeparture: at(180), scheduledTimeOfDeparture: at(150), destinationName: 'Shenfield' },
    { scheduledTimeOfArrival: at(60), destinationName: 'Paddington', departureStatus: 'Cancelled' },
    { estimatedTimeOfArrival: at(90), scheduledTimeOfDeparture: at(120), destinationName: 'Abbey Wood' },
    { estimatedTimeOfArrival: at(20), departureStatus: 'NotStoppingAtStation' },
    { estimatedTimeOfDeparture: '12:34', destinationName: 'No ISO time' },
  ], elizabeth, now);
  assert.equal(arrivals.length, 3);
  assert.equal(arrivals[0].scheduled, true);
  assert.equal(arrivals[0].cancelled, true);
  assert.equal(arrivals[0].eventType, 'arrival');
  assert.equal(arrivals[2].expectedArrival, at(180));
  assert.equal(arrivals[2].scheduled, false);
  assert.equal(arrivals[2].eventType, 'departure');
  assert.equal(arrivals[2].lineId, 'elizabeth');
});

test('route normalization handles encoded geometry and deduplicates stations without fabricating paths', () => {
  const route = normalizeRoute({ ...routeRaw, stopPointSequences: [{ stopPoint: routeRaw.stations }] }, central);
  assert.deepEqual(route.paths, [[[51.51, -0.12], [51.52, -0.13]]]);
  assert.equal(route.stations.length, 1);
  assert.deepEqual(route.stations[0].lines, ['central']);
  assert.equal(route.lineId, 'central');
  assert.deepEqual(normalizeRoute({ lineStrings: ['not-json'], stations: [] }, central).paths, []);
});

test('route stops use mode-specific NaPTAN IDs rather than duplicate interchange hubs', () => {
  const route = normalizeRoute({
    lineStrings: [],
    stations: [{ id: 'HUBBNK', name: 'Bank', lat: 51.51, lon: -0.12 }],
    stopPointSequences: [{ stopPoint: [{ ...routeRaw.stations[0], parentId: 'HUBBNK' }] }],
  }, central);
  assert.deepEqual(route.stations.map(station => station.id), ['940GZZLUBNK']);
  assert.deepEqual(normalizeRoute({ stations: [{ id: 'HUBBNK', lat: 51.51, lon: -0.12 }] }, central).stations, []);
});

test('real service composition validates registry and uses different TfL endpoints for Tube versus rail', async () => {
  const urls = [];
  const service = new TflService({ now: () => now, appKey: 'test-secret', fetchImpl: async url => {
    urls.push(new URL(url));
    if (url.pathname.endsWith('/Status')) return response(tflLines);
    if (url.pathname.endsWith('/Route/Sequence/all')) return response(routeRaw);
    if (url.pathname.endsWith('/ArrivalDepartures')) return response([{ estimatedTimeOfDeparture: at(90), destinationName: 'Abbey Wood' }]);
    if (url.pathname.endsWith('/Arrivals')) return response([{ id: 'tube', lineId: 'central', expectedArrival: at(60) }]);
    throw new Error('Unexpected path');
  } });
  const route = await service.route('central');
  assert.equal(route.data.name, 'Central');
  assert.equal(route.data.stations[0].id, '940GZZLUBNK');
  const tube = await service.arrivals('940GZZLUBNK', 'central', 'tube');
  const rail = await service.arrivals('940GZZLUBNK', 'elizabeth', 'elizabeth-line');
  assert.equal(tube.data[0].id, 'tube');
  assert.equal(rail.data[0].eventType, 'departure');
  assert.equal(urls.filter(url => url.pathname.endsWith('/Status')).length, 1);
  assert.equal(urls.find(url => url.pathname.endsWith('/ArrivalDepartures')).searchParams.get('lineIds'), 'elizabeth');
  assert.ok(urls.every(url => url.origin === 'https://api.tfl.gov.uk'));
  await assert.rejects(service.arrivals('unknown', 'central', 'tube'), /Station is not/);
  await assert.rejects(service.arrivals('940GZZLUBNK', 'central', 'overground'), /does not match/);
  await assert.rejects(service.route('https://evil.test'), /valid lineId/);
  assert.doesNotMatch(JSON.stringify(rail), /test-secret/);
});

test('default provider fetch keeps the global receiver required by Workers', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', function () {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    calls++;
    return Promise.resolve(response(tflLines));
  });
  const result = await new TflService().lines();
  assert.equal(result.source, 'tfl');
  assert.equal(result.data.length, 2);
  assert.equal(calls, 1);
});

test('provider diagnostics retain failure categories without credentials or raw errors', async () => {
  const records = [];
  const service = new TflService({ appKey: 'private-test-key', diagnostics: record => records.push(record),
    fetchImpl: async () => { throw new TypeError('Illegal invocation https://api.tfl.gov.uk?app_key=private-test-key'); } });
  await assert.rejects(service.lines(), error => error.status === 502);
  assert.equal(records[0].category, 'invalid-fetch-receiver');
  assert.equal(records[0].upstreamStatus, null);
  assert.doesNotMatch(JSON.stringify(records), /private-test-key|https:|app_key/);
  const denied = new TflService({ diagnostics: record => records.push(record),
    fetchImpl: async () => new Response('private upstream detail', { status: 403 }) });
  await assert.rejects(denied.lines(), /access was declined/);
  assert.equal(records[1].upstreamStatus, 403);
  assert.equal(records[1].category, 'http-error');
  assert.doesNotMatch(JSON.stringify(records), /private upstream detail/);
});

test('provider uses Worker-compatible redirect handling and rejects redirects without following them', async () => {
  let calls = 0;
  let requestedUrl, redirect;
  const service = new TflService({ appKey: 'private-test-key', diagnostics: () => {}, fetchImpl: async (url, options) => {
    calls++;
    requestedUrl = url;
    redirect = options.redirect;
    return new Response(null, { status: 302, headers: { Location: 'https://other.example/collect' } });
  } });
  await assert.rejects(service.lines(), error => error.status === 502);
  assert.equal(calls, 1);
  assert.equal(redirect, 'manual');
  assert.equal(requestedUrl.origin, 'https://api.tfl.gov.uk');
});

test('upstream 429 creates a shared backoff and failures never switch live mode to demo', async () => {
  let calls = 0;
  const service = new TflService({ now: () => now, fetchImpl: async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '60' } }); } });
  await assert.rejects(service.lines(), /rate limit/);
  await assert.rejects(service.lines(), /rate limit/);
  await assert.rejects(service.request('/Line/central'), /paused/);
  assert.equal(calls, 1);
});

test('HTTP boundary serves explicit demo envelopes and rejects methods, unsupported modes, proxying, and file escape', async t => {
  const app = createApp({ demo: true, service: new DemoService({ now: () => now }) });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise(resolve => app.close(resolve)));
  const base = `http://127.0.0.1:${app.address().port}`;
  const config = await fetch(`${base}/api/config`).then(response => response.json());
  assert.equal(config.demo, true);
  assert.equal(config.modes.length, 4);
  const lines = await fetch(`${base}/api/lines`).then(response => response.json());
  assert.equal(lines.source, 'demo');
  assert.ok(lines.data.length >= 4);
  const route = await fetch(`${base}/api/lines/central/route`).then(response => response.json());
  const arrivals = await fetch(`${base}/api/stations/${route.data.stations[0].id}/arrivals?lineId=central&mode=tube`).then(response => response.json());
  assert.equal(arrivals.data.length, 4);
  assert.equal((await fetch(`${base}/api/lines`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/api/stations/940GZZLUBNK/arrivals?lineId=central&mode=bus`)).status, 400);
  assert.equal((await fetch(`${base}/api/lines/%2F%2Fevil.test/route`)).status, 400);
  assert.equal((await fetch(`${base}/api/proxy?url=https://evil.test`)).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e%2fpackage.json`)).status, 404);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.equal((await fetch(`${base}/api/health`)).headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
});

test('HTTP first-request live failure returns a sanitized error with no fixture fallback', async t => {
  const app = createApp({ service: new TflService({ fetchImpl: async () => { throw new Error('https://api.tfl.gov.uk?app_key=secret'); } }) });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise(resolve => app.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${app.address().port}/api/lines`);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.source, 'tfl');
  assert.equal(body.data, null);
  assert.doesNotMatch(JSON.stringify(body), /secret|demo/);
});
