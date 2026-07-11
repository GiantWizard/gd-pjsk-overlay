// Movement heuristics (§4.2). All read from the telemetry dump. Thresholds are starting
// points — the spec is explicit they get tuned against a run you *know* is clean.
//
// Per §4.2/§4.3 recommendation we ship S1 (death) + S2 (jitter, general + per-mode) and
// SKIP S3 (reference-line) and clearance-based S1 (needs level geometry not in the dump).

import {
  JITTER_FLIP_RATE, JITTER_MAX_DISPLACEMENT, DOUBLE_FLIP_MS,
} from '../shared/protocol.js';

// Run every applicable heuristic against a segment, appending flags to seg.flags.
export function scoreSegment(seg) {
  s1_death(seg);
  s2_jitter(seg);            // general case — works in every mode
  switch (seg.mode) {
    case 'ship': s2_ship(seg); break;
    case 'wave': s2_wave(seg); break;
    case 'ball':
    case 'swing':
    case 'spider': s2_doubleFlip(seg); break;
    case 'ufo': s2_ufo(seg); break;
    default: break; // cube/robot: general jitter check is enough
  }
  return seg;
}

function flag(seg, tier, code, detail) {
  seg.flags.push({ tier, code, detail });
}

// ── S1: Critical — death (§4.1) ───────────────────────────────────────────────
// Shipping death-only per §4.2 caveat; clearance-based near-death needs level geometry.
function s1_death(seg) {
  const deadTick = seg.ticks.find((t) => t.dead);
  if (deadTick) {
    flag(seg, 1, 'death', { ms: deadTick.ms, mode: seg.mode });
  }
}

// ── S2: the general jitter/overcorrection check (§4.2) ────────────────────────
// "The single highest-value check." Many vy direction changes with little net progress
// = fighting the physics.
function s2_jitter(seg) {
  if (seg.durationMs < 100) return;
  const flips = countSignChanges(seg.ticks.map((t) => t.vy));
  const flipRate = flips / (seg.durationMs / 1000);
  const netDisplacement = Math.abs(seg.ticks[seg.ticks.length - 1].y - seg.ticks[0].y);
  if (flipRate > JITTER_FLIP_RATE && netDisplacement < JITTER_MAX_DISPLACEMENT) {
    flag(seg, 2, 'jitter', {
      flipRate: round1(flipRate),
      netDisplacement: round1(netDisplacement),
    });
  }
}

// ── S2: Ship — sawtoothing when it should be gliding (§4.2) ────────────────────
function s2_ship(seg) {
  if (seg.durationMs < 150) return;
  const vy = seg.ticks.map((t) => t.vy);
  const y = seg.ticks.map((t) => t.y);
  const rot = seg.ticks.map((t) => t.rot);
  // High vy variance against low y variance = sawtoothing in a straight corridor.
  if (variance(vy) > 40 && variance(y) < 400) {
    flag(seg, 2, 'ship-saw', { vyVar: round1(variance(vy)), yVar: round1(variance(y)) });
  }
  // A ship fighting itself visibly wobbles — rotation oscillation.
  if (countSignChanges(derivative(rot)) / (seg.durationMs / 1000) > 10) {
    flag(seg, 2, 'ship-wobble', {});
  }
}

// ── S2/S3: Wave — panic spam vs demanded spam (§4.2) ──────────────────────────
// Ideal wave input is long, clean alternations. Short mean hold-duration is only bad
// when the corridor ISN'T genuinely tight. Hazard geometry isn't in the dump, so we
// use y-range as a proxy for corridor height: lots of vertical travel ⇒ not a tight
// corridor ⇒ short holds are panic, not necessity.
function s2_wave(seg) {
  if (seg.durationMs < 150) return;
  const holdDurations = heldRunLengthsMs(seg.ticks);
  if (holdDurations.length < 3) return;
  const meanHold = mean(holdDurations);
  const yRange = range(seg.ticks.map((t) => t.y));
  if (meanHold < 60 && yRange > 120) {
    flag(seg, 2, 'wave-panic', { meanHoldMs: round1(meanHold), yRange: round1(yRange) });
  }
}

