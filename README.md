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

## Where the code lives

Repo: `GiantWizard/gd-pjsk-overlay` on GitHub.
Branch: **`claude/gd-note-highway-a1bh3h`** — everything in this README is on that branch;
it has not been merged into `main` yet, so make sure you check it out (not `main`, which is
still just the placeholder initial commit).

```bash
git clone https://github.com/GiantWizard/gd-pjsk-overlay.git
cd gd-pjsk-overlay
git checkout claude/gd-note-highway-a1bh3h
```

---

## Setup

### Prerequisites

- **Node.js 22+** (uses native `node --test`, no test framework dependency) — check with
  `node --version`.
- A browser (Chrome/Edge/Firefox/Safari all fine) to view the renderer.
- **Only if you want the live in-game overlay**, not just the offline renderer/analyzer:
  - macOS with GD running under Wine/CrossOver (or a genuine Windows box).
  - [Geode](https://geode-sdk.org/) installed into that GD install (Windows build).

No `npm install` is required — the renderer and analyzer are dependency-free (the repo
even ships its own tiny GDR2 binary decoder rather than pulling one in), so `git clone` +
`node` is enough for everything except building the C++ mod.

### 1. Renderer (no Wine, no build step, works today)

```bash
node scripts/serve.js         # serves at http://127.0.0.1:8080/renderer/
```

Open that URL. It boots in **demo mode** with synthetic data and a self-running clock — the
highway animates immediately, gold where the run scored clean, amber/red where it didn't.
This is the whole point of Phase 1 (§5.3): you can judge the visual design with zero GD,
zero Wine, zero C++.

Load a real `.gdr` (and optional `.telemetry.jsonl`) with the file pickers, or click
**connect tap** to attach to the live mod over WebSocket once it's running (step 3 below).

Controls: toggle **companion ↔ overlay** mode, **simplify** (collapse dense bursts to
squiggles, §3.3), **lookahead** (scroll speed), **play/pause** (demo clock).

To develop the live-WS path without Wine, run the bundled mock tap in a second terminal
instead of the real mod — it speaks the same wire protocol:

```bash
node scripts/mock-tap.js      # ws://127.0.0.1:8787, loops a fake level
```

### 2. Analyzer (offline movement scoring, no Wine)

```bash
node fixtures/make-fixtures.js
node analyzer/cli.js fixtures/sample.gdr.json fixtures/sample.telemetry.jsonl
# add --complete to enable the death-desync determinism guard (§6.5)
```

Emits a severity report (S1 death, S2 jitter/ship-saw/wave-panic/double-flip/ufo-saw) and
annotates each note with severity for the renderer's heat-map coloring. Point it at your
own macro + telemetry files the same way once you have real captures (step 3).

### 3. The sync-tap mod (only needed for live in-game overlay / capture mode)

The mod is Windows C++ and can't be built on macOS/Linux directly. Two ways to get the
`.geode`:

**A — CI build (recommended):** push to this branch (or trigger manually) and download the
artifact from the `Build mod` GitHub Action, which compiles on `windows-latest`:
1. GitHub → Actions → **Build mod** → run/select the latest run for this branch.
2. Download the `gdhighway-tap.geode` artifact.

**B — Build it yourself on Windows:** install the [Geode CLI](https://docs.geode-sdk.org/),
then from `mod/`:
```bash
geode build
```

Then, regardless of how you built it:
```bash
# drop the .geode into the Wine prefix's GD mods folder, e.g.:
cp gdhighway-tap.geode ~/.wine/drive_c/Program\ Files\ \(x86\)/Steam/steamapps/common/Geometry\ Dash/geode/mods/
```
(adjust the path for your actual Wine prefix / CrossOver bottle / Steam library location.)

Launch GD, open the mod's settings (Geode in-game menu) and set:
- **Mode**: `live` for the overlay, `capture` while replaying a macro through xdBot to
  produce a `.telemetry.jsonl` for the analyzer.
- **Port**: leave at `8787` unless it conflicts with something else.
- **Capture directory**: where `<level>.telemetry.jsonl` gets written in capture mode.

With the mod running in `live` mode, go back to the renderer (step 1) and click
**connect tap** — it should replace the demo clock with the real in-game playhead.

⚠️ **The mod has not been verified against a real Geode build or a real GD install** — it
was written from the public Geode API and conforms to the tested wire protocol, but member
names may need small adjustments against whatever Geode SDK version you build with. Treat
first launch as a debug session, not a sure thing.

## Tests

```bash
node --test          # 35 unit tests across parsing, notes, clustering, geometry,
                     # playhead interpolation, telemetry, determinism, and the pipeline
PW_PATH=$(npm root -g)/playwright node scripts/smoke.mjs   # headless renderer smoke
```

---

## Layout

```
shared/      protocol constants (incl. the ONE global offset, §6.3), GDR/GDR2(binary)/gdph
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
