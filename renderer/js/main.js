// Renderer wiring (Component B). Ties together: clock source (demo / audio / WS playhead),
// macro + telemetry ingest, the in-browser analyzer, transport controls, and the highway
// draw loop.
//
// Phase 1 (§5.3): opens in DEMO mode with synthetic data and a self-running clock, so the
// highway animates with zero Wine and zero files. Load real files or connect the WS tap to
// replace the demo.

import { MacroError, parseMacro, frameToMs } from '../../shared/gdr.js';
import { parseTelemetry } from '../../shared/telemetry.js';
import { synthMacro, synthTelemetry } from '../../shared/synth.js';
import { buildNoteList, nearestIndex, countAtOrBefore } from '../../shared/notes.js';
import { analyze } from '../../analyzer/pipeline.js';
import { formatReport } from '../../analyzer/report.js';
import { Playhead, DemoClock } from './playhead.js';
import { TapClient } from './ws.js';
import { Highway } from './highway.js';

const $ = (id) => document.getElementById(id);
const canvas = $('highway');
const highway = new Highway(canvas, {
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
});

const state = {
  clock: null,
  notes: [],
  noteTimes: [],       // sorted note timeMs — binary-search index for combo/readouts
  telemetry: null,
  telemetryTimes: null, // sorted tick ms — binary-search index for mode/frame readouts
  deathMs: [],
  level: { name: 'demo', id: null },
  durationMs: 16500,
  scrubbing: false,
  lastCombo: 0,
};

const isDemo = () => state.clock instanceof DemoClock;

// ── header / footer readouts ────────────────────────────────────────────────
function updateReadouts(nowMs) {
  const pct = state.durationMs ? Math.max(0, Math.min(100, (nowMs / state.durationMs) * 100)) : 0;
  $('percent').textContent = pct.toFixed(1) + '%';

  const active = activeNote(nowMs);
  const tick = nearestTick(nowMs);
  $('gamemode').textContent = active?.gamemode || tick?.mode || '';
  $('frame').textContent = tick ? 'f ' + tick.f : '';

  const co = $('callout');
  if (active && active.severity > 0) {
    co.className = active.severity === 1 ? 's1' : 's2';
    co.textContent = (active.severity === 1 ? '▲ S1 ' : '▲ S2 ') + (active.flag || '');
  } else if (active && active.scored) {
    co.className = 'clean'; co.textContent = '● clean';
  } else { co.className = ''; co.textContent = ''; }

  updateCombo(nowMs);
  updateTransportReadout(nowMs);
}

// Nearest note within 250ms of the playhead, via binary search over the sorted index.
function activeNote(nowMs) {
  if (state.noteTimes.length === 0) return null;
  const i = nearestIndex(state.noteTimes, nowMs);
  const n = state.notes[i];
  return Math.abs(n.timeMs - nowMs) < 250 ? n : null;
}

// Nearest telemetry tick (mode + frame readouts) — one search instead of two scans.
function nearestTick(nowMs) {
  if (!state.telemetryTimes || state.telemetryTimes.length === 0) return null;
  return state.telemetry[nearestIndex(state.telemetryTimes, nowMs)];
}

// Combo is DERIVED from the playhead (count of notes at or before now), never
// accumulated — so seek, restart, loop-wrap, and WS resets all stay consistent.
function updateCombo(nowMs) {
  const combo = countAtOrBefore(state.noteTimes, nowMs);
  const el = $('combo-n');
  $('combo').hidden = combo === 0;
  if (combo !== state.lastCombo) {
    el.textContent = combo;
    if (combo > state.lastCombo) {
      el.classList.remove('pop');
      void el.offsetWidth; // restart the animation
      el.classList.add('pop');
    }
    state.lastCombo = combo;
  }
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
  $('report').textContent = 'Demo data — synthetic. Load a .gdr/.gdr2 to analyze a real run.';
}

// One-line summary for macro-only loads (no telemetry to analyze).
function macroSummary(macro, notes) {
  const bits = [
    macro.botName ? `bot: ${macro.botName}${macro.botVersion ? ' v' + macro.botVersion : ''}` : null,
    `${macro.tps} TPS`,
    `${notes.length} notes`,
    macro.deaths?.length ? `${macro.deaths.length} deaths` : null,
  ].filter(Boolean);
  return bits.join(' · ') + '\nno telemetry — movement analysis unavailable';
}

