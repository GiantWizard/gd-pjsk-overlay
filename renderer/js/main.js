// Renderer wiring (Component B). Ties together: clock source (demo / audio / WS playhead),
// macro + telemetry ingest, the in-browser analyzer, and the highway draw loop.
//
// Phase 1 (§5.3): opens in DEMO mode with synthetic data and a self-running clock, so the
// highway animates with zero Wine and zero files. Load real files or connect the WS tap to
// replace the demo.

import { parseMacro } from '../../shared/gdr.js';
import { parseTelemetry } from '../../shared/telemetry.js';
import { synthMacro, synthTelemetry } from '../../shared/synth.js';
import { buildNoteList } from '../../shared/notes.js';
import { analyze } from '../../analyzer/pipeline.js';
import { formatReport } from '../../analyzer/report.js';
import { Playhead } from './playhead.js';
import { TapClient } from './ws.js';
import { Highway } from './highway.js';

const $ = (id) => document.getElementById(id);
const canvas = $('highway');
const highway = new Highway(canvas, {
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
});

// ── clock sources ─────────────────────────────────────────────────────────────
// Demo clock: free-runs from load, loops at `duration`. Stands in for the game clock.
class DemoClock {
  constructor(durationMs) { this.duration = durationMs; this.t0 = performance.now(); this.paused = false; this.speed = 1; this._pausedAt = 0; }
  get ms() {
    if (this.paused) return this._pausedAt;
    const e = (performance.now() - this.t0);
    return this.duration ? e % this.duration : e;
  }
  toggle() {
    if (this.paused) { this.t0 = performance.now() - this._pausedAt; this.paused = false; }
    else { this._pausedAt = this.ms; this.paused = true; }
  }
}

const state = {
  clock: null,
  notes: [],
  telemetry: null,
  level: { name: 'demo', id: null },
  durationMs: 16500,
};

// ── header / footer readouts ────────────────────────────────────────────────
let lastCallout = { severity: 0, code: null };
function updateReadouts(nowMs) {
  const pct = state.durationMs ? Math.max(0, Math.min(100, (nowMs / state.durationMs) * 100)) : 0;
  $('percent').textContent = pct.toFixed(1) + '%';
  // current gamemode + frame from the note stream / telemetry
  const active = activeNote(nowMs);
  $('gamemode').textContent = active?.gamemode || currentMode(nowMs) || '';
  $('frame').textContent = state.telemetry ? 'f ' + nearestFrame(nowMs) : '';
  const co = $('callout');
  if (active && active.severity > 0) {
    co.className = active.severity === 1 ? 's1' : 's2';
    co.textContent = (active.severity === 1 ? '▲ S1 ' : '▲ S2 ') + (active.flag || '');
  } else if (active && active.scored) {
    co.className = 'clean'; co.textContent = '● clean';
  } else { co.className = ''; co.textContent = ''; }
}

function activeNote(nowMs) {
  let best = null, bestD = Infinity;
  for (const n of state.notes) {
    const d = Math.abs(n.timeMs - nowMs);
    if (d < bestD && d < 250) { bestD = d; best = n; }
  }
  return best;
}
function currentMode(nowMs) {
  if (!state.telemetry) return null;
  let m = null;
  for (const t of state.telemetry) { if (t.ms > nowMs) break; m = t.mode; }
  return m;
}
function nearestFrame(nowMs) {
  if (!state.telemetry) return 0;
  let f = 0;
  for (const t of state.telemetry) { if (t.ms > nowMs) break; f = t.f; }
  return f;
}

// ── draw loop ────────────────────────────────────────────────────────────────
function frame() {
  const nowMs = state.clock ? state.clock.ms : 0;
  // Keep the loop alive across any transient draw glitch — an overlay that freezes mid-run
  // is worse than one that drops a frame. Surface the error once for debugging.
  try {
    highway.render(nowMs);
    updateReadouts(nowMs);
  } catch (e) {
    console.error('render frame error:', e);
  }
  requestAnimationFrame(frame);
}

