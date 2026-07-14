// The highway's visual skin — every drawing primitive for notes, holds, the judgment
// strip, and hit effects. Pure functions taking (ctx, spec): no note-model knowledge,
// no clocks, no state. Highway owns geometry/culling/effect lifecycle and calls these.
//
// Design language (§7): chunky rounded box notes with a bright near-white core band and
// glowing colored edges, hold ribbons connecting head/tail boxes, and layered burst
// flashes on the judgment strip. All art is procedural canvas — original assets in the
// rhythm-game idiom, per §7.1.
//
// The one inviolable rule (§7.4): nothing here ever eases a note's y position. Easing
// exists only inside transient flash decorations (alpha/scale), never note placement.

import { C, rgba, mix } from './colors.js';

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ── The note box ──────────────────────────────────────────────────────────────
// Saturated color shell with an outer glow, a bright near-white core band, and a thin
// dark outline so the edge stays crisp against the glow.
//
// variant: 'tap'    — plain box (cube / ufo / robot taps / unknown)
//          'flip'   — white diamond glyph centered (ball / swing gravity flips)
//          'spider' — box split into two halves with a center gap (teleport)
//          'tail'   — hold tail: 75% height, no glyph
export function drawNoteBox(ctx, { x, y, w, h, color, variant = 'tap', alpha = 1 }) {
  const boxH = variant === 'tail' ? h * 0.75 : h;
  const r = boxH * 0.45;
  const left = x - w / 2, top = y - boxH / 2;

  ctx.save();
  ctx.globalAlpha = variant === 'tail' ? alpha * 0.9 : alpha;

  const shell = (sx, sw) => {
    // glow + colored shell
    ctx.shadowColor = rgba(color, 0.9);
    ctx.shadowBlur = color === C.clean ? 18 : 12; // gold gets a stronger halo
    ctx.fillStyle = color;
    roundRect(ctx, sx, top, sw, boxH, r);
    ctx.fill();
    ctx.shadowBlur = 0;
    // bright core band
    const insetY = boxH * 0.28, insetX = Math.min(sw * 0.06, 6);
    ctx.fillStyle = mix(color, '#FFFFFF', 0.82);
    roundRect(ctx, sx + insetX, top + insetY, sw - insetX * 2, boxH - insetY * 2, r * 0.6);
    ctx.fill();
    // crisp outline
    ctx.strokeStyle = rgba(C.void, 0.55);
    ctx.lineWidth = 1;
    roundRect(ctx, sx, top, sw, boxH, r);
    ctx.stroke();
  };

  if (variant === 'spider') {
    const gap = 3;
    const half = (w - gap) / 2;
    shell(left, half);
    shell(left + half + gap, half);
  } else {
    shell(left, w);
  }

  if (variant === 'flip') {
    // white rotated square glyph — a gravity flip is a state change, mark it distinctly
    const side = boxH * 0.55;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = rgba(C.void, 0.4);
    ctx.lineWidth = 1;
    ctx.fillRect(-side / 2, -side / 2, side, side);
    ctx.strokeRect(-side / 2, -side / 2, side, side);
    ctx.restore();
  }

  ctx.restore();
}

// ── Hold ribbon ───────────────────────────────────────────────────────────────
// Translucent trapezoid between the head and tail boxes (each end sized for its own
// perspective depth), with a faint bright center core. The caller layers the head box
// and tail box on top of this.
export function drawHoldRibbon(ctx, { x, yHead, yTail, wHead, wTail, color, alpha = 1 }) {
  const hwHead = wHead * 0.275, hwTail = wTail * 0.275; // ribbon = 55% of box width
  ctx.save();
  ctx.globalAlpha = alpha;

  const grad = ctx.createLinearGradient(0, yHead, 0, yTail);
  grad.addColorStop(0, rgba(color, 0.30));
  grad.addColorStop(1, rgba(color, 0.12));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(x - hwHead, yHead);
  ctx.lineTo(x + hwHead, yHead);
  ctx.lineTo(x + hwTail, yTail);
  ctx.lineTo(x - hwTail, yTail);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = rgba(mix(color, '#FFFFFF', 0.7), 0.5);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, yHead);
  ctx.lineTo(x, yTail);
  ctx.stroke();

  ctx.restore();
}

// ── Squiggle (collapsed dense toggle burst, §3.3) ─────────────────────────────
// Ribbon trapezoid + zigzag core so the burst reads as "many toggles", plus a head box
// so it still lands visually on the strip.
export function drawSquiggle(ctx, { x, yStart, yEnd, w, color, toggleCount, alpha = 1 }) {
  const top = Math.min(yStart, yEnd), bot = Math.max(yStart, yEnd);
  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.fillStyle = rgba(color, 0.22);
  roundRect(ctx, x - w / 2, top, w, bot - top, 8);
  ctx.fill();

  ctx.strokeStyle = rgba(color, 0.9);
  ctx.lineWidth = 2;
  ctx.beginPath();
  const steps = Math.min(toggleCount, 40);
  for (let i = 0; i <= steps; i++) {
    const yy = top + (bot - top) * (i / steps);
    const xx = x + (i % 2 ? 1 : -1) * w * 0.18;
    if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
  }
  ctx.stroke();
  ctx.restore();
}

