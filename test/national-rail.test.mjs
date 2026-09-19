import test from 'node:test';
import assert from 'node:assert/strict';
import { NationalRailService, nationalRailBase, stationCrs, railClockIso, normalizeNationalBoard } from '../server/national-rail.mjs';
import { TransitService } from '../server/transit.mjs';
import { normalizeRoute } from '../server/tfl.mjs';

const now = Date.parse('2026-09-19T11:00:00Z');
const station = { id: '910GYORK', lat: 53.95797, lon: -1.09318 };
const base = 'https://api1.raildata.org.uk/subscribed-product/LDBWS/api/20220120';
const raw = { crs: 'YRK', generatedAt: new Date(now).toISOString(), trainServices: [
  { serviceID: 'one', std: '12:05', etd: 'On time', operator: 'LNER', operatorCode: 'GR', destination: [{ locationName: 'Newcastle' }], platform: '9' },
  { serviceID: 'two', std: '12:10', etd: '12:20', operator: 'TransPennine Express', destination: [{ locationName: 'Manchester Airport' }] },
  { serviceID: 'three', std: '11:55', etd: 'Delayed', operator: 'Northern', destination: [] },
  { serviceID: 'four', std: '12:30', etd: 'Cancelled', isCancelled: true },
] };

test('national station codes require an exact, geographically consistent NaPTAN match', () => {
  assert.equal(stationCrs(station), 'YRK');
  assert.equal(stationCrs({ ...station, id: 'YRK' }), null);
  assert.equal(stationCrs({ ...station, lat: 51 }), null);
  assert.equal(stationCrs({ id: station.id }), null);
  assert.equal(stationCrs({ ...station, id: '910GGLGC' }), null); // ambiguous provider mapping excluded
});

test('RDM endpoint configuration cannot send the secret to another host or URL', () => {
  assert.equal(nationalRailBase(base + '/'), base);
  for (const value of ['http://api1.raildata.org.uk/product/LDBWS/api/20220120', base + '?key=x', base + '#x',
    'https://api1.raildata.org.uk.evil.example/product/LDBWS/api/20220120',
    'https://secret@api1.raildata.org.uk/product/LDBWS/api/20220120',
    'https://api1.raildata.org.uk/other', 'https://localhost/LDBWS/api/20220120']) assert.equal(nationalRailBase(value), null);
});

test('Darwin clock normalization handles summer, winter, midnight and both repeated autumn hours', () => {
  assert.equal(railClockIso('12:05', '2026-09-19T11:00:00Z'), '2026-09-19T11:05:00.000Z');
  assert.equal(railClockIso('12:05', '2026-01-19T12:00:00Z'), '2026-01-19T12:05:00.000Z');
  assert.equal(railClockIso('00:10', '2026-09-19T22:55:00Z'), '2026-09-19T23:10:00.000Z');
  assert.equal(railClockIso('01:30', '2026-10-25T00:20:00Z'), '2026-10-25T00:30:00.000Z');
  assert.equal(railClockIso('01:30', '2026-10-25T01:20:00Z'), '2026-10-25T01:30:00.000Z');
  assert.equal(railClockIso('Delayed', new Date(now).toISOString()), null);
});

test('national boards retain operator identity, unconfirmed delays, cancellations and withheld platforms', () => {
  const board = normalizeNationalBoard(raw, 'YRK', now);
  assert.equal(board.length, 4);
  assert.equal(board[0].id, 'three');
  assert.equal(board[0].delayed, true);
  assert.equal(board[0].expectedArrival, '2026-09-19T10:55:00.000Z');
  assert.equal(board[0].scheduled, true);
  assert.equal(board[1].lineName, 'LNER');
  assert.equal(board[1].scheduled, false);
  assert.equal(board[1].expectedArrival, '2026-09-19T11:05:00.000Z');
  assert.equal(board[2].expectedArrival, '2026-09-19T11:20:00.000Z');
  assert.equal(board[3].cancelled, true);
  assert.equal(normalizeNationalBoard({ ...raw, platformAvailable: false }, 'YRK', now)[1].platform, 'Platform not announced');
  assert.throws(() => normalizeNationalBoard(raw, 'KGX', now), /unexpected station board/);
});