// ── data loading ─────────────────────────────────────────────────────────────
function loadDemo() {
  const macro = parseMacro(synthMacro());
  const telemetry = synthTelemetry({ withDeath: true });
  applyData(macro, telemetry, { autoClock: true });
  setStatus('demo', 'audio');
  $('report').textContent = 'Demo data — synthetic. Load a .gdr to analyze a real run.';
}

function applyData(macro, telemetry, { autoClock } = {}) {
  state.telemetry = telemetry;
  state.level = macro.level;
  state.durationMs = (macro.duration ?? (telemetry?.at(-1)?.ms / 1000) ?? 16.5) * 1000;
  $('level-title').textContent = macro.level.name || macro.level.id || 'level';

  if (telemetry && telemetry.length) {
    const res = analyze(macro, telemetry, { force: true }); // force: demo/loaded, not asserting completion
    state.notes = res.ok ? res.notes : buildNoteList(macro, telemetry);
    highway.setGhost(telemetry);
    if (res.report) $('report').textContent = formatReport(res.report);
    if (!res.ok) $('report').textContent = '⚠ ' + res.capture.errors.join('\n⚠ ');
  } else {
    state.notes = buildNoteList(macro, null);
    highway.setGhost(null);
  }
  highway.setNotes(state.notes);
  highway.dual = state.notes.some((n) => n.player === 2);

  if (autoClock) state.clock = new DemoClock(state.durationMs);
}

async function loadFile(input, kind) {
  const file = input.files[0];
  if (!file) return;
  if (kind === 'macro') {
    const buf = new Uint8Array(await file.arrayBuffer());
    state._macro = parseMacro(buf);
  } else {
    state._telemetryText = await file.text();
  }
  const macro = state._macro;
  const telemetry = state._telemetryText ? parseTelemetry(state._telemetryText) : null;
  if (macro) applyData(macro, telemetry, { autoClock: !state.clock || state.clock instanceof DemoClock });
}

// ── WS tap (Phase 2/3) ───────────────────────────────────────────────────────
let tap = null;
function connectTap() {
  const ph = new Playhead();
  state.clock = ph;
  tap = new TapClient(undefined, {
    onStatus: (s) => setStatus(s, s),
    onTick: (m) => ph.onTick(m),
    onLevelStart: (m) => { $('level-title').textContent = m.name || m.id; if (m.songOffsetMs) ph.onReset(m.songOffsetMs); },
    onReset: (m) => ph.onReset(m.ms ?? 0),   // flush + re-seek; hard snap (§3.5)
    onPause: () => ph.onPause(),
    onResume: (m) => ph.onResume(m.ms),
    onLevelEnd: () => setStatus('level ended', 'disconnected'),
  });
  tap.connect();
}

function setStatus(text, cls) {
  const el = $('status');
  el.textContent = text;
  el.className = cls || '';
}

// ── controls ─────────────────────────────────────────────────────────────────
$('mode').onclick = () => {
  const overlay = document.body.classList.toggle('overlay');
  highway.setMode(overlay ? 'overlay' : 'companion');
  $('mode').textContent = overlay ? 'mode: overlay' : 'mode: companion';
};
$('simplify').onchange = (e) => highway.setSimplify(e.target.checked);
$('lookahead').oninput = (e) => { highway.setLookahead(+e.target.value); $('lookahead-val').textContent = e.target.value + 'ms'; };
$('connect').onclick = () => connectTap();
$('macro-file').onchange = (e) => loadFile(e.target, 'macro');
$('telemetry-file').onchange = (e) => loadFile(e.target, 'telemetry');
$('playpause').onclick = () => { if (state.clock instanceof DemoClock) state.clock.toggle(); };

addEventListener('resize', () => highway.resize());

// ── boot ─────────────────────────────────────────────────────────────────────
highway.resize();
loadDemo();
requestAnimationFrame(frame);
