import test from 'node:test';
import assert from 'node:assert/strict';
import { routeBounds, distinctPaths, AutoFrame, spacedStations, stationLabels } from './map.mjs';

const london = { paths: [[[51.45, -.25], [51.6, .15]]], stations: [{ lat: 55, lon: -4 }] };
const national = { paths: [[[51.5, -.1], [55.9, -3.2]]] };
test('camera bounds follow complete visible geometry and shrink when distant services are hidden', () => {
  assert.deepEqual(routeBounds([london, national]), [[51.45, -3.2], [55.9, .15]]);
  assert.deepEqual(routeBounds([london]), [[51.45, -.25], [51.6, .15]]);
  assert.deepEqual(routeBounds([{ stations: [{ lat: 53.96, lon: -1.08 }] }]), [[53.96, -1.08], [53.96, -1.08]]);
  assert.equal(routeBounds([{ paths: [[[NaN, 0], [0, 0]]], stations: [{ lat: Infinity, lon: 0 }] }]), null);
  assert.equal(routeBounds([]), null);
});
test('route painting removes reversed shared edges without adding branch connections', () => {
  const a = [51.5, -.1], b = [51.6, -.2], c = [51.7, -.3], d = [51.8, -.4];
  assert.deepEqual(distinctPaths([[a,b,c], [c,b,a], [b,d]]), [[a,b,c], [b,d]]);
  assert.deepEqual(distinctPaths([[a, [0,0], b, c]]), [[b,c]]);
});
test('automatic fits settle once and cannot override manual exploration or a newer selection', () => {
  const frame = new AutoFrame(), small = routeBounds([london]), large = routeBounds([national]);
  frame.request('network:london,national');
  assert.deepEqual(frame.take('network:london,national', small, true), small);
  assert.equal(frame.take('network:london,national', large, true), null);
  assert.deepEqual(frame.take('network:london,national', large, false), large);
  assert.equal(frame.take('network:london,national', small, false), null); // polling
  frame.request('line:london'); frame.request('line:national');
  assert.equal(frame.take('line:london', small, false), null); // old response
  frame.cancel();
  assert.equal(frame.take('line:national', large, false), null); // manual or restored camera
});
test('empty and failed selections never produce an invalid camera update', () => {
  const frame = new AutoFrame(); frame.request('line:pending');
  assert.equal(frame.take('line:pending', null, true), null);
  assert.ok(frame.intent);
  assert.equal(frame.take('line:pending', null, false), null);
  assert.equal(frame.intent, null);
});
test('station thinning retains the selected identity and reveals separated stops at close zoom', () => {
  const points = [{ id: 'a', x: 100, y: 100 }, { id: 'selected', x: 102, y: 101 }, { id: 'b', x: 200, y: 200 }, { id: 'offscreen', x: 700, y: 100 }];
  assert.deepEqual(spacedStations(points, 'selected', { width: 400, height: 400 }).map(x => x.id), ['selected', 'b']);
  const close = points.map(item => item.id === 'a' ? { ...item, x: 60 } : item);
  assert.deepEqual(spacedStations(close, 'selected', { width: 400, height: 400 }).map(x => x.id), ['selected', 'a', 'b']);
});
test('station labels remain sparse at national scale and avoid overlapping names', () => {
  const points = [{ id: 'selected', name: 'York', x: 100, y: 150 }, { id: 'b', name: 'Nearby', x: 120, y: 152 }, { id: 'c', name: 'London Bridge', x: 100, y: 250 }];
  assert.deepEqual([...stationLabels(points, 'selected', { width: 400, height: 400, zoom: 6 }).keys()], ['selected']);
  const labels = stationLabels(points, 'selected', { width: 400, height: 400, zoom: 12 });
  assert.ok(labels.has('selected')); assert.ok(labels.has('c')); assert.equal(labels.has('b'), false);
});
