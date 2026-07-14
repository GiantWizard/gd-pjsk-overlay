import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Highway } from '../renderer/js/highway.js';

// Highway is constructible in Node with a stub canvas — the constructor only calls
// getContext. Drawing itself stays deliberately untested (covered by the Playwright
// smokes + screenshot review); these tests pin the memoization logic.
function makeHighway(opts = {}) {
  return new Highway({ getContext: () => ({}) }, opts);
}

function taps(times) {
  return times.map((t) => ({
    timeMs: t, type: 'tap', durationMs: 0, player: 1, gamemode: null, severity: 0,
  }));
}

test('_displayList is memoized with simplify ON (same reference across calls)', () => {
  const hw = makeHighway({ simplify: true });
  hw.setNotes(taps([0, 500, 1000]));
  assert.equal(hw._displayList(), hw._displayList());
});

test('_displayList is memoized with simplify OFF (the per-frame churn regression)', () => {
  const hw = makeHighway({ simplify: false });
  hw.setNotes(taps([0, 500, 1000]));
  const a = hw._displayList();
  const b = hw._displayList();
  assert.equal(a, b, 'raw view must not rebuild wrapper objects every call');
  assert.equal(a.length, 3);
  assert.equal(a[0].kind, 'note');
});

test('setNotes and setSimplify invalidate the display cache', () => {
  const hw = makeHighway({ simplify: true });
  hw.setNotes(taps([0, 500]));
  const a = hw._displayList();
  hw.setNotes(taps([0, 500, 1000]));
  assert.notEqual(hw._displayList(), a);
  const b = hw._displayList();
  hw.setSimplify(false);
  assert.notEqual(hw._displayList(), b);
});

test('resetTransients clears effects and re-arms crossing detection', () => {
  const hw = makeHighway();
  hw._effects.push({ at: 123 });
  hw._lastNow = 999;
  hw.resetTransients();
  assert.equal(hw._effects.length, 0);
  assert.equal(hw._lastNow, null);
  // first detect after a reset only re-arms — no crossings fire for the jumped range
  hw.setNotes(taps([100, 200, 300]));
  hw._detectCrossings(500);
  assert.equal(hw._effects.length, 0);
  assert.equal(hw._lastNow, 500);
});
