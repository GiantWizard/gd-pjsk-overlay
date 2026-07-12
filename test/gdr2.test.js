import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeGdr2, isGdr2 } from '../shared/gdr2.js';
import { parseMacro } from '../shared/gdr.js';
import { encodeGdr2Replay } from './helpers/encode-gdr2.js';

test('isGdr2 recognizes the magic bytes and rejects other content', () => {
  assert.ok(isGdr2(Uint8Array.from([0x47, 0x44, 0x52, 1, 2])));
  assert.ok(!isGdr2(Uint8Array.from([0x7b, 1, 2]))); // '{'
  assert.ok(!isGdr2(Uint8Array.from([0x47, 0x44]))); // too short
});

test('decodes a platformer replay: strings, p1/p2 split, deaths, mixed buttons', () => {
  const bytes = encodeGdr2Replay({
    version: 2,
    inputTag: '',
    author: 'tëster',              // multi-byte UTF-8, exercises string decode
    description: 'a test replay',
    duration: 1000,                 // frames
    gameVersion: 22074,
    framerate: 240,
    seed: 123,
    coins: 3,
    ldm: true,
    platformer: true,
    botInfo: { name: 'xdBot', version: 4 },
    levelInfo: { id: 60978746, name: 'The Golden' },
    deaths: [500],
    inputs: [
      // player 1 block: mixed button values, tap + hold
      { frame: 0, button: 1, player2: false, down: true },
      { frame: 12, button: 1, player2: false, down: false },
      { frame: 100, button: 2, player2: false, down: true },
      { frame: 130, button: 2, player2: false, down: false },
      // player 2 block: independent delta baseline starting back at 0
      { frame: 5, button: 1, player2: true, down: true },
      { frame: 20, button: 1, player2: true, down: false },
    ],
  });

  const raw = decodeGdr2(bytes);
  assert.equal(raw.author, 'tëster');
  assert.equal(raw.framerate, 240);
  assert.equal(raw.duration, 1000);
  assert.equal(raw.gameVersion, 22074);
  assert.equal(raw.coins, 3);
  assert.equal(raw.ldm, true);
  assert.equal(raw.platformer, true);
  assert.equal(raw.botInfo.name, 'xdBot');
  assert.equal(raw.botInfo.version, 4);
  assert.equal(raw.levelInfo.id, 60978746);
  assert.equal(raw.levelInfo.name, 'The Golden');
  assert.deepEqual(raw.deaths, [500]);
  assert.equal(raw.inputs.length, 6);

  // Frame numbers correctly reconstructed for BOTH players despite the shared packed stream.
  assert.deepEqual(raw.inputs.map((i) => i.frame), [0, 12, 100, 130, 5, 20]);
  assert.deepEqual(raw.inputs.map((i) => i.player2), [false, false, false, false, true, true]);
  assert.deepEqual(raw.inputs.map((i) => i.button), [1, 1, 2, 2, 1, 1]);
  assert.deepEqual(raw.inputs.map((i) => i.down), [true, false, true, false, true, false]);

  // Full parseMacro pipeline: normalized shape, sorted globally by frame, player 1|2.
  const macro = parseMacro(bytes);
  assert.equal(macro.source, 'gdr2');
  assert.equal(macro.tps, 240);
  assert.equal(macro.botName, 'xdBot');
  assert.equal(macro.level.name, 'The Golden');
  assert.equal(macro.platformer, true);
  assert.equal(macro.durationMs, (1000 / 240) * 1000); // duration is FRAMES, converted correctly
  assert.equal(macro.inputs.length, 6);
  assert.ok(macro.inputs.every((n, i, arr) => i === 0 || arr[i - 1].frame <= n.frame),
    'inputs must be globally frame-sorted across players');
  assert.deepEqual(macro.deaths, [500]);
  const p2 = macro.inputs.filter((n) => n.player === 2);
  assert.equal(p2.length, 2);
  assert.deepEqual(p2.map((n) => n.frame), [5, 20]);
});

test('decodes a non-platformer replay: no button bits, hardcoded jump, single player', () => {
  const bytes = encodeGdr2Replay({
    platformer: false,
    framerate: 240,
    botInfo: { name: 'synth', version: 1 },
    levelInfo: { id: 1, name: 'demo' },
    inputs: [
      { frame: 0, player2: false, down: true },
      { frame: 30, player2: false, down: false },
      { frame: 200, player2: false, down: true },
      { frame: 210, player2: false, down: false },
    ],
  });

  const raw = decodeGdr2(bytes);
  assert.equal(raw.platformer, false);
  assert.deepEqual(raw.inputs.map((i) => i.button), [1, 1, 1, 1]); // hardcoded jump, no button bits
  assert.deepEqual(raw.inputs.map((i) => i.frame), [0, 30, 200, 210]);
  assert.deepEqual(raw.inputs.map((i) => i.player2), [false, false, false, false]);

  const macro = parseMacro(bytes);
  // parseMacro returns the raw normalized input list (4 down/up events); tap/hold pairing
  // into notes happens downstream in shared/notes.js, not here.
  assert.equal(macro.inputs.length, 4);
  assert.ok(macro.inputs.every((n) => n.button === 'jump'));
});

test('decodes the optional "Phys" per-input extension when present', () => {
  const bytes = encodeGdr2Replay({
    platformer: true,
    inputTag: 'Phys',
    framerate: 240,
    botInfo: { name: 'physbot', version: 1 },
    levelInfo: { id: 1, name: 'demo' },
    inputs: [
      {
        frame: 0, button: 1, player2: false, down: true,
        phys: { xPosition: 8412.3, yPosition: 214.7, rotation: 142.0, xVelocity: 5.77, yVelocity: -9.81 },
      },
      {
        frame: 50, button: 1, player2: false, down: false,
        phys: { xPosition: 8700.1, yPosition: 220.0, rotation: 150.5, xVelocity: 5.77, yVelocity: 0 },
      },
    ],
  });

  const raw = decodeGdr2(bytes);
  assert.equal(raw.inputTag, 'Phys');
  assert.equal(raw.inputs.length, 2);
  assert.ok(Math.abs(raw.inputs[0].phys.xPosition - 8412.3) < 0.01);
  assert.ok(Math.abs(raw.inputs[0].phys.yVelocity - (-9.81)) < 0.001);
  assert.ok(Math.abs(raw.inputs[1].phys.rotation - 150.5) < 0.01);

  const macro = parseMacro(bytes);
  const note = macro.inputs.find((n) => n.frame === 0);
  assert.ok(note.phys, 'phys data should survive normalization onto the note');
  assert.ok(Math.abs(note.phys.xPosition - 8412.3) < 0.01);
});

test('a non-GDR2, non-JSON byte stream throws a clear MacroError instead of silently misparsing', () => {
  const bytes = Uint8Array.from([0xff, 0x01, 0x02]); // neither '{'/'[' nor "GDR" magic
  assert.throws(() => parseMacro(bytes), /Unrecognized macro file/);
});
