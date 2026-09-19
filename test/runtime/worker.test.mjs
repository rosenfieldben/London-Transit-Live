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
