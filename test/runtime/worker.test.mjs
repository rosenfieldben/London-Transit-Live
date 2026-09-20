import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';

// Exercise the actual deployment bundle in workerd, including native fetch
// receiver/redirect validation that Node's fetch and JS mocks do not enforce.
test('built Worker requests and normalizes TfL data in the hosting runtime', async t => {
  const calls = [];
  const runtime = new Miniflare({
    modules: true, compatibilityDate: '2025-09-01', cf: false,
    scriptPath: new URL('../../dist/server/index.js', import.meta.url).pathname,
    outboundService: async request => {
      calls.push({ url: request.url, accept: request.headers.get('accept') });
      return Response.json([{ id: 'victoria', name: 'Victoria', modeName: 'tube',
        lineStatuses: [{ statusSeverity: 10, statusSeverityDescription: 'Good Service' }] }]);
    },
  });
  t.after(() => runtime.dispose());
  const module = await runtime.dispatchFetch('http://localhost/network.mjs');
  assert.equal(module.status, 200);
  assert.match(module.headers.get('content-type'), /javascript/);
  assert.match(await module.text(), /class RouteStore/);
  const explorer = await runtime.dispatchFetch('http://localhost/explorer.mjs');
  assert.equal(explorer.status, 200);
  assert.match(await explorer.text(), /function stationIndex/);
  const mapModule = await runtime.dispatchFetch('http://localhost/map.mjs');
  assert.equal(mapModule.status, 200);
  assert.match(await mapModule.text(), /class AutoFrame/);
  const response = await runtime.dispatchFetch('http://localhost/api/lines');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.source, 'tfl');
  assert.equal(result.stale, false);
  assert.equal(result.data[0].id, 'victoria');
  assert.equal(result.data[0].statuses[0].description, 'Good Service');
  assert.deepEqual(calls, [{
    url: 'https://api.tfl.gov.uk/Line/Mode/tube,dlr,overground,elizabeth-line,national-rail/Status',
    accept: 'application/json',
  }]);
});

test('built Worker composes TfL routes with an authenticated National Rail station board', async t => {
  const calls = [];
  const runtime = new Miniflare({
    modules: true, compatibilityDate: '2025-09-01', cf: false,
    scriptPath: new URL('../../dist/server/index.js', import.meta.url).pathname,
    bindings: { NATIONAL_RAIL_API_KEY: 'synthetic-national-test-key', NATIONAL_RAIL_API_BASE: 'https://api1.raildata.org.uk/test-product/LDBWS/api/20220120' },
    outboundService: async request => {
      const url = new URL(request.url);
      calls.push({ host: url.hostname, path: url.pathname, key: request.headers.get('x-apikey') });
      if (url.pathname.endsWith('/Status')) return Response.json([{ id: 'london-north-eastern-railway', name: 'LNER', modeName: 'national-rail' }]);
      if (url.pathname.endsWith('/Route/Sequence/all')) return Response.json({ stations: [{ id: '910GYORK', name: 'York', lat: 53.95797, lon: -1.09318 }] });
      const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.now() + 300000));
      return Response.json({ crs: 'YRK', generatedAt: new Date().toISOString(), trainServices: [{ std: clock, etd: 'On time', operator: 'LNER', destination: [{ locationName: 'Newcastle' }] }] });
    },
  });
  t.after(() => runtime.dispose());
  const response = await runtime.dispatchFetch('http://localhost/api/stations/910GYORK/arrivals?lineId=london-north-eastern-railway&mode=national-rail');
  assert.equal(response.status, 200);
  const board = await response.json();
  assert.equal(board.source, 'national-rail');
  assert.equal(board.boardScope, 'all-operators');
  assert.equal(board.data[0].lineName, 'LNER');
  assert.equal(board.data[0].destination, 'Newcastle');
  assert.equal(calls.length, 3);
  assert.equal(calls[2].host, 'api1.raildata.org.uk');
  assert.equal(calls[2].key, 'synthetic-national-test-key');
  assert.ok(calls.slice(0, 2).every(call => call.key === null));
  assert.doesNotMatch(JSON.stringify(board), /synthetic-national-test-key/);
});
