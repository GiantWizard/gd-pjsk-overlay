// Note model (§3.2) — turn the macro's discrete down/up events into taps and holds,
// then tag each with the gamemode it lands in (joined from the telemetry dump).
//
// The macro gives you state-change events; a highway needs notes. Pair down→up:
// a pair shorter than TAP_MAX_MS is a `tap`, longer is a `hold` with a tail (§3.2).
// This is what makes ship/wave/robot sections legible instead of a wall of events.

import { TAP_MAX_MS, MODE_INFO, GLOBAL_OFFSET_MS } from './protocol.js';

// Pair down/up events into notes, per player and per button (platformer has L/R/jump).
export function deriveNotes(macro, opts = {}) {
  const tapMax = opts.tapMaxMs ?? TAP_MAX_MS;
  const offset = opts.offsetMs ?? GLOBAL_OFFSET_MS;

  // key = `${player}:${button}` so a held jump and a held right don't cross-pair.
  const open = new Map();
  const notes = [];
  let lastMs = 0;

  for (const inp of macro.inputs) {
    lastMs = Math.max(lastMs, inp.ms);
    const key = `${inp.player}:${inp.button}`;
    if (inp.down) {
      // A new press. If one was already open on this key (missing release), close the
      // stale one as a tap at its own start — a lost release shouldn't swallow a note.
      if (open.has(key)) notes.push(makeNote(open.get(key), open.get(key).ms, tapMax, offset));
      open.set(key, inp);
    } else {
      const start = open.get(key);
      if (start) {
        notes.push(makeNote(start, inp.ms, tapMax, offset));
        open.delete(key);
      }
      // A release with no matching down is noise (double-up); ignore.
    }
  }

  // Close any still-open presses at the last known event time.
  for (const start of open.values()) {
    notes.push(makeNote(start, Math.max(start.ms, lastMs), tapMax, offset));
  }

  notes.sort((a, b) => a.timeMs - b.timeMs);
  return notes;
}

// NB: `start.phys` (GDR2 "Phys" per-input snapshot) is intentionally NOT carried onto the
// note — the highway is a single centered lane by design, so notes have no per-note layout
// data to derive from it.
function makeNote(start, releaseMs, tapMax, offset) {
  const durationMs = Math.max(0, releaseMs - start.ms);
  return {
    timeMs: start.ms + offset,   // §6.3: the one place the global offset is applied to notes
    type: durationMs > tapMax ? 'hold' : 'tap',
    durationMs: durationMs > tapMax ? durationMs : 0,
    player: start.player,
    gamemode: null,              // filled in by tagGamemodes()
    button: start.button,
    severity: 0,                 // 0 = clean; 1–3 filled in by the analyzer (§4)
    frame: start.frame,
    _rawTimeMs: start.ms,        // pre-offset, for joining against telemetry
  };
}

// ── Gamemode tagging via telemetry join (§3.2) ────────────────────────────────
// "Without the telemetry pass you cannot know the gamemode at all." Join each note
// to the nearest telemetry tick by song time and copy its mode/gravity. A note whose
// mode is a hold-mode (ship/wave/robot) keeps its tail; a discrete mode (ufo/spider/
// ball/swing) is coerced to a tap even if the macro held the button.
export function tagGamemodes(notes, telemetry, opts = {}) {
  if (!telemetry || telemetry.length === 0) return notes;
  const coerce = opts.coerceDiscrete ?? true;

  // telemetry is sorted by ms; binary-search the nearest tick per note.
  const times = telemetry.map((t) => t.ms);
  for (const note of notes) {
    const idx = nearestIndex(times, note._rawTimeMs);
    const tick = telemetry[idx];
    note.gamemode = tick.mode ?? null;
    note.grav = tick.grav ?? 1;

    if (coerce && note.gamemode) {
      const info = MODE_INFO[note.gamemode];
      if (info && !info.holdable && note.type === 'hold') {
        // e.g. UFO "hold" is really discrete flaps; a spider "hold" is a single teleport.
        note.type = 'tap';
        note.durationMs = 0;
      }
    }
  }
  return notes;
}

// Convenience: parse-to-notes in one call.
export function buildNoteList(macro, telemetry = null, opts = {}) {
  const notes = deriveNotes(macro, opts);
  return tagGamemodes(notes, telemetry, opts);
}

// Binary search for the index of the value in `sorted` nearest to `target`.
export function nearestIndex(sorted, target) {
  if (sorted.length === 0) return -1;
  let lo = 0, hi = sorted.length - 1;
  if (target <= sorted[0]) return 0;
  if (target >= sorted[hi]) return hi;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] === target) return mid;
    if (sorted[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  // lo is now the first index > target; compare neighbors.
  return Math.abs(sorted[lo] - target) < Math.abs(sorted[hi] - target) ? lo : hi;
}

// Count of entries in `sorted` that are <= target. Used by the renderer to DERIVE the
// combo count from the playhead (derived, never accumulated — so seek/restart/loop-wrap
// all stay consistent by construction).
export function countAtOrBefore(sorted, target) {
  if (sorted.length === 0 || target < sorted[0]) return 0;
  let i = nearestIndex(sorted, target);
  if (sorted[i] > target) i--;
  return i + 1;
}
