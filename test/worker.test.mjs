import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker } from '../worker/app.mjs';

const assets = { '/index.html': { type: 'text/html', body: '<h1>London</h1>' },
  '/app.js': { type: 'text/javascript', body: '/* client */' } };
const request = (path, options) => new Request('https://preview.example' + path, options);

test('Worker serves only explicit public assets with security headers and correct HEAD behavior', async () => {
  const worker = createWorker({ assets });
  const html = await worker.fetch(request('/'));
  assert.equal(html.status, 200);
  assert.match(await html.text(), /London/);
  assert.match(html.headers.get('Content-Security-Policy'), /script-src 'self'/);
  assert.equal(html.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.equal(await (await worker.fetch(request('/app.js', { method: 'HEAD' }))).text(), '');
  for (const path of ['/.env', '/server/tfl.mjs', '/lib.test.mjs', '/missing', '/%00'])
    assert.equal((await worker.fetch(request(path))).status, 404);
  assert.equal((await worker.fetch(request('/%', {}))).status, 400);
  assert.equal((await worker.fetch(request('/', { method: 'POST' }))).status, 405);
});

test('Worker runs demo route and board contract without contacting TfL', async () => {
  const worker = createWorker({ assets });
  const env = { DEMO_MODE: 'true' };
  const config = await (await worker.fetch(request('/api/config'), env)).json();
  assert.equal(config.demo, true);
  const route = await (await worker.fetch(request('/api/lines/central/route'), env)).json();
  const stop = route.data.stations[0];
  const response = await worker.fetch(request(`/api/stations/${stop.id}/arrivals?lineId=central&mode=tube`), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).source, 'demo');
  assert.equal((await worker.fetch(request('/api/missing'), env)).status, 404);
  assert.equal((await worker.fetch(request('/api/lines/%ZZ/route'), env)).status, 400);
  assert.equal((await worker.fetch(request('/api/lines', { method: 'HEAD' }), env)).status, 405);
  assert.equal((await worker.fetch(request('/api/health', { method: 'HEAD' }), env)).status, 200);
});

test('Worker reuses service within an isolate but refreshes it when key or mode changes', async () => {
  const configs = [];
  const worker = createWorker({ assets, serviceFactory: config => { configs.push(config); return {}; } });
  for (const env of [{ TFL_APP_KEY: 'first' }, { TFL_APP_KEY: 'first' },
    { TFL_APP_KEY: 'second' }, { TFL_APP_KEY: 'second', DEMO_MODE: 'true' }]) {
    const response = await worker.fetch(request('/api/config'), env);
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /first|second/);
  }
  assert.equal(configs.length, 3);
  assert.equal(configs[2].demo, true);
});

test('Worker sanitizes failed live calls, keeps demo off and extends pending request lifetime', async () => {
  const waits = [];
  const worker = createWorker({ assets, serviceFactory: () => ({ lines: async () => { throw new Error('private-key'); } }) });
  const response = await worker.fetch(request('/api/lines'), {}, { waitUntil: promise => waits.push(promise) });
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.source, 'tfl');
  assert.equal(body.data, null);
  assert.doesNotMatch(JSON.stringify(body), /private-key/);
  assert.equal(waits.length, 1);
  await Promise.all(waits);
});
