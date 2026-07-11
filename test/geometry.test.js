import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  visibleWindow, progress, yForDelta, notesInRange, perspectiveScale, laneCenter,
} from '../renderer/js/geometry.js';

test('note y is strictly LINEAR in delta time (§7.4)', () => {
  const H = 1000, line = 720, LA = 1500;
  const yAtLine = yForDelta(0, line, H, LA);
  const yHalf = yForDelta(750, line, H, LA);
  const yFull = yForDelta(1500, line, H, LA);
  assert.equal(yAtLine, 720);           // delta 0 lands ON the hit line, no fudge
  assert.equal(yHalf, 720 - 500);       // exactly halfway up
  assert.equal(yFull, 720 - 1000);      // full lookahead at the top
  // linearity: equal time gaps → equal pixel gaps (this is the readability guarantee)
  assert.equal(yAtLine - yHalf, yHalf - yFull);
});

test('evenly-spaced clicks render evenly spaced (the point of §7.4)', () => {
  const H = 900, line = 650, LA = 1500;
  const ys = [0, 200, 400, 600].map((d) => yForDelta(d, line, H, LA));
  const gaps = [ys[0] - ys[1], ys[1] - ys[2], ys[2] - ys[3]];
  assert.ok(Math.abs(gaps[0] - gaps[1]) < 1e-9);
  assert.ok(Math.abs(gaps[1] - gaps[2]) < 1e-9);
});

test('visibleWindow keeps a small negative past window (§3.4)', () => {
  const [lo, hi] = visibleWindow(10000, 1500, 200);
  assert.equal(lo, 9800);
  assert.equal(hi, 11500);
});

test('notesInRange includes holds that overlap the window edge', () => {
  const notes = [
    { timeMs: 9000, type: 'tap', durationMs: 0 },   // before window
    { timeMs: 9700, type: 'hold', durationMs: 400 }, // starts before lo(9800) but overlaps
    { timeMs: 10500, type: 'tap', durationMs: 0 },  // inside
    { timeMs: 20000, type: 'tap', durationMs: 0 },  // after
  ];
  const inRange = notesInRange(notes, visibleWindow(10000));
  assert.ok(inRange.includes(notes[1]));
  assert.ok(inRange.includes(notes[2]));
  assert.ok(!inRange.includes(notes[0]));
  assert.ok(!inRange.includes(notes[3]));
});

test('perspective shrinks with depth; flat scale is 1 at the line', () => {
  assert.equal(perspectiveScale(0), 1);
  assert.ok(perspectiveScale(1) < 1);
  assert.ok(perspectiveScale(0.5) > perspectiveScale(1));
});

test('lane centers: single-button is one lane, dual splits P1/P2', () => {
  assert.equal(laneCenter(1, false), 0.5);
  assert.ok(laneCenter(1, true) < laneCenter(2, true));
});
