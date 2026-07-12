// Macro ingest (§3.1) — parse a replay file into a normalized, time-indexed input list.
//
// The overlay works in milliseconds; macros work in frames. The single most important
// job of this module is to read `macroTPS` from the header and NEVER assume 60 — getting
// it wrong is a 4× error that "kind of works then drifts insanely" (§3.1).
//
// Supported inputs, easiest-first:
//   • GDR (JSON, v1)              — xdBot / Eclipse / MegaHack de-facto standard
//   • GDR2 (custom positional binary, v2) — see shared/gdr2.js; NOT msgpack, despite the
//     name resembling it — a real generic msgpack decoder was tried here first and it
//     silently mis-parses these files (the magic byte 'G'=0x47 is coincidentally a valid
//     one-byte msgpack fixint, so decoding "succeeds" while discarding the entire file).
//   • .gdph (Reclick)             — plain JSON
//
// Output is a normalized macro; see normalizeMacro() for the shape.

import { isGdr2, decodeGdr2 } from './gdr2.js';

// Button ints in GDR/GD: 1 = jump/hold, 2 = left, 3 = right (platformer).
const BUTTON_NAME = { 1: 'jump', 2: 'left', 3: 'right' };

// Pull a value from an object trying several candidate keys (formats disagree on names).
function pick(obj, keys, fallback) {
  if (!obj) return fallback;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return fallback;
}

// ── TPS: the field everything hinges on (§3.1) ────────────────────────────────
export function readTps(raw) {
  const tps = pick(raw, ['framerate', 'fps', 'tps', 'FPS', 'TPS']);
  if (tps === undefined || tps === null) {
    // Do NOT silently default to 60 — surface it. A caller may choose to proceed,
    // but the drift-inducing assumption must be explicit.
    throw new MacroError(
      'Macro has no framerate/fps/tps field. Refusing to assume 60 TPS (§3.1) — ' +
      'pass an explicit tps to parseMacro() if you truly know it.'
    );
  }
  const n = Number(tps);
  if (!Number.isFinite(n) || n <= 0) throw new MacroError(`Invalid TPS: ${tps}`);
  return n;
}

export class MacroError extends Error {}

// frame → song time. The one conversion the whole pipeline depends on (§3.1).
export function frameToMs(frame, tps) {
  return (frame / tps) * 1000;
}

// ── Format detection ──────────────────────────────────────────────────────────
// `data` may be a string (JSON), an object (already-parsed JSON), or a Uint8Array
// (a file's raw bytes — could be JSON text or GDR2 binary).
export function parseMacro(data, opts = {}) {
  if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    // JSON text begins with whitespace, '{' (0x7b) or '['. Disambiguate on the first
    // non-whitespace byte; GDR2 binary begins with the literal magic bytes "GDR".
    const first = firstNonWhitespaceByte(bytes);
    if (first === 0x7b /* { */ || first === 0x5b /* [ */) {
      return parseMacro(new TextDecoder('utf-8').decode(bytes), opts);
    }
    if (isGdr2(bytes)) {
      return normalizeGdr2(decodeGdr2(bytes, opts), opts);
    }
    throw new MacroError(
      `Unrecognized macro file: not JSON and missing the GDR2 magic bytes ` +
      `(first byte 0x${first.toString(16)}).`
    );
  }

  const obj = typeof data === 'string' ? JSON.parse(data) : data;

  if (looksLikeGdph(obj)) return normalizeGdph(obj, opts);
  return normalizeGdr(obj, opts);
}

function firstNonWhitespaceByte(bytes) {
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) return b;
  }
  return 0;
}

function looksLikeGdph(obj) {
  // Reclick .gdph is x-position-keyed rather than frame-based; it has no framerate
  // and its actions carry an `x` field.
  if (!obj || typeof obj !== 'object') return false;
  const acts = obj.actions || obj.clicks || obj.replay;
  return Array.isArray(acts) && acts.length > 0 &&
    (acts[0].x !== undefined || acts[0].xPosition !== undefined) &&
    pick(obj, ['framerate', 'fps', 'tps']) === undefined;
}

