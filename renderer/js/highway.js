// Highway renderer (§7) — canvas draw loop for both modes.
//
//   Companion (§7 table): trapezoidal perspective, full chrome, ghost trail, hit effects.
//   Overlay:   flat orthographic strip, notes + hit-line only, transparent background.
//
// Build Companion first; Overlay is a subtractive edit (strip perspective + chrome). The
// pure math lives in geometry.js and is unit-tested; this module is the drawing surface.

import { LOOKAHEAD_MS } from '../../shared/protocol.js';
import {
  visibleWindow, yForDelta, notesInRange, perspectiveScale, laneCenter, progress,
} from './geometry.js';
import { collapseForDisplay } from '../../shared/cluster.js';
import { C, noteColor, severityColor, rgba } from './colors.js';

const HIT_LINE_FRAC = 0.72;       // judgment line at 72% height — more future than past (§7.5)
const HIT_EFFECT_MS = 180;        // ring flash duration (§7.1)

export class Highway {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = opts.mode || 'companion';   // 'companion' | 'overlay'
    this.lookaheadMs = opts.lookaheadMs || LOOKAHEAD_MS;
    this.simplify = opts.simplify ?? true;  // collapse dense bursts to squiggles (§3.3)
    this.dual = opts.dual || false;
    this.reducedMotion = opts.reducedMotion || false;

