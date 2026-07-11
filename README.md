# GD Note Highway

A PJSK-style incoming-note overlay for Geometry Dash 2.2 — shows upcoming clicks and hold
durations on a scrolling highway, synced to the level clock, and flags sloppy movement from
a replay's physics. **Read-only**: it displays and analyzes, it never presses buttons or
writes macros (§8 of the spec).

Target environment: macOS host running the Windows GD build under Wine/CrossOver. The trick
that makes it cheap: a thin C++ "sync tap" mod inside Wine streams the game clock over a
localhost socket to a fat native-macOS renderer (HTML/JS) where all the iteration happens.

---

## What's built

| Component | Status | Language | Verified here |
|---|---|---|---|
| **B — Renderer** (`renderer/`) | ✅ working | JS (browser) | headless smoke + screenshots |
| **C — Analyzer** (`analyzer/`) | ✅ working | JS (node) | unit tests + CLI on fixtures |
| **Shared** (`shared/`) | ✅ working | JS | unit tests |
| **A — Sync Tap** (`mod/`) | ✍️ source complete, builds on CI | C++ (Geode) | not compiled in this repo host* |

\* The mod targets the **Windows** Geode build and can't be cross-compiled from this Linux
JS host. The source is complete and conforms to the wire protocol the (tested) renderer
speaks; build the `.geode` via the `Build mod` GitHub Action (`windows-latest`) and verify
on-device per Phase 2/5.

This maps to the spec's phase order: **Phases 1–4 + 6 (a complete, useful tool) are done and
tested**; the mod (Phases 2–5's Wine side) is written and CI-buildable.

---

## Quick start (renderer — no Wine, no build step)

```bash
node scripts/serve.js         # http://127.0.0.1:8080/renderer/
```

Open the URL. It boots in **demo mode** with synthetic data and a self-running clock — the
highway animates immediately, gold where the run scored clean, amber/red where it didn't.
Load a real `.gdr` (and optional `.telemetry.jsonl`) with the file pickers, or click
**connect tap** to attach to the live mod over WebSocket.

Controls: toggle **companion ↔ overlay** mode, **simplify** (collapse dense bursts to
squiggles, §3.3), **lookahead** (scroll speed), **play/pause** (demo clock).

## Analyzer (offline movement scoring)

```bash
node fixtures/make-fixtures.js
node analyzer/cli.js fixtures/sample.gdr.json fixtures/sample.telemetry.jsonl
# add --complete to enable the death-desync determinism guard (§6.5)
```

Emits a severity report (S1 death, S2 jitter/ship-saw/wave-panic/double-flip/ufo-saw) and
annotates each note with severity for the renderer's heat-map coloring.

## Tests

```bash
node --test          # 30 unit tests across parsing, notes, clustering, geometry,
                     # playhead interpolation, telemetry, determinism, and the pipeline
PW_PATH=$(npm root -g)/playwright node scripts/smoke.mjs   # headless renderer smoke
```

---

## Layout

```
shared/      protocol constants (incl. the ONE global offset, §6.3), GDR+msgpack+gdph
             parsing, note derivation, display clustering, telemetry, synthetic data
renderer/    index.html + css tokens + canvas highway (companion & overlay), playhead
             interpolation, reconnecting WS client, in-browser analyzer wiring
analyzer/    segmentation, S1/S2 heuristics, §6.5 determinism guards, report, CLI
mod/         the Geode sync tap: net.hpp (WS server), ring.hpp (off-thread drain),
             main.cpp (hooks + live/capture modes), mod.json, CMakeLists.txt
```

## Design notes worth knowing

- **`macroTPS` is read from the header, never assumed 60** (§3.1). Getting it wrong is a 4×
  error; `readTps` throws rather than default silently.
- **Note `y` is strictly linear in time** (§7.4) — enforced and unit-tested. Easing it would
  make even rhythm render uneven, which is the one thing the chart exists to show.
- **The global audio offset lives in exactly one constant** (`GLOBAL_OFFSET_MS`, §6.3).
- **Determinism guards fail loudly** (§6.5): a completion that "died" in replay, or a TPS
  mismatch, aborts analysis instead of scoring a run that never happened.
- **Gold is reserved** for scored-clean segments (§7.2) — the reward color, nothing else.

See the full technical spec for the reasoning behind each of these.
