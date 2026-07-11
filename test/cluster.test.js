import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collapseForDisplay } from '../shared/cluster.js';

function taps(times, mode = 'wave', player = 1) {
  return times.map((t) => ({
    timeMs: t, type: 'tap', durationMs: 0, player, gamemode: mode, severity: 0,
  }));
}

test('a dense toggle burst collapses into one squiggle (§3.3)', () => {
  // 6 taps 30ms apart, all within the 40ms merge gap
  const notes = taps([0, 30, 60, 90, 120, 150]);
  const out = collapseForDisplay(notes, { mergeGapMs: 40, squiggleMin: 3 });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'squiggle');
  assert.equal(out[0].toggleCount, 6);
  assert.equal(out[0].startMs, 0);
  assert.equal(out[0].endMs, 150);
});

test('sparse taps pass through untouched (non-destructive)', () => {
  const notes = taps([0, 500, 1000]);
  const out = collapseForDisplay(notes, { mergeGapMs: 40, squiggleMin: 3 });
  assert.equal(out.length, 3);
  assert.ok(out.every((o) => o.kind === 'note'));
  // original note objects are preserved by reference — nothing was mutated/merged
  assert.equal(out[0].note.timeMs, 0);
});

test('a mode change breaks a cluster', () => {
  const notes = [...taps([0, 30], 'wave'), ...taps([60, 90], 'ship')];
  const out = collapseForDisplay(notes, { mergeGapMs: 40, squiggleMin: 1 });
  // two separate squiggles, one per mode
  assert.equal(out.length, 2);
  assert.equal(out[0].gamemode, 'wave');
  assert.equal(out[1].gamemode, 'ship');
});

test('a small cluster below threshold stays as individual notes', () => {
  const notes = taps([0, 30]); // 2 toggles, squiggleMin 3
  const out = collapseForDisplay(notes, { mergeGapMs: 40, squiggleMin: 3 });
  assert.equal(out.length, 2);
  assert.ok(out.every((o) => o.kind === 'note'));
});
