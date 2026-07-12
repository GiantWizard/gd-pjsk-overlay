import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMacro, readTps, frameToMs, MacroError } from '../shared/gdr.js';
import { synthMacro } from '../shared/synth.js';

test('frameToMs uses TPS, not a hardcoded 60', () => {
  assert.equal(frameToMs(240, 240), 1000);
  assert.equal(frameToMs(240, 60), 4000);
  // the 4× trap (§3.1): same frame, different TPS, 4× apart
  assert.equal(frameToMs(4800, 240) / frameToMs(4800, 60), 0.25);
});

test('readTps refuses to silently assume 60 (§3.1)', () => {
  assert.throws(() => readTps({ inputs: [] }), MacroError);
  assert.equal(readTps({ framerate: 240 }), 240);
  assert.equal(readTps({ fps: 60 }), 60);
});

test('parseMacro reads a GDR-style JSON with defensive input keys', () => {
  const raw = {
    framerate: 240,
    botInfo: { name: 'xdBot', version: '4' },
    levelInfo: { id: 128, name: 'demo' },
    inputs: [
      { frame: 0, btn: 1, down: true, '2p': false },
      { frame: 12, btn: 1, down: false, '2p': false },
    ],
  };
  const m = parseMacro(raw);
  assert.equal(m.tps, 240);
  assert.equal(m.botName, 'xdBot');
  assert.equal(m.level.id, 128);
  assert.equal(m.inputs.length, 2);
  assert.equal(m.inputs[0].ms, 0);
  assert.equal(m.inputs[1].ms, frameToMs(12, 240));
  assert.equal(m.inputs[0].button, 'jump');
});

test('parseMacro accepts a raw JSON string and the synthetic macro', () => {
  const m = parseMacro(JSON.stringify(synthMacro()));
  assert.equal(m.tps, 240);
  assert.ok(m.inputs.length > 20);
});

// GDR2 binary decoding is covered in test/gdr2.test.js — real GDR2 is a custom positional
// binary stream, not msgpack (see shared/gdr2.js's header comment for why an earlier
// version of this test, which hand-encoded a fake "GDR2 msgpack" fixture, was testing a
// wrong premise).

test('parseMacro accepts explicit tps when metadata is missing', () => {
  const raw = {
    inputs: [{ frame: 0, btn: 1, down: true }, { frame: 24, btn: 1, down: false }],
  };
  const m = parseMacro(raw, { tps: 240 });
  assert.equal(m.tps, 240);
  assert.equal(m.inputs[1].ms, 100);
});
