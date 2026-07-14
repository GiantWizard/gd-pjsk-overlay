// Palette (§7.2) — mirrors renderer/css/tokens.css so canvas code and CSS agree.
// GD neon-on-dark ∩ PJSK glassy pastel-neon: bright, translucent, jewel-toned on near-black.

export const C = Object.freeze({
  void:     '#0A0D1A',
  rail:     '#161C33',
  railEdge: '#2E3A63',
  tap:      '#3ADFF0', // cyan — cube, robot, UFO flaps
  hold:     '#45E08C', // green — ship, wave (the ribbon color)
  flip:     '#F05FA8', // magenta — ball, swing, spider (state changes)
  judgment: '#FFFFFF', // the line
  clean:    '#FFD75E', // gold — RESERVED: a segment scored clean. The reward color (§7.2).
  flagS2:   '#FF9838', // amber — inefficient
  flagS1:   '#FF4657', // red — critical
  dim:      '#6B77A6',
});

// Base color by what the click DOES (§3.2), before severity overrides.
export function baseColor(note) {
  const mode = note.gamemode;
  if (mode === 'ball' || mode === 'swing' || mode === 'spider') return C.flip;
  if (mode === 'ship' || mode === 'wave') return C.hold;
  if (mode === 'robot' && note.type === 'hold') return C.hold;
  // Macro-only loads (no telemetry) have gamemode null — let the note TYPE decide, so
  // hold ribbons still read as holds instead of all rendering in the tap color.
  if (!mode && note.type === 'hold') return C.hold;
  return C.tap; // cube, ufo, robot taps, unknown
}

// Final render color: severity wins, then the reserved gold for scored-clean, else base.
export function noteColor(note) {
  if (note.severity === 1) return C.flagS1;
  if (note.severity === 2) return C.flagS2;
  if (note.severity === 3) return C.flagS2;
  if (note.scored && note.severity === 0) return C.clean; // earned gold
  return baseColor(note);
}

// Severity color for the ghost trail / segment tint (§7.3), independent of note base.
export function severityColor(severity, scored) {
  if (severity === 1) return C.flagS1;
  if (severity >= 2) return C.flagS2;
  if (scored) return C.clean;
  return C.dim;
}

// rgba() from a #hex + alpha, for translucent fills/glows.
export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

// Per-channel linear blend of two #rrggbb colors; t=0 → hexA, t=1 → hexB.
// The skin uses mix(color, '#FFFFFF', 0.82) for the bright core band inside note boxes.
export function mix(hexA, hexB, t) {
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  const ch = (shift) => {
    const va = (a >> shift) & 255, vb = (b >> shift) & 255;
    return Math.round(va + (vb - va) * t);
  };
  const to2 = (v) => v.toString(16).padStart(2, '0');
  return `#${to2(ch(16))}${to2(ch(8))}${to2(ch(0))}`;
}
