// Capture-replay determinism guards (§6.5) — the trap under the whole analysis pipeline.
//
// Capture mode replays the macro and records the resulting physics. That SILENTLY assumes
// the replay reproduces the original run. If it doesn't (e.g. TPS mismatch), the telemetry
// describes a run that never happened and every severity flag is fiction. Fail LOUDLY here.

// Returns { ok, warnings, errors }. `ok:false` means: do not analyze this capture.
export function checkCapture(macro, telemetry, opts = {}) {
  const errors = [];
  const warnings = [];

  if (!telemetry || telemetry.length === 0) {
    errors.push('Telemetry is empty — nothing to analyze.');
    return { ok: false, warnings, errors };
  }

  // Guard 1 (most important): replay at the TPS the macro was recorded at (§6.5 #1).
  // We can't set the replayer's TPS from here, but we CAN detect a mismatch: the
  // telemetry's own tick spacing implies a TPS; compare it to the macro header.
  const impliedTps = impliedTelemetryTps(telemetry);
  if (impliedTps && macro.tps) {
    const ratio = impliedTps / macro.tps;
    if (ratio < 0.9 || ratio > 1.11) {
      errors.push(
        `Replay TPS (~${impliedTps.toFixed(0)}) does not match macro TPS (${macro.tps}). ` +
        `Physics will have diverged (§6.5 #1). Re-capture at ${macro.tps} TPS.`
      );
    }
  }

  // Guard 2 (five-line check that catches most bad captures, §6.5 #2): a known completion
  // that died in replay = desync. Caller declares completion via opts.expectComplete.
  const died = telemetry.some((t) => t.dead);
  if (opts.expectComplete && died) {
    const at = telemetry.find((t) => t.dead);
    errors.push(
      `Macro is a known completion but the replay DIED at ms ${at.ms.toFixed(0)} — ` +
      `the replay desynced (§6.5 #2). Refusing to analyze.`
    );
  }

  // Guard 3 (§6.5 #3): compare final x against the macro's expected end, if provided.
  if (opts.expectedEndX != null) {
    const finalX = telemetry[telemetry.length - 1].x;
    const tol = opts.endXToleranceUnits ?? 30;
    if (Math.abs(finalX - opts.expectedEndX) > tol) {
      errors.push(
        `Final x (${finalX.toFixed(1)}) differs from expected end ` +
        `(${opts.expectedEndX}) beyond tolerance ${tol} — divergence even without a death (§6.5 #3).`
      );
    }
  } else {
    warnings.push('No expectedEndX provided — skipping final-position divergence check (§6.5 #3).');
  }

  return { ok: errors.length === 0, warnings, errors };
}

// Estimate TPS from median inter-tick spacing. GD 2.2 doesn't tick at a stable rate
// (§6.4), so use the median, not the mean, and only trust it as a coarse signal.
export function impliedTelemetryTps(telemetry) {
  if (telemetry.length < 10) return null;
  const gaps = [];
  for (let i = 1; i < telemetry.length; i++) {
    const g = telemetry[i].ms - telemetry[i - 1].ms;
    if (g > 0) gaps.push(g);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const medianGapMs = gaps[gaps.length >> 1];
  return medianGapMs > 0 ? 1000 / medianGapMs : null;
}
