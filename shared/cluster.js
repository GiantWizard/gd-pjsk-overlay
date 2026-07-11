// Display simplification pass (§3.3) — collapse high-frequency toggle bursts
// (wave spam, ball micro-corrections) into readable "squiggle holds".
//
// This is PURELY a rendering transform. It never touches the underlying note data —
// that would misrepresent what the macro actually does (§3.3). Keep it as a renderer
// toggle (simplified vs raw), not a destructive edit.

import { MERGE_GAP_MS, SQUIGGLE_MIN_TOGGLES } from './protocol.js';

// Group notes whose consecutive spacing is within `mergeGapMs`. A group with more than
// `squiggleMin` toggles renders as one textured squiggle hold spanning start→end;
// smaller groups pass through as their individual notes untouched.
export function collapseForDisplay(notes, opts = {}) {
  const mergeGap = opts.mergeGapMs ?? MERGE_GAP_MS;
  const squiggleMin = opts.squiggleMin ?? SQUIGGLE_MIN_TOGGLES;

  const out = [];
  let cluster = null;

  const flush = () => {
    if (!cluster) return;
    if (cluster.members.length > squiggleMin) {
      out.push(squiggleFromCluster(cluster));
    } else {
      // Below the threshold: emit the members as ordinary notes, unchanged.
      for (const n of cluster.members) out.push({ kind: 'note', note: n });
    }
    cluster = null;
  };

  for (const note of notes) {
    // Only same-player, same-mode runs collapse together; a mode change breaks the run.
    const compatible = cluster &&
      note.timeMs - cluster.lastMs <= mergeGap &&
      note.player === cluster.player &&
      note.gamemode === cluster.gamemode;

    if (compatible) {
      cluster.lastMs = endOf(note);
      cluster.members.push(note);
    } else {
      flush();
      cluster = {
        startMs: note.timeMs,
        lastMs: endOf(note),
        player: note.player,
        gamemode: note.gamemode,
        members: [note],
      };
    }
  }
  flush();
  return out;
}

function endOf(note) {
  return note.type === 'hold' ? note.timeMs + note.durationMs : note.timeMs;
}

function squiggleFromCluster(cluster) {
  // A squiggle inherits the worst severity of its members so a jittery burst still
  // reads as flagged even when collapsed.
  let severity = 0;
  for (const n of cluster.members) severity = Math.max(severity, n.severity || 0);
  return {
    kind: 'squiggle',
    startMs: cluster.startMs,
    endMs: cluster.lastMs,
    toggleCount: cluster.members.length,
    player: cluster.player,
    gamemode: cluster.gamemode,
    severity,
    members: cluster.members,
  };
}
