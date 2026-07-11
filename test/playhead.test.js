import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Playhead } from '../renderer/js/playhead.js';

// A controllable fake clock.
function fakeClock() {
  let t = 1000;
  const fn = () => t;
  fn.advance = (dt) => { t += dt; };
  return fn;
}

test('interpolates smoothly between ticks (§3.5)', () => {
  const clock = fakeClock();
  const ph = new Playhead(clock);
  ph.onTick({ ms: 5000, speed: 1, paused: false });
  clock.advance(8);          // 8ms of wall time since the tick
  assert.equal(ph.ms, 5008); // estimate advanced by 8ms, no new tick needed
});

test('a later tick corrects drift', () => {
  const clock = fakeClock();
  const ph = new Playhead(clock);
  ph.onTick({ ms: 5000, speed: 1 });
  clock.advance(100);
  ph.onTick({ ms: 5090, speed: 1 }); // game says 5090, our estimate said 5100 — snap to truth
  assert.equal(ph.ms, 5090);
});

test('speed scales the interpolation', () => {
  const clock = fakeClock();
  const ph = new Playhead(clock);
  ph.onTick({ ms: 0, speed: 2 });
  clock.advance(10);
  assert.equal(ph.ms, 20); // 2× speed → 20ms of song per 10ms wall
});

test('pause freezes the estimate', () => {
  const clock = fakeClock();
  const ph = new Playhead(clock);
  ph.onTick({ ms: 3000, speed: 1, paused: false });
  ph.onPause();
  const frozen = ph.ms;
  clock.advance(500);
  assert.equal(ph.ms, frozen); // no advance while paused
});

test('reset snaps hard (§3.5)', () => {
  const clock = fakeClock();
  const ph = new Playhead(clock);
  ph.onTick({ ms: 9000, speed: 1 });
  ph.onReset(3000);
  assert.equal(ph.ms, 3000);
});
