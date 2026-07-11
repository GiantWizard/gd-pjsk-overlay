// Wire protocol + shared tuning constants.
//
// This module is the single source of truth for the WS message shapes (Component A → B)
// and for the handful of global tuning knobs that the spec insists live in exactly one
// place (notably the global audio offset, §6.3). Keep it dependency-free so it can be
// imported by the browser renderer, the node analyzer, and tests alike.

// ── Transport ───────────────────────────────────────────────────────────────
// The mod is the WebSocket *server* (§2.4) so the renderer can reconnect freely
// without restarting Geometry Dash.
export const WS_HOST = '127.0.0.1';
export const WS_PORT = 8787;
export const WS_URL = `ws://${WS_HOST}:${WS_PORT}`;

// ── Message types (§2.4) ─────────────────────────────────────────────────────
export const MSG = Object.freeze({
  TICK: 'tick',
  LEVEL_START: 'levelStart',
  RESET: 'reset',
  PAUSE: 'pause',
  RESUME: 'resume',
  LEVEL_END: 'levelEnd',
});

// ── The one global offset (§6.3) ─────────────────────────────────────────────
// Wine adds audio output latency the native renderer doesn't share. Per §0.5 this
// is a single eyeballed constant, NOT a calibration UI, and NOT scattered `+30`s
// through the render code. Positive = shift the whole highway later in time.
export const GLOBAL_OFFSET_MS = 0;

// ── Rendering defaults (§3.4) ────────────────────────────────────────────────
export const LOOKAHEAD_MS = 1500;      // "scroll speed"; how far into the future the highway shows
export const PAST_WINDOW_MS = 200;     // keep notes visible briefly after they cross the line

// ── Note-derivation tuning (§3.2) ────────────────────────────────────────────
export const TAP_MAX_MS = 50;          // down→up shorter than this is a tap; longer is a hold

// ── Display clustering (§3.3) ────────────────────────────────────────────────
export const MERGE_GAP_MS = 40;        // toggles within this window collapse into one display cluster
export const SQUIGGLE_MIN_TOGGLES = 3; // a cluster above this renders as one "squiggle hold"

// ── Analyzer tuning (§4) ─────────────────────────────────────────────────────
// Starting points only — the spec is explicit that these get tuned against a run
// you *know* is clean.
export const SEGMENT_GAP_MS = 300;     // no-input gap that splits a segment (§4.1)
export const JITTER_FLIP_RATE = 8;     // vy sign-flips/sec above which a low-progress segment is jitter (§4.2)
export const JITTER_MAX_DISPLACEMENT = 60; // "little actual progress" ceiling in y units (§4.2)
export const DOUBLE_FLIP_MS = 100;     // spider/ball A→B→A within this window is a wasted double-flip (§4.2)

// ── Gamemodes (§3.2) ─────────────────────────────────────────────────────────
export const GAMEMODES = Object.freeze([
  'cube', 'ship', 'ball', 'ufo', 'wave', 'robot', 'spider', 'swing',
]);

// How a click reads per mode — drives both rendering silhouette and note semantics.
// `holdable`: does a sustained press produce a continuous action (a tail worth drawing)?
export const MODE_INFO = Object.freeze({
  cube:   { holdable: false, kind: 'jump' },
  robot:  { holdable: true,  kind: 'jump' },   // hold = higher jump → short tail
  ship:   { holdable: true,  kind: 'thrust' }, // hold = thrust → tail is trajectory
  ufo:    { holdable: false, kind: 'flap' },   // each click is a discrete flap, even when rapid
  wave:   { holdable: true,  kind: 'wave' },   // hold = up diagonal; tail length is meaningful
  ball:   { holdable: false, kind: 'flip' },   // gravity flip — state change
  swing:  { holdable: false, kind: 'flip' },   // gravity flip
  spider: { holdable: false, kind: 'teleport' },// instant teleport to opposite surface
});
