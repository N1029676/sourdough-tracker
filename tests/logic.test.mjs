import test from 'node:test';
import assert from 'node:assert/strict';
import {
  proposeFeeding, actualRatio, peakHours, planFeedTime, inQuietHours,
  alternatives, calibrationFactor, toICS, HOUR,
} from '../js/logic.js';

const R111 = { starter: 1, flour: 1, water: 1 };
const R155 = { starter: 1, flour: 5, water: 5 };

test('proposeFeeding 1:1:1 with excess starter', () => {
  const p = proposeFeeding({ grossG: 330, tareG: 230, keepG: 50, ratio: R111 });
  assert.equal(p.starterG, 100);
  assert.equal(p.discardG, 50);
  assert.equal(p.flourG, 50);
  assert.equal(p.waterG, 50);
  assert.equal(p.totalG, 150);
  assert.deepEqual(p.targets, { afterDiscard: 280, afterFlour: 330, afterWater: 380 });
});

test('proposeFeeding custom ratio', () => {
  const p = proposeFeeding({ grossG: 300, tareG: 200, keepG: 20, ratio: R155 });
  assert.equal(p.discardG, 80);
  assert.equal(p.flourG, 100);
  assert.equal(p.waterG, 100);
});

test('proposeFeeding with less starter than keep: no discard, scale to what is there', () => {
  const p = proposeFeeding({ grossG: 230, tareG: 200, keepG: 50, ratio: R111 });
  assert.equal(p.lowStarter, true);
  assert.equal(p.discardG, 0);
  assert.equal(p.flourG, 30);
  assert.equal(p.waterG, 30);
});

test('proposeFeeding rejects bad input', () => {
  assert.ok(proposeFeeding({ grossG: 100, tareG: 200, keepG: 50, ratio: R111 }).error);
  assert.ok(proposeFeeding({ grossG: 300, tareG: 200, keepG: 0, ratio: R111 }).error);
});

test('actualRatio', () => {
  const r = actualRatio({ starterG: 100, discardG: 50, flourG: 100, waterG: 75 });
  assert.deepEqual(r, { starter: 1, flour: 2, water: 1.5 });
  assert.equal(actualRatio({ starterG: 50, discardG: 50, flourG: 1, waterG: 1 }), null);
});

test('peakHours is in the expected ballpark at 24C', () => {
  const a = peakHours({ ratio: R111, tempC: 24 });
  const b = peakHours({ ratio: { starter: 1, flour: 2, water: 2 }, tempC: 24 });
  const c = peakHours({ ratio: R155, tempC: 24 });
  assert.ok(a > 4 && a < 6.5, a);
  assert.ok(b > 6 && b < 9, b);
  assert.ok(c > 9.5 && c < 12, c);
});

test('peakHours: monotonic in ratio and temperature, factor scales', () => {
  assert.ok(peakHours({ ratio: R155, tempC: 24 }) > peakHours({ ratio: R111, tempC: 24 }));
  assert.ok(peakHours({ ratio: R111, tempC: 18 }) > peakHours({ ratio: R111, tempC: 26 }));
  const base = peakHours({ ratio: R111, tempC: 22 });
  assert.ok(Math.abs(peakHours({ ratio: R111, tempC: 22, factor: 1.2 }) - base * 1.2) < 1e-9);
  // clamped: absurd temps do not blow up
  assert.ok(Number.isFinite(peakHours({ ratio: R111, tempC: -50 })));
});

test('planFeedTime works backward from mix time', () => {
  const mixAt = new Date('2026-11-15T09:00:00');
  const p = planFeedTime({ mixAt, ratio: R111, tempC: 24 });
  assert.ok(Math.abs(+mixAt - +p.feedAt - p.hours * HOUR) < 1);
  assert.ok(+p.window.from < +p.window.peak && +p.window.peak < +p.window.to);
});

test('inQuietHours handles wrap past midnight', () => {
  const q = { start: '23:00', end: '06:30' };
  assert.equal(inQuietHours(new Date('2026-11-15T02:00:00'), q), true);
  assert.equal(inQuietHours(new Date('2026-11-15T23:30:00'), q), true);
  assert.equal(inQuietHours(new Date('2026-11-15T07:00:00'), q), false);
  assert.equal(inQuietHours(new Date('2026-11-15T12:00:00'), q), false);
});

test('alternatives avoids quiet hours and recommends a waking-hour ratio', () => {
  const mixAt = new Date('2026-11-16T09:00:00');
  const quiet = { start: '23:00', end: '06:30' };
  const now = new Date('2026-11-14T12:00:00');
  const { rows, recommended } = alternatives({ mixAt, tempC: 24, quiet, now, current: R111 });
  // 1:1:1 feeds ~03:45 (quiet) so it must not be recommended
  const r111 = rows.find((r) => r.ratio === R111 || r.ratio.flour === 1);
  assert.equal(r111.quiet, true);
  assert.ok(recommended);
  assert.equal(recommended.quiet, false);
  assert.equal(recommended.past, false);
});

test('calibrationFactor uses logged peaks', () => {
  assert.deepEqual(calibrationFactor([]), { factor: 1, samples: 0 });
  const predicted = peakHours({ ratio: R111, tempC: 24 });
  const at = new Date('2026-11-10T08:00:00');
  const mk = (mult) => ({
    at: at.toISOString(),
    peakAt: new Date(+at + predicted * mult * HOUR).toISOString(),
    roomTempC: 24,
    ratioPlanned: R111,
    starterG: 100,
    actual: { discardG: 50, flourG: 50, waterG: 50 },
  });
  const c = calibrationFactor([mk(1.2), mk(1.2), mk(1.2)]);
  assert.equal(c.samples, 3);
  assert.ok(Math.abs(c.factor - 1.12) < 1e-6); // 1 + 0.2 * 3/5
  // peaks under 1h are ignored
  assert.equal(calibrationFactor([mk(0.01)]).samples, 0);
});

test('toICS produces a VEVENT', () => {
  const s = toICS({ title: 'Feed starter', start: new Date('2026-11-15T04:00:00Z') });
  assert.match(s, /BEGIN:VEVENT/);
  assert.match(s, /DTSTART:20261115T040000Z/);
  assert.match(s, /SUMMARY:Feed starter/);
});
