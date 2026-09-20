import test from 'node:test';
import assert from 'node:assert/strict';
import { stationIndex, searchStations, favouriteKey, readFavourites, parseView, viewHash } from './explorer.mjs';

const lines = [{ id: 'thameslink', name: 'Thameslink', mode: 'national-rail', boardProvider: 'tfl' }, { id: 'east-midlands-railway', name: 'East Midlands Railway', mode: 'national-rail', boardProvider: 'national-rail' }];
const envelope = stations => ({ data: { stations } });
test('search groups only exact stop IDs and retains route-specific board choices', () => {
  const index = stationIndex(lines, new Map([
    ['thameslink', envelope([{ id: '910GSTPXBOX', name: 'St Pancras International (low level)', lines: ['invented'] }, { id: '910GLTN', name: 'Luton' }])],
    ['east-midlands-railway', envelope([{ id: '910GSTPANCI', name: 'St Pancras International', lat: 51.53, lon: -.12 }, { id: '910GLTN', name: 'Luton' }])],
  ]));
  assert.equal(index.length, 3);
  const luton = searchStations(index, 'LUTON')[0];
  assert.deepEqual(luton.services.map(item => item.lineId), ['east-midlands-railway', 'thameslink']);
  assert.deepEqual(luton.services.map(item => item.boardProvider), ['national-rail', 'tfl']);
  assert.equal(searchStations(index, 'pancras st').length, 2);
  assert.equal(searchStations(index, 'low level')[0].services[0].stationId, '910GSTPXBOX');
  assert.equal(searchStations(index, 'invented').length, 0);
  const names = stationIndex([lines[0]], new Map([['thameslink', envelope([{ id: 'one', name: 'London Bridge' }, { id: 'two', name: 'Cambridge Heath (London)' }, { id: 'three', name: "King’s Cross" }])]]));
  assert.deepEqual(searchStations(names, 'London Bridge').map(item => item.id), ['one']);
  assert.equal(searchStations(names, 'kings cross')[0].id, 'three');
});
test('missing routes add no invented stations and a shared ID retains name aliases', () => {
  const index = stationIndex(lines, new Map([
    ['thameslink', envelope([{ id: '910GLTN', name: 'Luton Airport' }])],
    ['east-midlands-railway', envelope([{ id: '910GLTN', name: 'Lúton (Parkway)' }])],
  ]));
  assert.equal(searchStations(index, 'luton parkway').length, 1);
  assert.equal(searchStations(index, 'airport').length, 1);
  assert.deepEqual(stationIndex(lines, new Map()), []);
});
test('favourites validate version, bound input and deduplicate exact service/station pairs', () => {
  const item = { lineId: 'thameslink', stationId: '910GLTN', name: 'Luton', lineName: 'Thameslink' };
  const items = readFavourites(JSON.stringify({ version: 1, items: [item, item, { ...item, lineId: 'east-midlands-railway' }, { ...item, stationId: '../secret' }, null] }));
  assert.equal(items.length, 2);
  assert.equal(favouriteKey(items[0]), 'thameslink:910GLTN');
  for (const raw of [null, '', '{', 'null', '{"version":2,"items":[]}', '{"version":1,"items":{}}']) assert.deepEqual(readFavourites(raw), []);
  assert.equal(readFavourites(JSON.stringify({ version: 1, items: Array.from({ length: 100 }, (_, n) => ({ ...item, stationId: 'station-' + n })) })).length, 50);
});
test('view links round-trip exact station, service, visibility and camera', () => {
  const state = { mode: 'national-rail', mapView: 'network', mapArea: 'england', lineId: 'thameslink', stationId: '910GSTPXBOX', hiddenLines: new Set(['northern-rail', 'central']) };
  const camera = { lat: 51.53217, lon: -.12734, zoom: 12.5 };
  assert.deepEqual(parseView(viewHash(state, camera)), { ...state, camera });
});
test('untrusted fragments cannot introduce invalid identifiers, controls or cameras', () => {
  const parsed = parseView('#mode=script&view=other&area=world&line=../private&station=910GLTN&hidden=central,%3Csvg%3E&lat=999&lon=0&zoom=20');
  assert.deepEqual(parsed, { mode: 'all', mapView: 'network', mapArea: 'england', lineId: null, stationId: null, hiddenLines: new Set(['central']), camera: null });
  assert.equal(parseView('#line=' + 'a'.repeat(81)).lineId, null);
  assert.equal(parseView('#lat=&lon=&zoom=').camera, null);
  assert.equal(parseView('#line=removed-service&station=removed-station').stationId, 'removed-station'); // UI must validate current membership; never silently substitute.
});
