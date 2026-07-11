// Synthetic data generator — a deterministic fake macro + matching telemetry, used both
// by the fixture writer (node) and the browser demo (no file / no Wine needed for Phase 1).
//
// It deliberately contains: clean cube taps, a clean ship hold, a JITTERY ship burst,
// wave spam, a spider double-flip, and a death near the end — so every analyzer path
// and every render silhouette has something to chew on.

const TPS = 240;
const msToFrame = (ms) => Math.round((ms / 1000) * TPS);

// A tiny seeded PRNG so fixtures are byte-stable across runs (tests depend on this).
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// Build a normalized-ish raw GDR object (pre-parse) with frame-indexed inputs.
export function synthMacro() {
  const inputs = [];
  const press = (ms, downMs, player = 1) => {
    inputs.push({ frame: msToFrame(ms), btn: 1, '2p': player === 2, down: true });
    inputs.push({ frame: msToFrame(ms + downMs), btn: 1, '2p': player === 2, down: false });
  };

  // 0–3s cube: clean discrete taps every 400ms
  for (let ms = 400; ms < 3000; ms += 400) press(ms, 20);

  // 3–6s ship: one long clean hold, then normal glide taps
  press(3200, 1500);          // sustained thrust
  for (let ms = 5000; ms < 6000; ms += 250) press(ms, 60);

  // 6–9s ship JITTER: rapid short holds (sawtoothing)
  for (let ms = 6200; ms < 9000; ms += 90) press(ms, 40);

  // 9–12s wave spam: very tight alternation
  for (let ms = 9200; ms < 12000; ms += 70) press(ms, 35);

  // 12–14s spider: a wasted double-flip pair, then a clean flip
  press(12300, 15);
  press(12360, 15);           // 60ms after → double-flip
  press(13500, 15);

  // 14–16s cube run into a death
  for (let ms = 14000; ms < 16000; ms += 350) press(ms, 20);

  inputs.sort((a, b) => a.frame - b.frame);

  return {
    gameVersion: 2.2,
    framerate: TPS,
    botInfo: { name: 'synth', version: '1.0' },
    levelInfo: { id: 60978746, name: 'The Golden (synthetic)' },
    duration: 16.5,
    platformer: false,
    inputs,
  };
}

// Build telemetry consistent with the macro above. x rises monotonically; mode changes
// on schedule; jitter/wave sections get sign-flipping vy; a death is stamped at ~16s.
export function synthTelemetry({ withDeath = true } = {}) {
  const rand = rng(1234);
  const ticks = [];
  const dtMs = 1000 / TPS;
  const total = 16.5;
  let f = 0;
  let x = 0;
  let y = 200;

  for (let ms = 0; ms < total * 1000; ms += dtMs, f++) {
    const s = ms / 1000;
    let mode = 'cube', grav = 1, vy = 0, held = false;

    if (s < 3)        { mode = 'cube'; }
    else if (s < 6)   { mode = 'ship'; vy = Math.sin(s * 3) * 4; held = (s < 4.7); }
    else if (s < 9)   { mode = 'ship'; vy = (rand() - 0.5) * 30; held = (Math.floor(ms / 90) % 2 === 0); } // jitter
    else if (s < 12)  { mode = 'wave'; vy = (Math.floor(ms / 70) % 2 ? 8 : -8); held = (Math.floor(ms / 70) % 2 === 0); }
    // spider: a wasted double-flip (grav 1→-1→1 within 60ms), then a clean lasting flip
    else if (s < 14)  {
      if (s >= 12.30 && s < 12.36) grav = -1;        // brief flip
      else if (s >= 13.50) grav = -1;                // clean flip that sticks
      else grav = 1;
      mode = 'spider';
    }
    else              { mode = 'cube'; }

    x += 5.77 * (dtMs / (1000 / TPS)); // ~ constant x-speed
    y += vy * 0.1;

    const dead = withDeath && Math.abs(ms - 16000) < dtMs / 2;
    ticks.push({
      f, ms: round1(ms), x: round1(x), y: round1(y),
      vy: round1(vy), rot: round1((vy * 4) % 360),
      mode, grav, held, dead,
    });
    if (dead) break;
  }
  return ticks;
}

export function synthTelemetryJsonl(opts) {
  return synthTelemetry(opts).map((t) => JSON.stringify(t)).join('\n') + '\n';
}

function round1(n) { return Math.round(n * 10) / 10; }
export const SYNTH_TPS = TPS;