// ── GDR1 (JSON) ────────────────────────────────────────────────────────────────
function normalizeGdr(raw, opts) {
  const tps = opts.tps ?? readTps(raw);
  const level = raw.levelInfo || raw.level || {};
  const bot = raw.botInfo || raw.bot || {};

  const rawInputs = raw.inputs || raw.actions || raw.clicks || [];
  const inputs = rawInputs.map((inp) => {
    const frame = Number(pick(inp, ['frame', 'f'], 0));
    const down = Boolean(pick(inp, ['down', 'hold', 'holding', 'press', 'pressed'], false));
    const btn = Number(pick(inp, ['btn', 'button', 'b'], 1));
    // GDR marks P2 with a boolean; treat truthy as player 2.
    const p2 = Boolean(pick(inp, ['2p', 'player2', 'p2', 'player_2'], false));
    return {
      frame,
      ms: frameToMs(frame, tps),
      down,
      button: BUTTON_NAME[btn] || 'jump',
      player: p2 ? 2 : 1,
    };
  }).sort((a, b) => a.frame - b.frame || (a.down === b.down ? 0 : a.down ? 1 : -1));

  return normalizeMacro({
    source: 'gdr',
    tps,
    gameVersion: pick(raw, ['gameVersion'], null),
    botName: pick(bot, ['name'], null),
    botVersion: pick(bot, ['version'], null),
    level: {
      id: pick(level, ['id', 'levelID', 'level_id'], null),
      name: pick(level, ['name', 'levelName'], null),
    },
    platformer: Boolean(pick(raw, ['platformer', 'isPlatformer'], false)),
    duration: pick(raw, ['duration'], null),
    // GDR1 JSON's convention is seconds; compute the canonical ms form here, once, where
    // the unit is actually known (§ duration-units fix — see normalizeGdr2 for the
    // frame-based GDR2 equivalent).
    durationMs: pick(raw, ['duration'], null) != null ? Number(pick(raw, ['duration'], null)) * 1000 : null,
    inputs,
  });
}

// ── GDR2 (custom positional binary — see shared/gdr2.js) ──────────────────────
// Unlike normalizeGdr's defensive pick()-based alias-hunting (needed because GDR1 JSON
// exporters disagree on field names), decodeGdr2's output shape is exact and unambiguous
// by construction — every field is a fixed position in the binary stream, so there's
// nothing to guess or alias here.
function normalizeGdr2(raw, opts) {
  const tps = opts.tps ?? raw.framerate;

  const inputs = raw.inputs.map((inp) => ({
    frame: inp.frame,
    ms: frameToMs(inp.frame, tps),
    down: inp.down,
    button: BUTTON_NAME[inp.button] || 'jump',
    player: inp.player2 ? 2 : 1,
    phys: inp.phys ?? null,
  })).sort((a, b) => a.frame - b.frame || (a.down === b.down ? 0 : a.down ? 1 : -1));
  // Sort is required here (unlike a no-op elsewhere): player-1 and player-2 blocks each
  // have their own independent delta accumulator in the wire format, so the flat
  // concatenation of inputs is NOT globally frame-sorted across players.

  return normalizeMacro({
    source: 'gdr2',
    tps,
    gameVersion: raw.gameVersion ?? null,
    botName: raw.botInfo?.name ?? null,
    botVersion: raw.botInfo?.version ?? null,
    level: { id: raw.levelInfo?.id ?? null, name: raw.levelInfo?.name ?? null },
    platformer: !!raw.platformer,
    duration: raw.duration ?? null, // FRAMES, not seconds — see durationMs
    durationMs: raw.duration != null ? frameToMs(raw.duration, tps) : null,
    deaths: raw.deaths ?? [],
    inputs,
  });
}

// ── .gdph (Reclick) — x-position based, needs conversion (§3.1 table) ─────────
// Without frame/tps data we cannot produce true song-time; we approximate frames from
// index and flag the macro so downstream code can warn. This is the "needs conversion"
// path — prefer converting to GDR via ZCB3 upstream when accuracy matters.
function normalizeGdph(raw, opts) {
  const tps = opts.tps ?? 240; // Reclick has no header TPS; caller should override.
  const acts = raw.actions || raw.clicks || raw.replay || [];
  const inputs = acts.map((a, i) => {
    const frame = Number(pick(a, ['frame', 'f'], i));
    return {
      frame,
      ms: frameToMs(frame, tps),
      down: Boolean(pick(a, ['down', 'hold', 'press'], (i % 2) === 0)),
      button: 'jump',
      player: pick(a, ['player2', 'p2'], false) ? 2 : 1,
      x: pick(a, ['x', 'xPosition'], null),
    };
  });
  return normalizeMacro({
    source: 'gdph',
    tps,
    approximate: true, // x-based; frame times are not authoritative
    gameVersion: null,
    botName: 'Reclick',
    botVersion: null,
    level: { id: null, name: null },
    platformer: false,
    duration: null,
    durationMs: null,
    inputs,
  });
}

// Final normalization + invariants. Every parser routes through here so the rest of the
// codebase only ever sees one macro shape.
function normalizeMacro(m) {
  if (!Number.isFinite(m.tps) || m.tps <= 0) throw new MacroError(`Bad TPS ${m.tps}`);
  return {
    source: m.source,
    tps: m.tps,
    approximate: m.approximate || false,
    gameVersion: m.gameVersion ?? null,
    botName: m.botName ?? null,
    botVersion: m.botVersion ?? null,
    level: m.level ?? { id: null, name: null },
    platformer: m.platformer || false,
    duration: m.duration ?? null, // unit is format-dependent (seconds for GDR1, frames for
                                   // GDR2) — consumers should use durationMs instead.
    durationMs: m.durationMs ?? null,
    deaths: m.deaths ?? [],
    inputs: m.inputs ?? [],
  };
}
