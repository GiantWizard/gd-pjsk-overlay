// Analyzer pipeline (§4) — the whole offline pass, wired together. Pure data; no game,
// no Wine, no C++. Given a parsed macro + telemetry, returns annotated notes + a report.

import { buildNoteList } from '../shared/notes.js';
import { checkCapture } from './determinism.js';
import { segmentTelemetry } from './segment.js';
import { scoreSegment, attributeToNotes } from './heuristics.js';
import { buildReport } from './report.js';

export function analyze(macro, telemetry, opts = {}) {
  // §6.5: refuse to analyze a desynced capture — its flags would be fiction.
  const capture = checkCapture(macro, telemetry, opts);
  if (!capture.ok && !opts.force) {
    return { ok: false, capture, notes: null, report: null, segments: null };
  }

  const notes = buildNoteList(macro, telemetry, opts);
  const segments = segmentTelemetry(telemetry, opts);
  for (const seg of segments) scoreSegment(seg);
  attributeToNotes(segments, notes);

  const totalMs = macro.duration != null
    ? macro.duration * 1000
    : (telemetry.length ? telemetry[telemetry.length - 1].ms : 0);
  const report = buildReport(segments, totalMs);

  return { ok: true, capture, notes, segments, report, totalMs };
}
