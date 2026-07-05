'use strict';

/* Node test suite for the pure period-key helpers in backend/periods.mjs.
   Run: node tests/backend-periods.test.js
   Mirrors the lightweight harness of tests/logic.test.js. */

import assert from 'node:assert';
import { periodKeys, periodKeyFor, isoWeekYear } from '../backend/periods.mjs';

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push({ name, err });
  }
}

/* ---- Day key: UTC yyyy-mm-dd, zero-padded ---- */

test('day key is D# + zero-padded UTC yyyy-mm-dd', () => {
  assert.strictEqual(periodKeys(Date.UTC(2026, 6, 4, 12, 0, 0)).day, 'D#2026-07-04');
  // Single-digit month and day both pad to two digits.
  assert.strictEqual(periodKeys(Date.UTC(2026, 0, 5, 0, 0, 0)).day, 'D#2026-01-05');
  // The UTC calendar day is used regardless of the time of day.
  assert.strictEqual(periodKeys(Date.UTC(2026, 6, 4, 23, 59, 59)).day, 'D#2026-07-04');
});

test('all key is the constant ALL', () => {
  assert.strictEqual(periodKeys(Date.UTC(2026, 6, 4)).all, 'ALL');
  assert.strictEqual(periodKeys(0).all, 'ALL');
});

/* ---- Week key: ISO-8601 week date, GGGG-Www ---- */

test('week key is W# + zero-padded ISO week-year and week', () => {
  // Mid-year sanity: 2026-07-04 (Sat) falls in ISO 2026-W27.
  assert.strictEqual(periodKeys(Date.UTC(2026, 6, 4, 12)).week, 'W#2026-W27');
  // Week zero-pads to two digits.
  assert.strictEqual(periodKeys(Date.UTC(2025, 0, 6, 12)).week, 'W#2025-W02');
});

test('ISO week-year can differ from the calendar year (Jan boundary)', () => {
  // 2027-01-01 (Fri) belongs to the last ISO week of 2026.
  assert.strictEqual(periodKeys(Date.UTC(2027, 0, 1, 12)).week, 'W#2026-W53');
  const a = isoWeekYear(Date.UTC(2027, 0, 1, 12));
  assert.strictEqual(a.isoYear, 2026);
  assert.strictEqual(a.week, 53);
});

test('ISO week-year can differ from the calendar year (Dec boundary)', () => {
  // 2024-12-30 (Mon) is already in the first ISO week of 2025.
  assert.strictEqual(periodKeys(Date.UTC(2024, 11, 30, 12)).week, 'W#2025-W01');
  const a = isoWeekYear(Date.UTC(2024, 11, 30, 12));
  assert.strictEqual(a.isoYear, 2025);
  assert.strictEqual(a.week, 1);
});

test('every week key matches the GGGG-Www shape', () => {
  for (let m = 0; m < 12; m++) {
    for (let d = 1; d <= 28; d += 9) {
      const key = periodKeys(Date.UTC(2026, m, d, 6)).week;
      assert.ok(/^W#\d{4}-W\d{2}$/.test(key), 'bad week key ' + key);
    }
  }
});

/* ---- periodKeyFor: name -> single key ---- */

test('periodKeyFor maps names and defaults unknown to all-time', () => {
  const t = Date.UTC(2026, 6, 4, 12);
  const keys = periodKeys(t);
  assert.strictEqual(periodKeyFor('all', t), keys.all);
  assert.strictEqual(periodKeyFor('day', t), keys.day);
  assert.strictEqual(periodKeyFor('week', t), keys.week);
  assert.strictEqual(periodKeyFor('nonsense', t), 'ALL');
  assert.strictEqual(periodKeyFor(undefined, t), 'ALL');
});

/* ---- Report ---- */

if (failures.length) {
  for (const f of failures) {
    console.error('FAIL: ' + f.name);
    console.error('  ' + (f.err && f.err.message));
  }
  console.error('\n' + passed + ' passed, ' + failures.length + ' failed');
  process.exit(1);
} else {
  console.log('All ' + passed + ' tests passed');
}
