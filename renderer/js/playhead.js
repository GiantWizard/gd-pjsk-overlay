// Playhead (§3.5) — a smooth, monotonic estimate of song time between authoritative ticks.
//
// The game emits ticks at 60–240Hz; the display refreshes at ~120Hz. Rendering directly
// off the last tick judders. Instead we keep a local estimate that free-runs off a
// high-res clock and gets continuously corrected by each incoming tick. Snap hard (don't
// lerp) on reset — a checkpoint respawn is a discontinuity, not a glide (§3.5).
//
// `nowFn` is injectable so this is unit-testable without a real clock.

export class Playhead {
  constructor(nowFn = () => performance.now()) {
    this._now = nowFn;
    this.base = 0;        // authoritative song ms at the last tick
    this.baseAt = nowFn();// local clock reading when that tick arrived
    this.speed = 1;       // playback speed (speed portals; §6.1 audio stays 1×, this is game speed)
    this.paused = false;
    this.connected = false;
  }

  // Apply an authoritative tick from the game clock.
  onTick(msg) {
    this.base = msg.ms;
    this.baseAt = this._now();
    if (msg.speed != null) this.speed = msg.speed;
    if (msg.paused != null) this.paused = msg.paused;
  }

  // A reset (checkpoint respawn / restart) is a discontinuity — snap, don't interpolate.
  onReset(ms) {
    this.base = ms;
    this.baseAt = this._now();
  }

  onPause() { this.base = this.ms; this.baseAt = this._now(); this.paused = true; }
  onResume(ms) { if (ms != null) this.base = ms; this.baseAt = this._now(); this.paused = false; }

  // Interpolated current song time in ms.
  get ms() {
    if (this.paused) return this.base;
    const elapsed = this._now() - this.baseAt;
    return this.base + elapsed * this.speed;
  }
}

// Self-running clock for watching a loaded macro without the game attached. Loops at
// `durationMs`. Same base/baseAt scheme as Playhead so speed changes are continuous and
// pause/seek interactions stay trivial. `nowFn` is injectable for tests.
export class DemoClock {
  constructor(durationMs, nowFn = () => performance.now()) {
    this._now = nowFn;
    this.duration = durationMs;
    this.base = 0;         // song ms at the last rebase point
    this.baseAt = nowFn(); // local clock reading at that rebase
    this._speed = 1;
    this.paused = false;
  }

  get ms() {
    if (this.paused) return this.base;
    const raw = this.base + (this._now() - this.baseAt) * this._speed;
    return this.duration > 0 ? ((raw % this.duration) + this.duration) % this.duration : raw;
  }

  toggle() {
    // Rebase on both edges so position is preserved exactly across pause/resume.
    this.base = this.ms;
    this.baseAt = this._now();
    this.paused = !this.paused;
  }

  // Hard snap (a seek is a discontinuity, §3.5 — never lerp). Preserves paused state.
  seek(ms) {
    this.base = Math.min(Math.max(ms, 0), this.duration || 0);
    this.baseAt = this._now();
  }

  get speed() { return this._speed; }
  set speed(v) {
    // Rebase first so `ms` is continuous at the moment of the change.
    this.base = this.ms;
    this.baseAt = this._now();
    this._speed = v;
  }
}

// An <audio>-element-backed clock for Phase 1 (no Wine): audio.currentTime is
// sample-accurate and behaves almost identically to the in-game clock (§5.3), so render
// logic ported to the WS playhead unchanged. Exposes the same `.ms` interface.
export class AudioPlayhead {
  constructor(audioEl) {
    this.audio = audioEl;
    this.speed = 1;
    this.connected = true;
  }
  get paused() { return this.audio.paused; }
  get ms() { return this.audio.currentTime * 1000; }
  onReset(ms) { this.audio.currentTime = (ms || 0) / 1000; }
}