// ── S2: Spider/Ball/Swing — wasted double-flip (§4.2) ─────────────────────────
// A→B→A within ~100ms with no intervening obstacle = a flip you immediately undid.
// We detect the gravity round-trip; "no intervening obstacle" is best-effort (no geometry).
function s2_doubleFlip(seg) {
  const flips = []; // ms of each gravity change
  for (let i = 1; i < seg.ticks.length; i++) {
    if (seg.ticks[i].grav !== seg.ticks[i - 1].grav) flips.push(seg.ticks[i].ms);
  }
  for (let i = 0; i + 1 < flips.length; i++) {
    // two flips close together return you to the original surface
    if (flips[i + 1] - flips[i] <= DOUBLE_FLIP_MS) {
      flag(seg, 2, 'double-flip', { gapMs: round1(flips[i + 1] - flips[i]) });
    }
  }
}

// ── S2: UFO — flap-spacing overcorrection (§4.2) ──────────────────────────────
// Near-minimum flap spacing producing a rising sawtooth rather than a smooth climb.
function s2_ufo(seg) {
  const flapMs = risingEdges(seg.ticks);
  if (flapMs.length < 4) return;
  const gaps = [];
  for (let i = 1; i < flapMs.length; i++) gaps.push(flapMs[i] - flapMs[i - 1]);
  const netY = seg.ticks[seg.ticks.length - 1].y - seg.ticks[0].y;
  // Tight, uniform flapping (low gap variance) that still barely climbs = overcorrection.
  if (mean(gaps) < 120 && Math.abs(netY) < 80 && gaps.length > 4) {
    flag(seg, 2, 'ufo-saw', { meanFlapMs: round1(mean(gaps)), netY: round1(netY) });
  }
}

// ── attribution (§4.1) ────────────────────────────────────────────────────────
// Attribute each segment's worst flag back to the notes that fall inside it.
export function attributeToNotes(segments, notes) {
  for (const seg of segments) {
    const worst = seg.flags.length
      ? seg.flags.reduce((a, b) => (a.tier <= b.tier ? a : b)) // tier 1 is worst
      : null;
    for (const note of notes) {
      const t = note._rawTimeMs ?? note.timeMs;
      if (t >= seg.startMs && t <= seg.endMs) {
        // Mark it analyzed so a clean note can earn the reserved gold (§7.2) — a note is
        // "clean" only if it was actually scored and survived, not merely un-flagged.
        note.scored = true;
        if (worst) {
          // lower tier number = higher severity; keep the most severe seen.
          if (note.severity === 0 || worst.tier < note.severity) note.severity = worst.tier;
          note.flag = worst.code;
        }
      }
    }
  }
  return notes;
}

// ── numeric helpers ───────────────────────────────────────────────────────────
export function countSignChanges(arr) {
  let changes = 0, prevSign = 0;
  for (const v of arr) {
    const s = Math.sign(v);
    if (s !== 0 && prevSign !== 0 && s !== prevSign) changes++;
    if (s !== 0) prevSign = s;
  }
  return changes;
}

function derivative(arr) {
  const d = [];
  for (let i = 1; i < arr.length; i++) d.push(arr[i] - arr[i - 1]);
  return d;
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function variance(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return mean(arr.map((v) => (v - m) ** 2));
}

function range(arr) {
  if (arr.length === 0) return 0;
  return Math.max(...arr) - Math.min(...arr);
}

// Rising edges of `held` → the ms of each fresh press (a UFO flap / a fresh click).
function risingEdges(ticks) {
  const out = [];
  for (let i = 1; i < ticks.length; i++) {
    if (ticks[i].held && !ticks[i - 1].held) out.push(ticks[i].ms);
  }
  return out;
}

// Lengths (ms) of each continuous held run.
function heldRunLengthsMs(ticks) {
  const out = [];
  let start = null;
  for (const t of ticks) {
    if (t.held && start === null) start = t.ms;
    else if (!t.held && start !== null) { out.push(t.ms - start); start = null; }
  }
  if (start !== null) out.push(ticks[ticks.length - 1].ms - start);
  return out;
}

function round1(n) { return Math.round(n * 10) / 10; }
