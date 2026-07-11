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
