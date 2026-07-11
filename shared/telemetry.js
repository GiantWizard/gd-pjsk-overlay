// Telemetry ingest (§2.6) — parse a `<macro>.telemetry.jsonl` physics dump.
//
// JSONL, one physics tick per line. A truncated file (crash mid-replay) must still be
// parseable up to the last complete line (§2.6) — so we skip a trailing partial line
// rather than throwing.
//
// Tick shape: {f, ms, x, y, vy, rot, mode, grav, held, dead}

export function parseTelemetry(text) {
  const ticks = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      // A parse failure on the final line = truncated write; tolerate it (§2.6).
      // A failure anywhere else = genuinely corrupt; surface it.
      if (i === lines.length - 1) break;
      throw new Error(`Corrupt telemetry at line ${i + 1}: ${e.message}`);
    }
    ticks.push(normalizeTick(obj));
  }
  ticks.sort((a, b) => a.ms - b.ms);
  return ticks;
}

function normalizeTick(o) {
  return {
    f: num(o.f),
    ms: num(o.ms),
    x: num(o.x),
    y: num(o.y),
    vy: num(o.vy),
    rot: num(o.rot),
    mode: o.mode ?? null,
    grav: o.grav ?? 1,
    held: Boolean(o.held),
    dead: Boolean(o.dead),
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
