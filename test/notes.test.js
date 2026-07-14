import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveNotes, tagGamemodes, nearestIndex, countAtOrBefore } from '../shared/notes.js';

function macro(inputs, tps = 240) {
  return { tps, inputs: inputs.map((i) => ({ ...i, ms: (i.frame / tps) * 1000 })) };
}

test('short press → tap, long press → hold (§3.2)', () => {
  const m = macro([
    { frame: 0, down: true, button: 'jump', player: 1 },
    { frame: 2, down: false, button: 'jump', player: 1 },   // ~8ms → tap
    { frame: 100, down: true, button: 'jump', player: 1 },
    { frame: 130, down: false, button: 'jump', player: 1 }, // 125ms → hold
  ]);
  const notes = deriveNotes(m, { offsetMs: 0 });
  assert.equal(notes.length, 2);
  assert.equal(notes[0].type, 'tap');
  assert.equal(notes[0].durationMs, 0);
  assert.equal(notes[1].type, 'hold');
  assert.ok(notes[1].durationMs > 100);
});

test('per-player and per-button presses do not cross-pair', () => {
  const m = macro([
    { frame: 0, down: true, button: 'jump', player: 1 },
    { frame: 0, down: true, button: 'jump', player: 2 },
    { frame: 60, down: false, button: 'jump', player: 1 },
    { frame: 60, down: false, button: 'jump', player: 2 },
  ]);
  const notes = deriveNotes(m, { offsetMs: 0 });
  assert.equal(notes.length, 2);
  assert.deepEqual(notes.map((n) => n.player).sort(), [1, 2]);
});

test('discrete modes coerce a held button to a tap (§3.2)', () => {
  const m = macro([
    { frame: 0, down: true, button: 'jump', player: 1 },
    { frame: 120, down: false, button: 'jump', player: 1 }, // 500ms hold
  ]);
  const notes = deriveNotes(m, { offsetMs: 0 });
  assert.equal(notes[0].type, 'hold');
  // telemetry says this lands in spider (discrete) → coerced to tap
  const telem = [{ ms: 0, mode: 'spider', grav: 1 }, { ms: 500, mode: 'spider', grav: 1 }];
  tagGamemodes(notes, telem);
  assert.equal(notes[0].gamemode, 'spider');
  assert.equal(notes[0].type, 'tap');
});

test('hold survives in a holdable mode (ship)', () => {
  const m = macro([
    { frame: 0, down: true, button: 'jump', player: 1 },
    { frame: 120, down: false, button: 'jump', player: 1 },
  ]);
  const notes = deriveNotes(m, { offsetMs: 0 });
  tagGamemodes(notes, [{ ms: 0, mode: 'ship', grav: 1 }, { ms: 500, mode: 'ship', grav: 1 }]);
  assert.equal(notes[0].type, 'hold');
});

test('the global offset is applied in exactly one place (§6.3)', () => {
  const m = macro([
    { frame: 0, down: true, button: 'jump', player: 1 },
    { frame: 2, down: false, button: 'jump', player: 1 },
  ]);
  const notes = deriveNotes(m, { offsetMs: 30 });
  assert.equal(notes[0].timeMs, 30);
  assert.equal(notes[0]._rawTimeMs, 0); // join key stays pre-offset
});

test('nearestIndex binary search', () => {
  const arr = [0, 10, 20, 30, 40];
  assert.equal(nearestIndex(arr, -5), 0);
  assert.equal(nearestIndex(arr, 12), 1);
  assert.equal(nearestIndex(arr, 16), 2);
  assert.equal(nearestIndex(arr, 100), 4);
});

test('countAtOrBefore derives a stable count from the playhead', () => {
  const arr = [100, 200, 300, 400];
  assert.equal(countAtOrBefore([], 500), 0);       // empty
  assert.equal(countAtOrBefore(arr, 50), 0);       // before first
  assert.equal(countAtOrBefore(arr, 100), 1);      // exact hit counts
  assert.equal(countAtOrBefore(arr, 250), 2);      // between values
  assert.equal(countAtOrBefore(arr, 400), 4);      // exact last
  assert.equal(countAtOrBefore(arr, 9999), 4);     // after last
});
