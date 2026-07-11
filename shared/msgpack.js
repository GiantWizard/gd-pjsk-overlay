// Minimal MessagePack decoder — just enough to read GDR2 replays.
//
// GDR2 is a msgpack-encoded map (the format is public: maxnut/GDReplayFormat).
// Rather than pull a dependency into a project the spec wants to keep build-step-free,
// we decode the subset of msgpack that GDR actually uses: nil, bool, ints, floats,
// str, bin, arrays and maps. Extension/timestamp types are not used by GDR and throw.

export function decodeMsgpack(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder('utf-8');
  let pos = 0;

  function u8() { return view.getUint8(pos++); }

  function str(len) {
    const s = dec.decode(new Uint8Array(bytes.buffer, bytes.byteOffset + pos, len));
    pos += len;
    return s;
  }

  function bin(len) {
    const b = bytes.slice(pos, pos + len);
    pos += len;
    return b;
  }

  function arr(len) {
    const out = new Array(len);
    for (let i = 0; i < len; i++) out[i] = read();
    return out;
  }

  function map(len) {
    const out = {};
    for (let i = 0; i < len; i++) {
      const k = read();
      out[k] = read();
    }
    return out;
  }

  function read() {
    const b = u8();
    // positive fixint
    if (b <= 0x7f) return b;
    // negative fixint
    if (b >= 0xe0) return b - 0x100;
    // fixmap
    if (b >= 0x80 && b <= 0x8f) return map(b & 0x0f);
    // fixarray
    if (b >= 0x90 && b <= 0x9f) return arr(b & 0x0f);
    // fixstr
    if (b >= 0xa0 && b <= 0xbf) return str(b & 0x1f);

    switch (b) {
      case 0xc0: return null;                                  // nil
      case 0xc2: return false;                                 // false
      case 0xc3: return true;                                  // true
      case 0xc4: { const n = u8(); return bin(n); }            // bin 8
      case 0xc5: { const n = view.getUint16(pos); pos += 2; return bin(n); } // bin 16
      case 0xc6: { const n = view.getUint32(pos); pos += 4; return bin(n); } // bin 32
      case 0xca: { const v = view.getFloat32(pos); pos += 4; return v; }     // float 32
      case 0xcb: { const v = view.getFloat64(pos); pos += 8; return v; }     // float 64
      case 0xcc: return u8();                                  // uint 8
      case 0xcd: { const v = view.getUint16(pos); pos += 2; return v; }      // uint 16
      case 0xce: { const v = view.getUint32(pos); pos += 4; return v; }      // uint 32
      case 0xcf: { const v = view.getBigUint64(pos); pos += 8; return Number(v); } // uint 64
      case 0xd0: { const v = view.getInt8(pos); pos += 1; return v; }        // int 8
      case 0xd1: { const v = view.getInt16(pos); pos += 2; return v; }       // int 16
      case 0xd2: { const v = view.getInt32(pos); pos += 4; return v; }       // int 32
      case 0xd3: { const v = view.getBigInt64(pos); pos += 8; return Number(v); }  // int 64
      case 0xd9: { const n = u8(); return str(n); }            // str 8
      case 0xda: { const n = view.getUint16(pos); pos += 2; return str(n); } // str 16
      case 0xdb: { const n = view.getUint32(pos); pos += 4; return str(n); } // str 32
      case 0xdc: { const n = view.getUint16(pos); pos += 2; return arr(n); } // array 16
      case 0xdd: { const n = view.getUint32(pos); pos += 4; return arr(n); } // array 32
      case 0xde: { const n = view.getUint16(pos); pos += 2; return map(n); } // map 16
      case 0xdf: { const n = view.getUint32(pos); pos += 4; return map(n); } // map 32
      default:
        throw new Error(`Unsupported msgpack byte 0x${b.toString(16)} at ${pos - 1}`);
    }
  }

  return read();
}
