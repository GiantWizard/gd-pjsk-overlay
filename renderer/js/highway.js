// Highway orchestrator (§7) — geometry, culling, crossing detection, and effect
// lifecycle for both modes. All actual pixels are drawn by the pure functions in
// skin.js; the palette lives in colors.js.
//
//   Companion (§7 table): perspective lane, glassy floor, time grid, ghost trail,
//                         death markers, combo-worthy hit flashes.
//   Overlay:   flat orthographic strip — notes, judgment strip, and flashes only.
//
// The one inviolable rule (§7.4): note y is a pure LINEAR function of
// (noteTime − playhead), always via geometry.js's yForDelta. Never eased.

import { LOOKAHEAD_MS } from '../../shared/protocol.js';
import { visibleWindow, yForDelta, perspectiveScale, laneCenter, progress } from './geometry.js';
import { collapseForDisplay } from '../../shared/cluster.js';
import { C, noteColor, severityColor, rgba } from './colors.js';
import {
  drawNoteBox, drawHoldRibbon, drawSquiggle, drawJudgmentStrip,
  drawHitFlash, drawDeathMarker, drawLaneFloor,
} from './skin.js';

const HIT_LINE_FRAC = 0.72;   // judgment strip at 72% height — more future than past (§7.5)
const HIT_EFFECT_MS = 260;    // hit flash duration
const NOTE_H = 20;            // note box height at the strip; scales with perspective
const GRID_STEP_MS = 500;     // ambient time gridline spacing (scrolls linearly — honest motion)

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
    this.deathMs = [];              // GDR2 death markers, in song ms
    this._displayCache = null;      // memoized display list (see _displayList)
    this._effects = [];             // active hit flashes
    this._lastNow = null;           // for crossing detection; null = fresh after a seek
  }

  setNotes(notes) {
    this.notes = notes || [];
    this._displayCache = null;
  }
  setGhost(telemetry) { this.ghost = telemetry; }
  setDeaths(msArray) { this.deathMs = msArray || []; }
  setMode(mode) { this.mode = mode; }
  setSimplify(on) { this.simplify = on; this._displayCache = null; }
  setLookahead(ms) { this.lookaheadMs = ms; }

  // Drop transient state after a discontinuity (seek/restart). Without this, a forward
  // seek would fire a flash for every note in the jumped-over range.
  resetTransients() {
    this._effects = [];
    this._lastNow = null;
  }

  // Memoized display list — both branches, so the raw view doesn't rebuild N wrapper
  // objects twice per frame. setNotes/setSimplify invalidate.
  _displayList() {
    if (!this._displayCache) {
      this._displayCache = this.simplify
        ? collapseForDisplay(this.notes)
        : this.notes.map((n) => ({ kind: 'note', note: n }));
    }
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
    this.highwayHeight = this.hitLineY; // notes travel from top to the strip
  }

  render(nowMs) {
    const ctx = this.ctx;
    if (!this.W) this.resize();
    ctx.clearRect(0, 0, this.W, this.H);

    if (this.mode === 'companion') {
      ctx.fillStyle = C.void;
      ctx.fillRect(0, 0, this.W, this.H);
      const topY = this.hitLineY - this.highwayHeight;
      drawLaneFloor(ctx, {
        cx: this.W / 2,
        topY,
        botY: this.hitLineY,
        topHalf: (this.W * 0.5) * perspectiveScale(1) * 0.9,
        botHalf: (this.W * 0.5) * 0.9,
        dual: this.dual,
      });
      this._drawTimeGrid(nowMs);
      if (this.ghost) this._drawGhost(nowMs);
    }

    this._detectCrossings(nowMs);
    if (this.mode === 'companion') this._drawDeaths(nowMs);
    this._drawNotes(nowMs);
    drawJudgmentStrip(ctx, {
      y: this.hitLineY,
      width: this.W,
      height: this.mode === 'companion' ? 14 : 8,
    });
    this._drawEffects(nowMs);

    this._lastNow = nowMs;
  }

  // ── ambient time grid (companion) ────────────────────────────────────────────
  // Faint horizontal lines every GRID_STEP_MS of song time, scrolling with the clock.
  // They move exactly like the notes (pure yForDelta) — ambient but honest motion.
  _drawTimeGrid(nowMs) {
    const ctx = this.ctx;
    const [lo, hi] = visibleWindow(nowMs, this.lookaheadMs);
    ctx.save();
    ctx.strokeStyle = rgba(C.railEdge, 0.25);
    ctx.lineWidth = 1;
    const cx = this.W / 2;
    for (let t = Math.ceil(lo / GRID_STEP_MS) * GRID_STEP_MS; t <= hi; t += GRID_STEP_MS) {
      const delta = t - nowMs;
      const y = yForDelta(delta, this.hitLineY, this.highwayHeight, this.lookaheadMs);
      const half = (this.W / 2) * 0.9 * perspectiveScale(progress(delta, this.lookaheadMs));
      ctx.beginPath();
      ctx.moveTo(cx - half, y);
      ctx.lineTo(cx + half, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── ghost trail (§7.3) — the signature element ──────────────────────────────
  // The player's actual trajectory reconstructed from telemetry x/y, scrolling locked to
  // the same clock, low opacity, behind the notes, in the segment's severity color.
  _drawGhost(nowMs) {
    const ctx = this.ctx;
    const [lo, hi] = visibleWindow(nowMs, this.lookaheadMs);
    const ticks = this.ghost;
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
    let sevAccum = 0;
    for (const t of ticks) {
      if (t.ms < lo || t.ms > hi) continue;
      const delta = t.ms - nowMs;
      const sy = yForDelta(delta, this.hitLineY, this.highwayHeight, this.lookaheadMs);
      const depth = progress(delta, this.lookaheadMs);
      const norm = ((t.y - minY) / span - 0.5) * (t.grav || 1);
      const sx = cx + norm * laneHalf * 2 * perspectiveScale(depth);
      if (!started) { ctx.moveTo(sx, sy); started = true; } else ctx.lineTo(sx, sy);
      sevAccum = Math.max(sevAccum, t.dead ? 1 : 0);
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
        if (item.endMs >= lo && item.startMs <= hi) this._drawSquiggleItem(item, nowMs);
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

  _noteHeight(depth) {
    if (this.mode === 'overlay') return NOTE_H;
    return Math.max(8, NOTE_H * perspectiveScale(depth));
  }

  static _variantFor(gamemode) {
    if (gamemode === 'ball' || gamemode === 'swing') return 'flip';
    if (gamemode === 'spider') return 'spider';
    return 'tap';
  }

  _drawNote(note, nowMs) {
    const delta = note.timeMs - nowMs;
    const depth = progress(delta, this.lookaheadMs);
    const y = yForDelta(delta, this.hitLineY, this.highwayHeight, this.lookaheadMs);
    const x = this._laneX(note.player, depth);
    const w = this._noteWidth(depth);
    const h = this._noteHeight(depth);
    const color = noteColor(note);
    const alpha = this._approachFade(y);
    const variant = Highway._variantFor(note.gamemode);

    if (note.type === 'hold') {
      const tailDelta = (note.timeMs + note.durationMs) - nowMs;
      const yTail = yForDelta(tailDelta, this.hitLineY, this.highwayHeight, this.lookaheadMs);
      const tailDepth = progress(tailDelta, this.lookaheadMs);
      drawHoldRibbon(this.ctx, {
        x, yHead: y, yTail,
        wHead: w, wTail: this._noteWidth(tailDepth),
        color, alpha,
      });
      drawNoteBox(this.ctx, {
        x: this._laneX(note.player, tailDepth), y: yTail,
        w: this._noteWidth(tailDepth), h: this._noteHeight(tailDepth),
        color, variant: 'tail', alpha,
      });
      drawNoteBox(this.ctx, { x, y, w, h, color, variant, alpha });
    } else {
      drawNoteBox(this.ctx, { x, y, w, h, color, variant, alpha });
    }
  }

  _drawSquiggleItem(sq, nowMs) {
    const startDelta = sq.startMs - nowMs;
    const yStart = yForDelta(startDelta, this.hitLineY, this.highwayHeight, this.lookaheadMs);
    const yEnd = yForDelta(sq.endMs - nowMs, this.hitLineY, this.highwayHeight, this.lookaheadMs);
    const depth = progress(startDelta, this.lookaheadMs);
    const x = this._laneX(sq.player, depth);
    const w = this._noteWidth(depth) * 0.8;
    const color = sq.severity === 1 ? C.flagS1 : sq.severity >= 2 ? C.flagS2 : C.hold;
    const alpha = this._approachFade(Math.min(yStart, yEnd));

    drawSquiggle(this.ctx, { x, yStart, yEnd, w, color, toggleCount: sq.toggleCount, alpha });
    drawNoteBox(this.ctx, {
      x, y: yStart, w: this._noteWidth(depth), h: this._noteHeight(depth),
      color, variant: 'tap', alpha,
    });
  }

  // Approach fade over the first stretch after appearing (§7.4 ambient, never touches y).
  _approachFade(y) {
    if (this.reducedMotion) return 1;
    const topY = this.hitLineY - this.highwayHeight;
    const px = y - topY;
    return Math.min(1, px / 150);
  }

  // ── death markers (GDR2 deaths array; companion study aid) ───────────────────
  _drawDeaths(nowMs) {
    if (!this.deathMs.length) return;
    const [lo, hi] = visibleWindow(nowMs, this.lookaheadMs);
    for (const ms of this.deathMs) {
      if (ms < lo || ms > hi) continue;
      const delta = ms - nowMs;
      const depth = progress(delta, this.lookaheadMs);
      const y = yForDelta(delta, this.hitLineY, this.highwayHeight, this.lookaheadMs);
      drawDeathMarker(this.ctx, {
        x: this._laneX(1, depth),
        y,
        size: Math.max(5, 10 * perspectiveScale(depth)),
      });
    }
  }

  // ── hit effects ───────────────────────────────────────────────────────────────
  _detectCrossings(nowMs) {
    if (this._lastNow === null) { this._lastNow = nowMs; return; } // fresh after seek
    if (nowMs <= this._lastNow) return; // no crossings while paused/rewound
    for (const item of this._displayList()) {
      const t = item.kind === 'squiggle' ? item.startMs : item.note.timeMs;
      if (t > this._lastNow && t <= nowMs) {
        const note = item.kind === 'squiggle' ? null : item.note;
        this._effects.push({
          at: nowMs,
          x: this._laneX(note ? note.player : item.player, 0),
          w: this._noteWidth(0),
          color: note ? noteColor(note) : C.hold,
          gold: note ? (note.scored && note.severity === 0) : false,
        });
      }
    }
  }

  _drawEffects(nowMs) {
    // Keep only effects whose age fraction is within [0, 1) — also discards effects
    // stranded in the future by a clock jump backwards (loop / reset / rewind).
    this._effects = this._effects.filter((e) => {
      const p = (nowMs - e.at) / HIT_EFFECT_MS;
      return p >= 0 && p < 1;
    });
    for (const e of this._effects) {
      const p = (nowMs - e.at) / HIT_EFFECT_MS;
      drawHitFlash(this.ctx, {
        x: e.x, y: this.hitLineY, w: e.w, color: e.color, gold: e.gold,
        pillar: this.mode === 'companion',
        reduced: this.reducedMotion,
      }, p);
    }
  }
}
