// Generic positional binary-stream reader — no GDR-specific knowledge lives here.
//
// Mirrors the encoding rules of maxnut/GDReplayFormat's binarystream.hpp: any C++ integral
// type (int, uint32_t, uint64_t, bool, size_t) is a varint (7 bits/byte, continuation bit
// in bit 7, LSB-first); any non-integral type (float, double) is fixed-size BIG-ENDIAN
// (native little-endian bytes get reversed on write, so the wire format is big-endian).
//
// Deliberately uses division/modulo rather than bitwise ops for varint accumulation —
// JS bitwise operators coerce to signed 32-bit and would silently corrupt any value
// (e.g. a frame number in a long macro) exceeding ~2^31.

export class BinReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = 0;
  }

  get empty() {
    return this.pos >= this.bytes.length;
  }

  readVarint() {
    let result = 0;
    let mult = 1;
    for (;;) {
      const byte = this.bytes[this.pos++];
      result += (byte & 0x7f) * mult;
      if ((byte & 0x80) === 0) break;
      mult *= 128;
    }
    return result;
  }

  readBool() {
    return this.readVarint() !== 0;
  }

  readFloat32() {
    const v = this.view.getFloat32(this.pos, false); // big-endian
    this.pos += 4;
    return v;
  }

  readFloat64() {
    const v = this.view.getFloat64(this.pos, false); // big-endian
    this.pos += 8;
    return v;
  }

  readBytes(n) {
    const b = this.bytes.slice(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }

  readString() {
    const len = this.readVarint();
    const b = this.readBytes(len);
    return new TextDecoder('utf-8').decode(b);
  }

  skip(n) {
    this.pos += n;
  }
}
