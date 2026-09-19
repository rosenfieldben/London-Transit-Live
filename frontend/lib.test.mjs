import test from 'node:test';
import assert from 'node:assert/strict';
import { arrivalTiming, currentPredictions, isStale, londonTime, safeColor, escapeHTML } from './lib.mjs';

const now = Date.parse('2026-09-19T11:00:00Z');
const prediction = { expectedArrival: '2026-09-19T11:03:00Z' };
const fresh = { fetchedAt: '2026-09-19T11:00:00Z', stale: false };

test('fresh predictions have a countdown', () => assert.deepEqual(arrivalTiming(prediction, fresh, now), { value: '3', label: 'min', small: false }));
test('stale predictions retain London wall-clock time and never count down', () => assert.deepEqual(arrivalTiming(prediction, { ...fresh, stale: true }, now), { value: '12:03', label: 'Saved prediction', small: true }));
test('old and missing fetch times are stale even if server flag is false', () => { assert.equal(isStale(fresh, now + 91000), true); assert.equal(isStale({}, now), true); });
test('expired predictions leave the board', () => { assert.equal(currentPredictions([prediction], now + 300000).length, 0); assert.equal(currentPredictions([{ ...prediction, validUntil: '2026-09-19T10:59:00Z' }], now).length, 0); });
test('old provider predictions do not get fresh countdowns', () => assert.equal(arrivalTiming({ ...prediction, sourceTimestamp: '2026-09-19T10:57:00Z' }, fresh, now).label, 'Saved prediction'));
test('scheduled times are not presented as live predictions', () => assert.equal(arrivalTiming({ ...prediction, scheduled: true }, fresh, now).label, 'Scheduled'));
test('stale schedules remain labelled as schedules', () => assert.equal(arrivalTiming({ ...prediction, scheduled: true }, { ...fresh, stale: true }, now).label, 'Saved schedule'));
test('London formatting respects British summer and winter time', () => { assert.equal(londonTime('2026-09-19T11:00:00Z'), '12:00'); assert.equal(londonTime('2026-12-19T11:00:00Z'), '11:00'); });
test('remote colors and text cannot inject markup', () => { assert.equal(safeColor('#6950a1'), '#6950a1'); assert.equal(safeColor('red;position:fixed'), '#566b84'); assert.equal(escapeHTML('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'); });
