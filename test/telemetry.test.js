import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTelemetry } from '../shared/telemetry.js';

test('parses well-formed JSONL', () => {
  const text = [
    '{"f":0,"ms":0,"x":1,"y":2,"vy":0,"rot":0,"mode":"cube","grav":1,"held":false,"dead":false}',
    '{"f":1,"ms":4.17,"x":6,"y":2,"vy":-1,"rot":10,"mode":"ship","grav":1,"held":true,"dead":false}',
  ].join('\n');
  const ticks = parseTelemetry(text);
  assert.equal(ticks.length, 2);
  assert.equal(ticks[1].mode, 'ship');
  assert.equal(ticks[1].held, true);
});

test('tolerates a truncated final line (crash mid-replay, §2.6)', () => {
  const text =
    '{"f":0,"ms":0,"x":1,"y":2,"vy":0,"rot":0,"mode":"cube","grav":1,"held":false,"dead":false}\n' +
    '{"f":1,"ms":4.17,"x":6,"y":2,"vy":-1,"rot":10,"mode":"shi'; // cut off
  const ticks = parseTelemetry(text);
  assert.equal(ticks.length, 1); // the partial line is skipped, not thrown on
});

test('throws on corruption in a NON-final line', () => {
  const text =
    '{"f":0,"ms":0}\n' +
    '{oops not json}\n' +
    '{"f":2,"ms":8}';
  assert.throws(() => parseTelemetry(text), /Corrupt telemetry at line 2/);
});