// ── Judgment strip ────────────────────────────────────────────────────────────
// A glassy landing strip: soft bloom band, hot 2px core line, thin glass highlight.
export function drawJudgmentStrip(ctx, { y, width, height = 14 }) {
  ctx.save();
  // soft bloom
  const bloom = ctx.createLinearGradient(0, y - height, 0, y + height);
  bloom.addColorStop(0, rgba(C.judgment, 0));
  bloom.addColorStop(0.5, rgba(C.judgment, 0.28));
  bloom.addColorStop(1, rgba(C.judgment, 0));
  ctx.fillStyle = bloom;
  ctx.fillRect(0, y - height, width, height * 2);
  // hot core
  ctx.fillStyle = C.judgment;
  ctx.fillRect(0, y - 1, width, 2);
  // glass highlight just above the core
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, y - 5, width, 3);
  ctx.restore();
}

// ── Hit flash ─────────────────────────────────────────────────────────────────
// Layered landing burst; `t` in [0,1), lifecycle owned by the caller.
//   1. box-shaped shockwave matching the note width
//   2. vertical light pillar (companion only, fades early)
//   3. spark quads on a deterministic golden-angle spread (extra + gold-tinted for clean)
//   4. local strip-heat band (the judgment strip brightening under the note)
// reduced: true → layer 4 only (notes keep moving; particles/pillar removed).
export function drawHitFlash(ctx, { x, y, w, color, gold, pillar, reduced }, t) {
  const fade = 1 - t;
  const eOut = 1 - (1 - t) ** 3;
  ctx.save();

  // 4 — strip heat (always, and the only layer in reduced mode)
  const heatW = w * 1.6;
  const heat = ctx.createLinearGradient(x - heatW / 2, 0, x + heatW / 2, 0);
  heat.addColorStop(0, 'rgba(255,255,255,0)');
  heat.addColorStop(0.5, rgba('#FFFFFF', 0.5 * fade));
  heat.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = heat;
  ctx.fillRect(x - heatW / 2, y - 3, heatW, 6);

  if (reduced) { ctx.restore(); return; }

  // 1 — box shockwave
  const sw = w * (1 + 0.8 * eOut);
  const sh = 20 * (1 + 1.2 * eOut);
  ctx.globalAlpha = fade;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.5, 3 * fade);
  roundRect(ctx, x - sw / 2, y - sh / 2, sw, sh, sh * 0.45);
  ctx.stroke();

  // 2 — light pillar
  if (pillar && t < 0.6) {
    const pw = w * 0.5 * (1 - t * 0.5);
    const ph = 90;
    const pg = ctx.createLinearGradient(0, y, 0, y - ph);
    pg.addColorStop(0, rgba(color, 0.35 * fade));
    pg.addColorStop(1, rgba(color, 0));
    ctx.globalAlpha = 1;
    ctx.fillStyle = pg;
    ctx.fillRect(x - pw / 2, y - ph, pw, ph);
  }

  // 3 — sparks
  const count = gold ? 12 : 7;
  const radius = 14 + 46 * eOut;
  const side = 3.5 * fade;
  ctx.globalAlpha = fade;
  for (let i = 0; i < count; i++) {
    const angle = i * 2.4; // golden-angle spread — deterministic, no RNG state
    const sx = x + Math.cos(angle) * radius;
    const sy = y + Math.sin(angle) * radius * 0.6; // squash vertically toward the strip
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(angle);
    ctx.fillStyle = gold && i % 2 ? C.clean : color;
    ctx.fillRect(-side / 2, -side / 2, side, side);
    ctx.restore();
  }

  ctx.restore();
}

// ── Death marker ──────────────────────────────────────────────────────────────
// Red ✕ at a death frame (GDR2 deaths array) — a study aid, companion mode only.
export function drawDeathMarker(ctx, { x, y, size, alpha = 0.8 }) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = C.flagS1;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - size, y - size); ctx.lineTo(x + size, y + size);
  ctx.moveTo(x + size, y - size); ctx.lineTo(x - size, y + size);
  ctx.stroke();
  ctx.restore();
}

// ── Lane floor ────────────────────────────────────────────────────────────────
// Perspective trapezoid restyled: dark glassy vertical-gradient floor with light strips
// along the slanted edges.
export function drawLaneFloor(ctx, { cx, topY, botY, topHalf, botHalf, dual }) {
  ctx.save();

  const grad = ctx.createLinearGradient(0, topY, 0, botY);
  grad.addColorStop(0, rgba(C.rail, 0.25));
  grad.addColorStop(1, rgba(C.rail, 0.75));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(cx - topHalf, topY);
  ctx.lineTo(cx + topHalf, topY);
  ctx.lineTo(cx + botHalf, botY);
  ctx.lineTo(cx - botHalf, botY);
  ctx.closePath();
  ctx.fill();

  // edge light strips: a wide soft line under a thin bright inner line
  for (const side of [-1, 1]) {
    ctx.strokeStyle = rgba(C.railEdge, 0.8);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx + side * topHalf, topY);
    ctx.lineTo(cx + side * botHalf, botY);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + side * topHalf, topY);
    ctx.lineTo(cx + side * botHalf, botY);
    ctx.stroke();
  }

  if (dual) {
    ctx.strokeStyle = rgba(C.railEdge, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, topY);
    ctx.lineTo(cx, botY);
    ctx.stroke();
  }

  ctx.restore();
}
