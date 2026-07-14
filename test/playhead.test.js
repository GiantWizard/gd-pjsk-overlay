import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Playhead, DemoClock } from '../renderer/js/playhead.js';

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

// ── DemoClock (watch-a-macro transport) ───────────────────────────────────────

test('DemoClock advances in real time and loops modulo duration', () => {
  const clock = fakeClock();
  const dc = new DemoClock(1000, clock);
  clock.advance(400);
  assert.equal(dc.ms, 400);
  clock.advance(1100);   // total 1500 → wraps at 1000
  assert.equal(dc.ms, 500);
});

test('DemoClock seek snaps hard and clamps to [0, duration]', () => {
  const clock = fakeClock();
  const dc = new DemoClock(1000, clock);
  dc.seek(700);
  assert.equal(dc.ms, 700);
  dc.seek(-50);
  assert.equal(dc.ms, 0);
  dc.seek(99999);
  assert.equal(dc.ms, 0); // the clock loops: position `duration` ≡ 0 (the loop point)
});

test('DemoClock seek while paused stays paused at the new position', () => {
  const clock = fakeClock();
  const dc = new DemoClock(1000, clock);
  dc.toggle(); // pause
  dc.seek(300);
  clock.advance(500);
  assert.equal(dc.paused, true);
  assert.equal(dc.ms, 300); // frozen at the seek target
});

test('DemoClock speed change is continuous at the moment of the change', () => {
  const clock = fakeClock();
  const dc = new DemoClock(10000, clock);
  clock.advance(100);      // ms = 100 at 1×
  dc.speed = 2;
  clock.advance(10);       // +20 song-ms at 2×
  assert.equal(dc.ms, 120);
});

test('DemoClock pause freezes and resume continues from the frozen point', () => {
  const clock = fakeClock();
  const dc = new DemoClock(10000, clock);
  clock.advance(250);
  dc.toggle(); // pause at 250
  clock.advance(500);
  assert.equal(dc.ms, 250);
  dc.toggle(); // resume
  clock.advance(50);
  assert.equal(dc.ms, 300);
});