test('unconnected national boards are explicit and make no outbound requests', async () => {
  const service = new NationalRailService({ fetchImpl: () => { throw new Error('must not fetch'); } });
  const board = await service.board(station);
  assert.equal(board.availability, 'not-configured');
  assert.equal(board.source, 'national-rail');
  assert.equal(board.fetchedAt, null);
  assert.equal(board.crs, 'YRK');
});

test('national boards use the subscribed endpoint, share a station cache, and label old provider data stale', async () => {
  const calls = [];
  const service = new NationalRailService({ apiKey: 'private-test-key', apiBase: base, now: () => now,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return Response.json({ ...raw, generatedAt: '2026-09-19T10:50:00Z' }); } });
  const [a, b] = await Promise.all([service.board(station), service.board(station)]);
  assert.equal(calls.length, 1); assert.deepEqual(a, b);
  assert.equal(calls[0].url.pathname, '/subscribed-product/LDBWS/api/20220120/GetDepBoardWithDetails/YRK');
  assert.equal(calls[0].options.headers['x-apikey'], 'private-test-key');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(a.stale, true);
  assert.equal(a.boardScope, 'all-operators');
  assert.doesNotMatch(JSON.stringify(a), /private-test-key/);
});

test('national failures are sanitized and cannot follow credential-bearing redirects', async () => {
  let calls = 0;
  const service = new NationalRailService({ apiKey: 'private-test-key', apiBase: base,
    fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { Location: 'https://other.example/' } }); } });
  await assert.rejects(service.board(station), error => error.status === 502 && !error.message.includes('private-test-key'));
  assert.equal(calls, 1);
});

test('national operators bypass unsupported TfL boards and validate route membership first', async () => {
  const calls = [];
  const service = new TransitService({ now: () => now, fetchImpl: async url => {
    calls.push(url.pathname);
    if (url.pathname.endsWith('/Status')) return Response.json([{ id: 'london-north-eastern-railway', name: 'LNER', modeName: 'national-rail' }]);
    if (url.pathname.endsWith('/Route/Sequence/all')) return Response.json({ stations: [{ ...station, name: 'York' }] });
    throw new Error('Unexpected TfL arrival request');
  } });
  const board = await service.arrivals(station.id, 'london-north-eastern-railway', 'national-rail');
  assert.equal(board.availability, 'not-configured');
  assert.equal(calls.length, 2);
  await assert.rejects(service.arrivals('910GKNGX', 'london-north-eastern-railway', 'national-rail'), /not on the selected line/);
});

test('route normalization retains England-wide and cross-border coordinates', () => {
  const route = normalizeRoute({ lineStrings: ['[[[-5.53,50.12],[-1.61,54.97],[-4.22,57.48]]]'],
    stations: [{ id: '910GPENZNCE', name: 'Penzance', lat: 50.12, lon: -5.53 }, { id: '910GNEWCSTL', name: 'Newcastle', lat: 54.97, lon: -1.61 }] },
  { id: 'national', mode: 'national-rail' });
  assert.equal(route.paths[0].length, 3);
  assert.equal(route.stations.length, 2);
});

test('an estimated departure in the repeated autumn hour remains on the board', () => {
  const stamp = Date.parse('2026-10-25T00:45:00Z');
  const board = normalizeNationalBoard({ crs: 'YRK', generatedAt: new Date(stamp).toISOString(),
    trainServices: [{ std: '01:50', etd: '01:40', operator: 'LNER' }] }, 'YRK', stamp);
  assert.equal(board.length, 1);
  assert.equal(board[0].expectedArrival, '2026-10-25T01:40:00.000Z');
});
