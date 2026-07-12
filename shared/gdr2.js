// GDR2 replay decoder — a custom POSITIONAL BINARY stream, NOT msgpack.
//
// Verified against the actual reference implementation (maxnut/GDReplayFormat, the spec
// this project cites): binarystream.hpp defines varint-encoded integrals, fixed-size
// big-endian floats/doubles, and length-prefixed strings, with NO type tags and NO keys —
// every field is read in strict declared order. Feeding these bytes through a generic
// msgpack decoder (the previous approach here) doesn't throw — the leading magic byte 'G'
// (0x47) happens to be a valid one-byte msgpack positive-fixint (71), so a msgpack decoder
// just returns the number 71 and silently discards the rest of the file. That produced
// exactly the "no framerate field" and "macro loads with zero inputs" symptoms users hit.
//
// Read order (Replay::importData(), verbatim from source):
//   magic("GDR") version inputTag author description duration gameVersion framerate
//   seed coins ldm platformer botInfo{name,version} levelInfo{id,name}
//   extensionSize+bytes(skip) deaths[] inputs[]

import { BinReader } from './binreader.js';

const MAGIC = [0x47, 0x44, 0x52]; // "GDR"

export function isGdr2(bytes) {
  return bytes.length >= 3 && bytes[0] === MAGIC[0] && bytes[1] === MAGIC[1] && bytes[2] === MAGIC[2];
}

export function decodeGdr2(bytes, opts = {}) {
  const r = new BinReader(bytes);
  const magic = r.readBytes(3);
  if (magic[0] !== MAGIC[0] || magic[1] !== MAGIC[1] || magic[2] !== MAGIC[2]) {
    throw new Error('Not a GDR2 file: missing "GDR" magic bytes');
  }

  const version = r.readVarint();
  const inputTag = r.readString();
  const hasInputExt = inputTag !== '';
  const parsePhys = opts.parsePhysicsExt ?? true; // per project decision: parse "Phys" when present

  const author = r.readString();
  const description = r.readString();
  const duration = r.readFloat32();       // FRAMES, fixed 4 bytes — not varint, not seconds
  const gameVersion = r.readVarint();
  const framerate = r.readFloat64();      // fixed 8 bytes
  const seed = r.readVarint();
  const coins = r.readVarint();
  const ldm = r.readBool();
  const platformer = r.readBool();
  const botInfo = { name: r.readString(), version: r.readVarint() };
  const levelInfo = { id: r.readVarint(), name: r.readString() };

  // Replay-level extension: length-prefixed blob, always safe to skip unconditionally.
  const extensionSize = r.readVarint();
  r.skip(extensionSize);

  // Deaths: varint count, then that many delta-encoded varints → absolute frame numbers.
  const deathCount = r.readVarint();
  const deaths = [];
  {
    let p = 0;
    for (let i = 0; i < deathCount; i++) {
      const delta = r.readVarint();
      p += delta;
      deaths.push(p);
    }
  }

  // Inputs: total count (reserve hint only — loop actually ends on stream-empty),
  // then p1Inputs (how many of the FIRST N packed values belong to player 1 — the file
  // stores ALL p1 inputs first, then ALL p2 inputs, each with its own delta baseline).
  r.readVarint(); // total count hint, unused
  let p1Inputs = r.readVarint();

  const inputs = [];
  let p = 0;
  while (!r.empty) {
    const packed = r.readVarint();
    let delta, button, down;
    if (platformer) {
      // InputChunk: delta = packed >> 3 ; button = (packed >> 1) & 3 ; down = packed & 1
      down = packed % 2;
      button = Math.floor(packed / 2) % 4;
      delta = Math.floor(packed / 8);
    } else {
      // InputChunkNP: delta = packed >> 1 ; down = packed & 1 (no button bits at all)
      down = packed % 2;
      delta = Math.floor(packed / 2);
      button = 1; // hardcoded "jump" — non-platformer has only one button
    }
    const frame = delta + p;
    const player2 = p1Inputs === 0; // checked BEFORE decrementing below

    const input = { frame, button, player2, down: down !== 0 };

    if (hasInputExt) {
      const inputExtensionSize = r.readVarint();
      if (inputTag === 'Phys' && parsePhys) {
        const extStart = r.pos;
        input.phys = {
          xPosition: r.readFloat32(),
          yPosition: r.readFloat32(),
          rotation: r.readFloat32(),
          xVelocity: r.readFloat64(),
          yVelocity: r.readFloat64(),
        };
        // Defensive: if the declared extension size doesn't match what we just consumed
        // (a variant Phys layout, or a different bot's same-named tag), realign the
        // stream to the declared size rather than trusting our own field count — a
        // silent misalignment here would corrupt every subsequent input.
        const consumed = r.pos - extStart;
        if (consumed !== inputExtensionSize) r.pos = extStart + inputExtensionSize;
      } else {
        r.skip(inputExtensionSize);
      }
    }

    inputs.push(input);
    p = frame;

    if (p1Inputs > 0) {
      p1Inputs--;
      if (p1Inputs === 0) p = 0; // reset accumulator crossing from the p1 block to the p2 block
    }
  }

  return {
    version, inputTag, author, description, duration, gameVersion, framerate,
    seed, coins, ldm, platformer, botInfo, levelInfo, deaths, inputs,
  };
}
