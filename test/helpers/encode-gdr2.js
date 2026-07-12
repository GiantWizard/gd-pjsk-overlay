// Test-only GDR2 encoder — mirrors binarystream.hpp's write-side rules so fixtures can be
// built in readable absolute-frame terms instead of hand-typed byte arrays. Production code
// never needs to WRITE this format (this project only reads replays), so this stays test-local.

class BinWriter {
  constructor() { this.bytes = []; }

  writeVarint(value) {
    let v = value;
    for (;;) {
      let byte = v % 128;
      v = Math.floor(v / 128);
      if (v > 0) byte |= 0x80;
      this.bytes.push(byte);
      if (v === 0) break;
    }
  }

  writeBool(b) { this.writeVarint(b ? 1 : 0); }

  writeFloat32(v) {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, v, false); // big-endian
    this.bytes.push(...new Uint8Array(buf));
  }

  writeFloat64(v) {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, v, false); // big-endian
    this.bytes.push(...new Uint8Array(buf));
  }

  writeString(s) {
    const b = new TextEncoder().encode(s);
    this.writeVarint(b.length);
    this.bytes.push(...b);
  }

  writeBytes(bytes) { this.bytes.push(...bytes); }

  toBytes() { return Uint8Array.from(this.bytes); }
}

// `replay.inputs` must already be grouped p1-block-then-p2-block (matching the real wire
// invariant) with absolute `frame` numbers and correct `player2` flags reflecting that
// grouping — this mirrors what a real recorder produces, just expressed in absolute terms
// for readability instead of pre-computed deltas.
export function encodeGdr2Replay(replay) {
  const w = new BinWriter();
  w.writeBytes([0x47, 0x44, 0x52]); // "GDR"
  w.writeVarint(replay.version ?? 2);
  w.writeString(replay.inputTag ?? '');
  w.writeString(replay.author ?? '');
  w.writeString(replay.description ?? '');
  w.writeFloat32(replay.duration ?? 0);
  w.writeVarint(replay.gameVersion ?? 0);
  w.writeFloat64(replay.framerate ?? 240);
  w.writeVarint(replay.seed ?? 0);
  w.writeVarint(replay.coins ?? 0);
  w.writeBool(replay.ldm ?? false);
  w.writeBool(replay.platformer ?? false);
  w.writeString(replay.botInfo?.name ?? '');
  w.writeVarint(replay.botInfo?.version ?? 0);
  w.writeVarint(replay.levelInfo?.id ?? 0);
  w.writeString(replay.levelInfo?.name ?? '');

  const extBytes = replay.extensionBytes ?? [];
  w.writeVarint(extBytes.length);
  w.writeBytes(extBytes);

  const deaths = replay.deaths ?? [];
  w.writeVarint(deaths.length);
  {
    let p = 0;
    for (const abs of deaths) { w.writeVarint(abs - p); p = abs; }
  }

  const inputs = replay.inputs ?? [];
  const p1Count = inputs.filter((i) => !i.player2).length;
  w.writeVarint(inputs.length);
  w.writeVarint(p1Count);

  let p = 0;
  let remainingP1 = p1Count;
  for (const inp of inputs) {
    const delta = inp.frame - p;
    let packed;
    if (replay.platformer) {
      packed = delta * 8 + (inp.button ?? 1) * 2 + (inp.down ? 1 : 0);
    } else {
      packed = delta * 2 + (inp.down ? 1 : 0);
    }
    w.writeVarint(packed);

    if (replay.inputTag === 'Phys') {
      // A "Phys"-tagged replay carries the extension on every input, consistently.
      const phys = inp.phys ?? {};
      const extW = new BinWriter();
      extW.writeFloat32(phys.xPosition ?? 0);
      extW.writeFloat32(phys.yPosition ?? 0);
      extW.writeFloat32(phys.rotation ?? 0);
      extW.writeFloat64(phys.xVelocity ?? 0);
      extW.writeFloat64(phys.yVelocity ?? 0);
      const extBytes = extW.toBytes();
      w.writeVarint(extBytes.length);
      w.writeBytes(extBytes);
    } else if ((replay.inputTag ?? '') !== '') {
      w.writeVarint(0); // declared some other extension tag, but this fixture has no data for it
    }

    p = inp.frame;
    if (remainingP1 > 0) {
      remainingP1--;
      if (remainingP1 === 0) p = 0;
    }
  }

  return w.toBytes();
}
