import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMacro } from '../shared/gdr.js';
import { parseTelemetry } from '../shared/telemetry.js';
import { synthMacro, synthTelemetryJsonl } from '../shared/synth.js';
import { checkCapture, impliedTelemetryTps } from '../analyzer/determinism.js';
import { analyze } from '../analyzer/pipeline.js';

function fixtures() {
  const macro = parseMacro(synthMacro());
  const telemetry = parseTelemetry(synthTelemetryJsonl({ withDeath: true }));
  return { macro, telemetry };
}

test('implied TPS from telemetry spacing ≈ recorded TPS', () => {
  const { telemetry } = fixtures();
  const tps = impliedTelemetryTps(telemetry);
  assert.ok(Math.abs(tps - 240) < 5, `implied ${tps}`);
});

test('determinism guard rejects a TPS mismatch (§6.5 #1)', () => {
  const { telemetry } = fixtures();
  const macro = parseMacro(synthMacro());
  macro.tps = 60; // pretend header said 60 but capture ran at 240
  const res = checkCapture(macro, telemetry, {});
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /TPS/.test(e)));
});

test('determinism guard rejects a completion that died in replay (§6.5 #2)', () => {
  const { macro, telemetry } = fixtures();
  const res = checkCapture(macro, telemetry, { expectComplete: true });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /DIED/.test(e)));
});

test('determinism guard passes a matched capture when completion not asserted', () => {
  const { macro, telemetry } = fixtures();
  const res = checkCapture(macro, telemetry, {});
  assert.equal(res.ok, true);
});

test('full pipeline flags jitter, a death, and a double-flip', () => {
  const { macro, telemetry } = fixtures();
  const res = analyze(macro, telemetry, {}); // not asserting completion, so death is allowed
  assert.equal(res.ok, true);
  const codes = new Set(res.report.map((r) => r.code));
  assert.ok(codes.has('death'), 'expected a death flag');
  assert.ok(codes.has('jitter') || codes.has('ship-saw'), 'expected a ship jitter flag');
  assert.ok(codes.has('double-flip'), 'expected a spider double-flip flag');
  // notes got severity attributed
  assert.ok(res.notes.some((n) => n.severity === 1), 'a note should be S1 (death segment)');
  assert.ok(res.notes.some((n) => n.severity === 2), 'a note should be S2 (jitter segment)');
});

test('report rows are sorted most-severe first', () => {
  const { macro, telemetry } = fixtures();
  const res = analyze(macro, telemetry, {});
  for (let i = 1; i < res.report.length; i++) {
    assert.ok(res.report[i - 1].tier <= res.report[i].tier);
  }
});
