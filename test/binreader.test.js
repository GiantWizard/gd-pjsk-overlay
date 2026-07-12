import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BinReader } from '../shared/binreader.js';

// Hand-encode a varint the same way binarystream.hpp's writer does, for round-trip tests.
function encodeVarint(value) {
  const bytes = [];
  let v = value;
  for (;;) {
    let byte = v % 128;
    v = Math.floor(v / 128);
    if (v > 0) byte |= 0x80;
    bytes.push(byte);
    if (v === 0) break;
  }
  return Uint8Array.from(bytes);
}

test('varint round-trips across 1/2/3-byte boundaries', () => {
  for (const v of [0, 1, 127, 128, 16383, 16384, 2097151, 2 ** 32 + 5]) {
    const r = new BinReader(encodeVarint(v));
    assert.equal(r.readVarint(), v, `value ${v}`);
    assert.ok(r.empty);
  }
});

test('readBool reads a single varint byte as boolean', () => {
  const r = new BinReader(Uint8Array.from([...encodeVarint(0), ...encodeVarint(1)]));
  assert.equal(r.readBool(), false);
  assert.equal(r.readBool(), true);
});

test('float32/float64 round-trip as big-endian, verified independently via DataView', () => {
  const buf = new ArrayBuffer(12);
  const dv = new DataView(buf);
  dv.setFloat32(0, 240.0, false);
  dv.setFloat64(4, -9.81, false);
  const r = new BinReader(new Uint8Array(buf));
  assert.equal(r.readFloat32(), 240.0);
  assert.equal(r.readFloat64(), -9.81);
  assert.ok(r.empty);
});

test('string reads a varint length prefix + UTF-8 bytes, including multi-byte chars', () => {
  const enc = new TextEncoder();
  const s = 'héllo'; // 'é' is 2 UTF-8 bytes
  const strBytes = enc.encode(s);
  const bytes = Uint8Array.from([...encodeVarint(strBytes.length), ...strBytes]);
  const r = new BinReader(bytes);
  assert.equal(r.readString(), s);
  assert.ok(r.empty);
});

test('skip advances position without reading', () => {
  const r = new BinReader(Uint8Array.from([1, 2, 3, 4, 5]));
  r.skip(3);
  assert.equal(r.readVarint(), 4);
});
