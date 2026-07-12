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

test('parseMacro reads GDR2 msgpack bytes', () => {
  // hand-encode a tiny msgpack map equivalent to a GDR header
  const bytes = encodeSimple({
    framerate: 240,
    inputs: [{ frame: 0, btn: 1, down: true }, { frame: 24, btn: 1, down: false }],
  });
  const m = parseMacro(bytes);
  assert.equal(m.tps, 240);
  assert.equal(m.inputs.length, 2);
  assert.equal(m.inputs[1].ms, 100);
});

test('parseMacro accepts explicit tps when metadata is missing', () => {
  const raw = {
    inputs: [{ frame: 0, btn: 1, down: true }, { frame: 24, btn: 1, down: false }],
  };
  const m = parseMacro(raw, { tps: 240 });
  assert.equal(m.tps, 240);
  assert.equal(m.inputs[1].ms, 100);
});

// ── minimal msgpack encoder, test-only, mirrors the decoder's supported subset ──
function encodeSimple(value) {
  const bytes = [];
  const enc = new TextEncoder();
  function w(v) {
    if (v === null) { bytes.push(0xc0); return; }
    if (v === true) { bytes.push(0xc3); return; }
    if (v === false) { bytes.push(0xc2); return; }
    if (typeof v === 'number') {
      if (Number.isInteger(v) && v >= 0 && v <= 0x7f) { bytes.push(v); return; }
      // use float64 for everything else
      const buf = new ArrayBuffer(8); new DataView(buf).setFloat64(0, v);
      bytes.push(0xcb, ...new Uint8Array(buf)); return;
    }
    if (typeof v === 'string') {
      const s = enc.encode(v);
      bytes.push(0xd9, s.length, ...s); return;
    }
    if (Array.isArray(v)) {
      bytes.push(0xdc, (v.length >> 8) & 0xff, v.length & 0xff);
      v.forEach(w); return;
    }
    if (typeof v === 'object') {
      const keys = Object.keys(v);
      bytes.push(0xde, (keys.length >> 8) & 0xff, keys.length & 0xff);
      for (const k of keys) { w(k); w(v[k]); } return;
    }
    throw new Error('unsupported ' + typeof v);
  }
  w(value);
  return new Uint8Array(bytes);
}
