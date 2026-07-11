// Segmentation (§4.1) — badness is a property of a burst of inputs, not a single click.
// Split the telemetry into segments on: gamemode change, gravity flip, or a gap > ~300ms
// with no input. Score the segment (§4.2), then attribute the score back to its notes.

import { SEGMENT_GAP_MS } from '../shared/protocol.js';

export function segmentTelemetry(telemetry, opts = {}) {
  const gapMs = opts.segmentGapMs ?? SEGMENT_GAP_MS;
  const segments = [];
  if (telemetry.length === 0) return segments;

  let cur = startSegment(telemetry[0]);
  let lastHeldMs = telemetry[0].held ? telemetry[0].ms : -Infinity;

  for (let i = 0; i < telemetry.length; i++) {
    const t = telemetry[i];
    const prev = cur.ticks[cur.ticks.length - 1];

    const modeChanged = prev && t.mode !== prev.mode;
    // NB: a gravity flip is NOT a segment boundary — inside a ball/spider segment the
    // flips ARE the events we score (§4.1 splits on gamemode/portal/idle gap only).
    // "gap with no input": time since we last saw the button held.
    const idleGap = t.held ? 0 : (t.ms - lastHeldMs);
    const bigIdleBreak = prev && idleGap > gapMs && t.held; // break at the resumption of input

    if (prev && (modeChanged || bigIdleBreak)) {
      finishSegment(cur);
      segments.push(cur);
      cur = startSegment(t);
    }
    cur.ticks.push(t);
    if (t.held) lastHeldMs = t.ms;
  }
  finishSegment(cur);
  segments.push(cur);
  return segments;
}

function startSegment(firstTick) {
  return {
    startMs: firstTick.ms,
    endMs: firstTick.ms,
    mode: firstTick.mode,
    grav: firstTick.grav,
    ticks: [],
    flags: [], // {tier, code, detail} appended by heuristics
  };
}

function finishSegment(seg) {
  const last = seg.ticks[seg.ticks.length - 1];
  seg.endMs = last ? last.ms : seg.startMs;
  seg.durationMs = seg.endMs - seg.startMs;
}
