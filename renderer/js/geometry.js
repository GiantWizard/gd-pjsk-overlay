// Pure highway geometry (§3.4, §7.4) — no canvas, fully unit-testable.
//
// The one inviolable rule (§7.4): note position is a PURE LINEAR function of
// (noteTime − playhead). Never eased. Easing y makes evenly-spaced clicks render
// unevenly spaced, and the chart stops encoding rhythm — the one thing it exists to show.

import { LOOKAHEAD_MS, PAST_WINDOW_MS } from '../../shared/protocol.js';

// The visible time window around the playhead. A small negative past-window keeps notes
// visibly crossing the line rather than vanishing on it (§3.4).
export function visibleWindow(nowMs, lookaheadMs = LOOKAHEAD_MS, pastMs = PAST_WINDOW_MS) {
  return [nowMs - pastMs, nowMs + lookaheadMs];
}

// Fraction of the way from the top of the highway (delta = lookahead) to the hit line
// (delta = 0). 0 at the line, 1 at the far edge. LINEAR in delta — this is §7.4.
export function progress(deltaMs, lookaheadMs = LOOKAHEAD_MS) {
  return deltaMs / lookaheadMs;
}

// Screen y for a note `deltaMs` in the future, given the hit line position and height.
// delta == 0 lands exactly on the hit line — no fudging, no offsets baked in here (§3.4).
export function yForDelta(deltaMs, hitLineY, highwayHeight, lookaheadMs = LOOKAHEAD_MS) {
  return hitLineY - progress(deltaMs, lookaheadMs) * highwayHeight;
}

// Select notes (and holds that overlap) intersecting the window. A hold is in range if any
// part of [timeMs, timeMs+durationMs] intersects — otherwise long holds pop out early.
export function notesInRange(notes, [lo, hi]) {
  const out = [];
  for (const n of notes) {
    const end = n.type === 'hold' ? n.timeMs + n.durationMs : n.timeMs;
    if (end >= lo && n.timeMs <= hi) out.push(n);
  }
  return out;
}

// Perspective (companion mode, §7.1): lanes converge toward a horizon. `depth` is the
// normalized progress (0 at line … 1 at horizon); returns a horizontal scale in (0,1].
// Flat/orthographic (overlay mode) is simply scale = 1 everywhere.
export function perspectiveScale(depth, horizon = 0.28) {
  // Notes near the line are full width; notes at the far edge shrink toward `horizon`.
  return 1 - (1 - horizon) * clamp01(depth);
}

// Map a lane index to a normalized center x in [0,1]. Single-button GD → one lane (0.5);
// dual adds a second (P1 left, P2 right). Two lanes is the hard ceiling (§3.2).
export function laneCenter(player, dual) {
  if (!dual) return 0.5;
  return player === 2 ? 0.68 : 0.32;
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