    this.notes = [];
    this.ghost = null;              // telemetry ticks for the trajectory ribbon (§7.3)
    this._displayCache = null;      // memoized collapseForDisplay result
    this._effects = [];             // active hit flashes
    this._lastNow = -Infinity;      // for detecting line crossings
    this.bpm = opts.bpm || null;    // judgment-line pulse if known (§7.4)
  }

  setNotes(notes) {
    this.notes = notes || [];
    this._displayCache = null;
  }
  setGhost(telemetry) { this.ghost = telemetry; }
  setMode(mode) { this.mode = mode; }
  setSimplify(on) { this.simplify = on; this._displayCache = null; }
  setLookahead(ms) { this.lookaheadMs = ms; }

  _displayList() {
    if (!this.simplify) return this.notes.map((n) => ({ kind: 'note', note: n }));
    if (!this._displayCache) this._displayCache = collapseForDisplay(this.notes);
    return this._displayCache;
  }

  // Resize backing store to device pixels for crisp lines.
  resize() {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w; this.H = h;
    this.hitLineY = h * HIT_LINE_FRAC;
    this.highwayHeight = this.hitLineY; // notes travel from top to the line
  }

  render(nowMs) {
    const ctx = this.ctx;
    if (!this.W) this.resize();
    ctx.clearRect(0, 0, this.W, this.H);

    if (this.mode === 'companion') this._drawBackdrop();
    if (this.mode === 'companion') this._drawRail();
    if (this.mode === 'companion' && this.ghost) this._drawGhost(nowMs);

    this._detectCrossings(nowMs);
    this._drawNotes(nowMs);
    this._drawJudgmentLine(nowMs);
    this._drawEffects(nowMs);

    this._lastNow = nowMs;
  }

  // ── backdrop / rail (companion only) ────────────────────────────────────────
  _drawBackdrop() {
    const ctx = this.ctx;
    if (this.mode === 'overlay') return;
    ctx.fillStyle = C.void;
    ctx.fillRect(0, 0, this.W, this.H);
  }

  _drawRail() {
    const ctx = this.ctx;
    // Trapezoid: narrow at the horizon (top), full width at the line.
    const cx = this.W / 2;
    const topHalf = (this.W * 0.5) * perspectiveScale(1) * 0.9;
    const botHalf = (this.W * 0.5) * 0.9;
    const topY = this.hitLineY - this.highwayHeight;
    ctx.beginPath();
    ctx.moveTo(cx - topHalf, topY);
    ctx.lineTo(cx + topHalf, topY);
    ctx.lineTo(cx + botHalf, this.hitLineY);
    ctx.lineTo(cx - botHalf, this.hitLineY);
    ctx.closePath();
    ctx.fillStyle = rgba(C.rail, 0.55);
    ctx.fill();
    ctx.strokeStyle = rgba(C.railEdge, 0.9);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (this.dual) {
      // center divider between the two lanes
      ctx.beginPath();
      ctx.moveTo(cx, topY); ctx.lineTo(cx, this.hitLineY);
      ctx.strokeStyle = rgba(C.railEdge, 0.5);
      ctx.stroke();
    }
  }

  // ── ghost trail (§7.3) — the signature element ──────────────────────────────
  // The player's actual trajectory reconstructed from telemetry x/y, scrolling locked to
  // the same clock, low opacity, behind the rail, in the segment's severity color.
  _drawGhost(nowMs) {
    const ctx = this.ctx;
    const [lo, hi] = visibleWindow(nowMs, this.lookaheadMs);
    const ticks = this.ghost;
    // find the y-range of the visible slice to normalize the trajectory into lane space
    let minY = Infinity, maxY = -Infinity, any = false;
    for (const t of ticks) {
      if (t.ms < lo || t.ms > hi) continue;
      any = true;
      if (t.y < minY) minY = t.y;
      if (t.y > maxY) maxY = t.y;
    }
    if (!any) return;
    const span = Math.max(40, maxY - minY);
    const cx = this.W / 2;
    const laneHalf = this.W * 0.42;

    ctx.beginPath();
    let started = false;
    let sevAccum = 0, n = 0;
    for (const t of ticks) {
      if (t.ms < lo || t.ms > hi) continue;
      const delta = t.ms - nowMs;
      const sy = yForDelta(delta, this.hitLineY, this.highwayHeight, this.lookaheadMs);
      const depth = progress(delta, this.lookaheadMs);
      // player y → horizontal deflection across the lane (grav flips the sign)
      const norm = ((t.y - minY) / span - 0.5) * (t.grav || 1);
      const sx = cx + norm * laneHalf * 2 * perspectiveScale(depth);
      if (!started) { ctx.moveTo(sx, sy); started = true; } else ctx.lineTo(sx, sy);
      sevAccum = Math.max(sevAccum, t.dead ? 1 : 0); n++;
    }
    ctx.lineWidth = 8;
    ctx.strokeStyle = rgba(severityColor(sevAccum, true), 0.25); // ~0.25 opacity (§7.3)
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // ── notes ───────────────────────────────────────────────────────────────────
  _drawNotes(nowMs) {
    const [lo, hi] = visibleWindow(nowMs, this.lookaheadMs);
    for (const item of this._displayList()) {
      if (item.kind === 'squiggle') {
        if (item.endMs >= lo && item.startMs <= hi) this._drawSquiggle(item, nowMs);
      } else {
        const n = item.note;
        const end = n.type === 'hold' ? n.timeMs + n.durationMs : n.timeMs;
        if (end >= lo && n.timeMs <= hi) this._drawNote(n, nowMs);
      }
    }
  }

  _laneX(player, depth) {
    const cx = this.W / 2;
    const center = laneCenter(player, this.dual);
    const off = (center - 0.5) * this.W;
    const scale = this.mode === 'overlay' ? 1 : perspectiveScale(depth);
    return cx + off * scale;
  }

  _noteWidth(depth) {
    const base = this.mode === 'overlay' ? this.W * 0.6 : this.W * 0.34;
    const scale = this.mode === 'overlay' ? 1 : perspectiveScale(depth);
    return base * scale;
  }

  _drawNote(note, nowMs) {
    const delta = note.timeMs - nowMs;
    const depth = progress(delta, this.lookaheadMs);
    const y = yForDelta(delta, this.hitLineY, this.highwayHeight, this.lookaheadMs);
    const x = this._laneX(note.player, depth);
    const w = this._noteWidth(depth);
    const color = noteColor(note);
    const fade = this._approachFade(y);

    if (note.type === 'hold') {
      const yEnd = yForDelta((note.timeMs + note.durationMs) - nowMs, this.hitLineY, this.highwayHeight, this.lookaheadMs);
      this._holdRibbon(x, y, yEnd, w, color, note.gamemode, fade);
    } else {
      this._tapMarker(x, y, w, color, note.gamemode, fade);
    }
  }

  // Approach fade over the first stretch after appearing (§7.4 ambient, never touches y).
  _approachFade(y) {
    if (this.reducedMotion) return 1;
    const topY = this.hitLineY - this.highwayHeight;
    const px = y - topY;
    return Math.min(1, px / 150);
  }

  // Tap silhouette varies by gamemode so a spider tap ≠ a cube tap at a glance (§3.2/§7.1).
  _tapMarker(x, y, w, color, mode, fade) {
    const ctx = this.ctx;
    const h = 12;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.shadowColor = rgba(color, 0.9);
    ctx.shadowBlur = 14;
    ctx.fillStyle = color;

    if (mode === 'ball' || mode === 'swing') {
      // state change → diamond
      ctx.beginPath();
      ctx.moveTo(x, y - h); ctx.lineTo(x + w / 2, y); ctx.lineTo(x, y + h); ctx.lineTo(x - w / 2, y);
      ctx.closePath(); ctx.fill();
    } else if (mode === 'spider') {
      // teleport → split chevrons
      ctx.fillRect(x - w / 2, y - h / 2, w, h / 2 - 1);
      ctx.fillRect(x - w / 2, y + 1, w, h / 2 - 1);
    } else {
      // cube / ufo / robot tap → rounded bar
      roundRect(ctx, x - w / 2, y - h / 2, w, h, 5);
      ctx.fill();
    }
    ctx.restore();
  }

  // Hold = one continuous ribbon with a bright core (§7.1 #3). The ribbon IS the trajectory
  // for wave/ship, so its length is meaningful, not decorative.
  _holdRibbon(x, yStart, yEnd, w, color, mode, fade) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = fade;
    const top = Math.min(yStart, yEnd), bot = Math.max(yStart, yEnd);
    // body
    ctx.fillStyle = rgba(color, 0.28);
    roundRect(ctx, x - w / 2, top, w, bot - top, 8); ctx.fill();
    // glowing core running along it
    ctx.shadowColor = rgba(color, 0.9);
    ctx.shadowBlur = 12;
    ctx.fillStyle = color;
    roundRect(ctx, x - w * 0.16, top, w * 0.32, bot - top, 6); ctx.fill();
    // caps
    ctx.fillRect(x - w / 2, bot - 3, w, 3);
    ctx.restore();
  }

  // A collapsed dense burst → one textured squiggle hold (§3.3).
  _drawSquiggle(sq, nowMs) {
    const ctx = this.ctx;
    const yStart = yForDelta(sq.startMs - nowMs, this.hitLineY, this.highwayHeight, this.lookaheadMs);
    const yEnd = yForDelta(sq.endMs - nowMs, this.hitLineY, this.highwayHeight, this.lookaheadMs);
    const depth = progress(sq.startMs - nowMs, this.lookaheadMs);
    const x = this._laneX(sq.player, depth);
    const w = this._noteWidth(depth) * 0.8;
    const color = sq.severity === 1 ? C.flagS1 : sq.severity >= 2 ? C.flagS2 : C.hold;
    const top = Math.min(yStart, yEnd), bot = Math.max(yStart, yEnd);

    ctx.save();
    ctx.fillStyle = rgba(color, 0.22);
    roundRect(ctx, x - w / 2, top, w, bot - top, 8); ctx.fill();
    // zigzag texture down the middle to read as "many toggles"
    ctx.strokeStyle = rgba(color, 0.9);
    ctx.lineWidth = 2;
    ctx.beginPath();
    const steps = Math.min(sq.toggleCount, 40);
    for (let i = 0; i <= steps; i++) {
      const yy = top + (bot - top) * (i / steps);
      const xx = x + (i % 2 ? 1 : -1) * w * 0.18;
      if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ── judgment line (§7.1 #2) — the anchor of the whole composition ───────────
  _drawJudgmentLine(nowMs) {
    const ctx = this.ctx;
    const y = this.hitLineY;
    let pulse = 0;
    if (!this.reducedMotion && this.bpm) {
      const beat = (nowMs / (60000 / this.bpm)) % 1;
      pulse = Math.max(0, 1 - beat) * 3;
    }
    // soft outer bloom
    ctx.save();
    ctx.shadowColor = rgba(C.judgment, 0.8);
    ctx.shadowBlur = 22 + pulse * 6;
    ctx.strokeStyle = rgba(C.judgment, 0.35);
    ctx.lineWidth = 6 + pulse;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.W, y); ctx.stroke();
    // hard bright core
    ctx.shadowBlur = 0;
    ctx.strokeStyle = C.judgment;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.W, y); ctx.stroke();
    ctx.restore();
  }

  // ── hit effects (§7.1 #5) ───────────────────────────────────────────────────
  _detectCrossings(nowMs) {
    if (nowMs <= this._lastNow) return; // no crossings while paused/rewound
    for (const item of this._displayList()) {
      const t = item.kind === 'squiggle' ? item.startMs : item.note.timeMs;
      if (t > this._lastNow && t <= nowMs) {
        const note = item.kind === 'squiggle' ? null : item.note;
        this._effects.push({
          at: nowMs, x: this._laneX(note ? note.player : item.player, 0),
          color: note ? noteColor(note) : C.hold,
          gold: note ? (note.scored && note.severity === 0) : false,
        });
      }
    }
  }

  _drawEffects(nowMs) {
    const ctx = this.ctx;
    // Keep only effects whose age is within [0, duration). Filtering on the fraction (not
    // just nowMs - at < dur) also discards effects stranded in the future by a clock jump
    // backwards (loop / reset / rewind) — which would otherwise yield a negative radius.
    this._effects = this._effects.filter((e) => {
      const p = (nowMs - e.at) / HIT_EFFECT_MS;
      return p >= 0 && p < 1;
    });
    if (this.reducedMotion) return; // reduced-motion keeps notes moving but kills flashes (§7.4)
    for (const e of this._effects) {
      const p = (nowMs - e.at) / HIT_EFFECT_MS; // 0→1, guaranteed in range by the filter
      const r = 8 + p * 34;
      ctx.save();
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 3 * (1 - p);
      ctx.beginPath(); ctx.arc(e.x, this.hitLineY, r, 0, Math.PI * 2); ctx.stroke();
      // particle burst only on gold (clean) segments — make the reward land (§7.4)
      if (e.gold && this.mode === 'companion') {
        ctx.fillStyle = C.clean;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const rr = r * 1.1;
          ctx.globalAlpha = (1 - p) * 0.8;
          ctx.beginPath();
          ctx.arc(e.x + Math.cos(a) * rr, this.hitLineY + Math.sin(a) * rr, 2.4 * (1 - p), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
