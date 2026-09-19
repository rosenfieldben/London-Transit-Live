import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteStore, visibleLines, networkSummary } from './network.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
test('network loader shares requests, bounds concurrency and prioritizes a selected line', async () => {
  const started = [], finish = new Map();
  const routes = new RouteStore(id => { started.push(id); return new Promise(resolve => finish.set(id, resolve)); });
  const a = routes.get('a'), b = routes.get('b'), c = routes.get('c'), d = routes.get('d');
  assert.equal(routes.get('a'), a);
  assert.equal(routes.get('d', { priority: true }), d);
  await tick();
  assert.deepEqual(started, ['a', 'b']);
  finish.get('a')({ data: 'a' }); await a; await tick();
  assert.deepEqual(started, ['a', 'b', 'd']);
  finish.get('b')({ data: 'b' }); await b; await tick();
  assert.deepEqual(started, ['a', 'b', 'd', 'c']);
  finish.get('c')({ data: 'c' }); finish.get('d')({ data: 'd' });
  await Promise.all([c, d]);
  assert.deepEqual(await routes.get('a'), { data: 'a' });
  assert.equal(started.length, 4);
});

test('a failed route does not prevent other routes loading and can be retried', async () => {
  let fail = true;
  const routes = new RouteStore(async id => { if (id === 'bad' && fail) throw new Error('offline'); return { data: id }; });
  const results = await Promise.allSettled([routes.get('bad'), routes.get('good')]);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'fulfilled');
  await tick(); fail = false;
  assert.deepEqual(await routes.get('bad'), { data: 'bad' });
});

test('browser route cache expires and saved provider routes have a shorter lifetime', async () => {
  let now = 0, calls = 0;
  const routes = new RouteStore(async () => ({ data: ++calls, stale: true }), { now: () => now });
  await routes.get('a'); await tick();
  now = 59999; assert.equal(routes.peek('a').data, 1);
  now = 60000; assert.equal(routes.peek('a'), null);
  assert.equal((await routes.get('a')).data, 2);
});

test('mode coverage and partial progress count only visible lines, including failed refreshes', () => {
  const lines = [{ id: 'central', mode: 'tube' }, { id: 'thameslink', mode: 'national-rail' }, { id: 'dlr', mode: 'dlr' }];
  const routes = new Map([['central', {}], ['thameslink', { stale: true }]]);
  const errors = new Map([['dlr', 'offline'], ['thameslink', 'refresh failed']]);
  assert.deepEqual(visibleLines(lines, 'national-rail').map(line => line.id), ['thameslink']);
  assert.deepEqual(networkSummary(visibleLines(lines, 'all'), routes, errors), { total: 3, loaded: 2, failed: 2, stale: 1 });
  assert.deepEqual(networkSummary(visibleLines(lines, 'tube'), routes, errors), { total: 1, loaded: 1, failed: 0, stale: 0 });
});