function applyData(macro, telemetry, { autoClock } = {}) {
  state.telemetry = telemetry;
  state.telemetryTimes = telemetry ? telemetry.map((t) => t.ms) : null;
  state.level = macro.level;
  state.durationMs = macro.durationMs ?? telemetry?.at(-1)?.ms ?? 16500;
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
    $('report').textContent = macroSummary(macro, state.notes);
  }

  state.noteTimes = state.notes.map((n) => n.timeMs);
  state.deathMs = (macro.deaths || []).map((f) => frameToMs(f, macro.tps));
  state.lastCombo = 0;
  highway.setDeaths(state.deathMs);
  highway.setNotes(state.notes);
  highway.resetTransients();
  highway.dual = state.notes.some((n) => n.player === 2);

  $('seek').max = Math.ceil(state.durationMs);
  if (autoClock) state.clock = new DemoClock(state.durationMs);
  updateTransport();
}

async function loadFile(input, kind) {
  const file = input.files[0];
  if (!file) return;
  try {
    if (kind === 'macro') {
      const buf = new Uint8Array(await file.arrayBuffer());
      try {
        state._macro = parseMacro(buf);
      } catch (err) {
        // A genuinely-missing-TPS macro (rare now that GDR2 parses correctly — this is a
        // real gap only for GDR1 JSON exports that truly omit the field) gets a manual
        // retry via the #fallback-tps input, instead of just failing.
        if (!isMissingTpsError(err)) throw err;
        const fallbackTps = Number($('fallback-tps').value);
        if (!Number.isFinite(fallbackTps) || fallbackTps <= 0) {
          throw new Error('Macro has no TPS metadata and the manual TPS is invalid.');
        }
        state._macro = parseMacro(buf, { tps: fallbackTps });
        $('report').textContent = `⚠ Macro has no TPS metadata; using manual TPS ${fallbackTps}.`;
      }
    } else {
      state._telemetryText = await file.text();
    }
  } catch (e) {
    console.error(`failed to load ${kind}:`, e);
    setStatus('load failed', 'disconnected');
    $('report').textContent = `⚠ Failed to load ${kind}: ${e.message}`;
    input.value = ''; // allow re-selecting the same filename after fixing it
    return;
  }
  const macro = state._macro;
  const telemetry = state._telemetryText ? parseTelemetry(state._telemetryText) : null;
  if (macro) applyData(macro, telemetry, { autoClock: !state.clock || isDemo() });
}

function isMissingTpsError(err) {
  return err instanceof MacroError && /no framerate\/fps\/tps field/i.test(err.message);
}

// ── WS tap (Phase 2/3) ───────────────────────────────────────────────────────
let tap = null;
function connectTap() {
  const ph = new Playhead();
  state.clock = ph;
  updateTransport(); // transport controls only drive the DemoClock — grey them out
  tap = new TapClient(undefined, {
    onStatus: (s) => setStatus(s, s),
    onTick: (m) => ph.onTick(m),
    onLevelStart: (m) => { $('level-title').textContent = m.name || m.id; if (m.songOffsetMs) ph.onReset(m.songOffsetMs); },
    onReset: (m) => { ph.onReset(m.ms ?? 0); highway.resetTransients(); }, // hard snap (§3.5)
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

// ── transport (watch-a-macro controls; DemoClock only) ───────────────────────
function updateTransport() {
  const demo = isDemo();
  for (const id of ['playpause', 'restart', 'seek', 'speed']) $(id).disabled = !demo;
}

function fmtTime(ms) {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function updateTransportReadout(nowMs) {
  if (!state.scrubbing) $('seek').value = nowMs;
  $('time').textContent = `${fmtTime(nowMs)} / ${fmtTime(state.durationMs)}`;
}

function seekTo(ms) {
  if (!isDemo()) return;
  state.clock.seek(ms);
  highway.resetTransients(); // a seek is a discontinuity — no retro-flashes
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

$('playpause').onclick = () => { if (isDemo()) state.clock.toggle(); };
$('restart').onclick = () => seekTo(0);
$('speed').onchange = (e) => { if (isDemo()) state.clock.speed = +e.target.value; };
$('seek').oninput = (e) => seekTo(+e.target.value);
$('seek').onpointerdown = () => { state.scrubbing = true; };
$('seek').onpointerup = () => { state.scrubbing = false; };

addEventListener('resize', () => highway.resize());

// ── boot ─────────────────────────────────────────────────────────────────────
highway.resize();
loadDemo();
requestAnimationFrame(frame);
