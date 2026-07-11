// Severity report (§4.4) — a flat, scannable list of flagged segments, plus the
// annotated note list the renderer consumes as color/glow.

const TIER_NAME = { 1: 'S1', 2: 'S2', 3: 'S3' };

// Human-readable one-liner per flag code.
function describe(code, detail) {
  switch (code) {
    case 'death':       return 'death';
    case 'jitter':      return `jitter: ${detail.flipRate} vy flips/s, ${detail.netDisplacement}u net displacement`;
    case 'ship-saw':    return `ship saw: vy var ${detail.vyVar} vs y var ${detail.yVar}`;
    case 'ship-wobble': return 'ship wobble: rotation oscillating';
    case 'wave-panic':  return `wave panic-spam: mean hold ${detail.meanHoldMs}ms in a ${detail.yRange}u-open corridor`;
    case 'double-flip': return `wasted double-flip (A→B→A in ${detail.gapMs}ms)`;
    case 'ufo-saw':     return `ufo overcorrection: ${detail.meanFlapMs}ms flaps, ${detail.netY}u climb`;
    default:            return code;
  }
}

// Build a flat report array from scored segments.
export function buildReport(segments, totalMs) {
  const rows = [];
  for (const seg of segments) {
    for (const f of seg.flags) {
      const atMs = f.detail?.ms ?? seg.startMs;
      rows.push({
        tier: f.tier,
        tierName: TIER_NAME[f.tier],
        pct: totalMs > 0 ? (atMs / totalMs) * 100 : 0,
        ms: atMs,
        mode: seg.mode || '?',
        code: f.code,
        text: describe(f.code, f.detail || {}),
      });
    }
  }
  // Most severe first, then chronological.
  rows.sort((a, b) => a.tier - b.tier || a.ms - b.ms);
  return rows;
}

// Render the report as fixed-width text (JetBrains-Mono-friendly, §7.2 data face).
export function formatReport(rows) {
  if (rows.length === 0) return 'No flags. The run is clean. 🟡 (gold)';
  const lines = rows.map((r) =>
    `${r.tierName}  ${pct(r.pct)}  ms ${msCol(r.ms)}  ${r.mode.padEnd(7)} ${r.text}`
  );
  return lines.join('\n');
}

function pct(p) { return `${p.toFixed(1).padStart(5)}%`; }
function msCol(ms) { return String(Math.round(ms)).padStart(7); }
