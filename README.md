# Gameval

Gameval is a small, inspectable benchmark harness for running iterative game-like coding evaluations against LLMs. The current benchmark is **Arena War**, a JavaScript territory-capture game that measures how well a model improves an algorithm after repeated competitive feedback.

This repository is intended to be useful from a fresh public clone: install dependencies, serve the dashboard, inspect the bundled sample run, then optionally add provider API keys and run your own evals.

## Quick start

```bash
git clone https://github.com/dicefuji/gameval.git
cd gameval
npm install
npm run check
npm run serve
```

Node.js 20 or newer is recommended (`.nvmrc` is provided).

Open:

- `http://localhost:3000/results.html` — benchmark dashboard
- `http://localhost:3000/arena.html` — interactive sandbox / replay surface

No API keys are required to view the dashboard or sandbox. A bundled `sample-eval-results.json` file loads automatically when no local `eval-results.json` exists.

To run live model evaluations, copy `.env.example`, export the relevant keys, and run the eval CLI:

```bash
cp .env.example .env
# Add ANTHROPIC_API_KEY and/or OPENAI_API_KEY, then export them in your shell.

npm run eval -- \
  --model claude-opus-4-7@anthropic \
  --model gpt-5.5-2026-04-23@openai \
  --iterations 6 \
  --games-per-iter 25 \
  --seed 424242 \
  --reasoning-effort high
```

The runner writes `eval-results.json` in the repo root. That file is gitignored and takes precedence over the bundled sample when the dashboard loads.

---

Arena War is an iterative coding benchmark for comparing recent models on the same adversarial task. Each model receives one starting prompt, writes a JavaScript territory-capture algorithm, gets tested headlessly against a shared set of opponents, sees the reward signals from that round, and then tries again. The result is a live, inspectable learning curve that shows which models improve fastest and which models finish strongest.

The core story is not a single model solving a fixed puzzle. The core story is: run the same protocol across multiple models, let each one iterate for 5-6 rounds or until it plateaus, then compare how they actually perform on the Arena War eval.

---

## Product Goal

The goal of this project is to make it obvious how the newest models perform on a game-like coding eval:

- which model produces the strongest first algorithm
- which model improves fastest after feedback
- which model reaches the highest final territory share
- what each iteration's algorithm actually looked like
- how the strongest models should be replayed against each other after the benchmark is complete

The primary benchmark is **per-model comparison under the same protocol**. Direct head-to-head model-vs-model matches are a follow-on layer built on top of those benchmark results.

---

## The Benchmark Loop

Each model goes through the same loop:

1. Start with one prompt that explains Arena War and the function signature.
2. The model returns a JavaScript algorithm.
3. The eval runner tests that algorithm in several headless games against the same shared baseline opponents.
4. The results dashboard shows the scores, learning curve, representative board state, and generated source code.
5. The next prompt feeds reward signals back to the model: leaderboard position, current best code, and recent game history.
6. Repeat for roughly 5-6 iterations, or stop early once improvement has saturated.

The output is not just a final score. It is a trace of how a model adapts under repeated competitive pressure. The benchmark's valid claim is intentionally narrow: it measures iterative spatial algorithm improvement in this task, not general software engineering ability.

---

## Game Rules and Outcome Modes

Arena War is a 4-player territorial expansion game on a circular grid. The default grid size is 60×60 (~2724 in-play cells); the arena sandbox also offers 40×40 (~1184 cells) and 80×80 (~4872 cells). Each tick, every player's algorithm returns a *frontier* of up to `max(1, floor(N/8))` candidate cells (7 cells/tick at N=60, 5 at N=40, 10 at N=80); the engine enforces claim limits, resolves conflicts (two players requesting the same cell on the same tick leave it unclaimed), and scores territory as `score[i] / totalCells`.

Every game ends in exactly one of three modes, recorded as `terminationReason` in the output JSON (`schemaVersion ≥ 7`):

- **`board_full`** — the "clean win" case. Every reachable in-circle cell has been claimed. Territories sum to ~100%. The winner filled more of the board than the other players before it filled.
- **`stalemate`** — the "no-progress" case. No player claimed any cell this tick — every algorithm either ran out of legal frontier, proposed only already-owned cells, or every proposed cell conflicted with another player. **Visible unclaimed territory remaining is expected and legitimate**, not a display bug. In adversarial play this is the informative case: it signals the strategies have reached a mutually-blocking equilibrium. The winner is the player with the largest territory at arrest-time, even if that's 21% of the full board.
- **`max_ticks`** — a runaway safety cap (`size × size` ticks). Under normal play, games terminate via `board_full` or `stalemate` well before this. Hitting `max_ticks` in production data is a livelock-bug signal to investigate, not a game outcome.

Territory % alone cannot distinguish a 21% `board_full` from a 21% `stalemate` from a 21% `max_ticks`. The joint distribution of `(terminationReason, pct, ticks)` is the real signal. The dashboard surfaces this per iteration in the Inspect-a-model-run panel.

Full spec — claim resolution in detail, stalemate cause taxonomy, implications for LLM scoring — in [`benchmark-methodology.md` §9](benchmark-methodology.md#part-9-arena-war-game-rules-and-outcome-modes).

---

## Reward Signals

The runner feeds structured feedback back into later rounds instead of asking the model to restart from scratch every time. The key reward signals are:

- average territory percentage across the evaluation games for that iteration
- recent leaderboard standing inside the current model's run
- the current winning algorithm source code
- recent game history, including territory share and tick count
- plateau detection, which decides when more rounds are no longer meaningfully improving the score

This is why Arena War is an iterative eval rather than a one-shot benchmark.

---

## What Users Should See

There are two frontend surfaces:

- `results.html` is the main product surface. It should answer: who improved fastest, who finished best, what code did they write, and what did their boards look like?
- `arena.html` is the sandbox and replay surface. It is useful for manual inspection, live playback ideas, and future best-vs-best comparisons.

The benchmark-first workflow is:

1. run the iterative eval for multiple models
2. write the structured results to `eval-results.json`
3. open `results.html`
4. compare learning curves, inspect iteration outputs, and review representative boards
5. only then move into best-vs-best replays in the arena

---

## Project Structure

```
.
├── AGENTS.md                   — persistent repo notes for future agent sessions
├── CONTRIBUTING.md             — public contribution and benchmark-discipline guide
├── LICENSE                     — MIT license
├── SECURITY.md                 — generated-code and secrets safety policy
├── algorithms.js               — built-in baseline strategies
├── arena.html                  — interactive sandbox arena
├── engine.js                   — browser game engine
├── eval-runner.js              — headless multi-model eval harness
├── games/                      — early multi-game interface and Arena War registration
├── package.json
├── prompts.js                  — prompt templates and iterative feedback wording
├── registry.js                 — shared model algorithm registry (browser)
├── results.html                — results dashboard shell
├── results.js                  — results dashboard logic
├── sample-eval-results.json    — bundled sample run so fresh clones render
├── scripts/check.mjs           — syntax and sample-data validation used by npm run check
├── styles.css                  — shared design tokens + base chrome (both pages)
├── ui.js                       — sandbox UI controller
├── eval-results.json           — local eval output written by the runner (gitignored)
└── README.md
```

---

## File Guide

### `eval-runner.js`
Runs the actual benchmark loop. It is responsible for:

1. prompting one or more models
2. extracting algorithm functions from model output
3. testing each iteration headlessly
4. recording reward signals and learning curves
5. stopping when the run hits the iteration cap or plateaus
6. annotating each iteration with a `failureFlags` array covering syntax errors, runtime crashes, timeouts, out-of-bounds exploits, regressions, and plateau stalls
7. writing a comparison-friendly `eval-results.json` tagged with `evalVersion`, `changelog`, and `schemaVersion` (currently `7`)
8. recording a `terminationReason` on every per-game entry (`'board_full' | 'stalemate' | 'max_ticks'`) so downstream consumers can distinguish clean wins from no-progress stalemates

Key CLI flags worth knowing:
- `--model name[@provider]` (repeatable): models to benchmark. Append `@openai` or `@anthropic` to pin the provider for a single model.
- `--mode self-play|adversarial`: learning mode. Adversarial exposes anonymized top-2 opponent source code from other models after round 1.
- `--seed <n>`: top-level run seed for bit-for-bit reproducibility. Per-game seeds are derived deterministically from this.
- `--reasoning-effort <low|medium|high|xhigh>`: sets the `reasoning_effort` parameter on OpenAI reasoning-family calls (gpt-5, o1, o3, o4). Token floor scales with effort (32k for high, 64k for xhigh). Ignored for Anthropic and for non-reasoning OpenAI models. Recorded as `protocol.reasoningEffort` in the output.
- `--plateau-mode ci_overlap|fixed_threshold`: early-stop rule. `ci_overlap` requires an iteration's CI95 low to clear best-so-far's CI95 high (default).

Run `node eval-runner.js --help` for the full flag list.

### `prompts.js`
Defines the first-round prompt and the iterative prompt. Later prompts reuse the current leader, leaderboard, and recent game history so that models can improve based on what they learned.

### `results.html` and `results.js`
Read `eval-results.json` and present the benchmark as a comparison product. Phase 9C ordered the page so the first screen is the high-trust material: a hero learning-curve panel (Figure 1) with an optional dashed held-out-reference anchor, a compact Rank/Model/Best/Iter/Replay leaderboard with a filter strip (All / Frontier / Cheap / Mid-tier) and per-row expand disclosures, and a promoted Held-Out Reference Benchmark panel summarizing how many models significantly lose to the reference. Below the hero live the shared protocol strip, benchmark summary, relative comparison verdicts, a Pairwise Comparisons panel (Phase 10; one bootstrap card per `pairwiseComparisons[]` entry showing Δ, 95% CI, sample sizes, and verdict — auto-hidden when the key is absent), a real Head-to-Head Matrix (Phase 10; (N+1)×(N+1) grid consuming `headToHead.pairs[]` with row/column model headers, a `row vs col` corner legend, and per-cell `rowWins–colWins (draws)` + `Δ% · CI` tinted green/orange/muted by significance), a per-model Failure Taxonomy panel (bar rows per flag with a one-sentence summary), and an "Inspect a model run" detail grid whose Live Replay canvas now runs the selected iteration's model code in a looped inline arena instead of showing a static snapshot. The page header carries a version badge whose hover tooltip surfaces the full eval changelog.

### `arena.html`, `engine.js`, and `ui.js`
Provide the manual arena sandbox. This is where algorithms can be watched and inspected directly, and where best-vs-best replay modes can later live. The arena's "Load algorithm into seat 0" picker is populated by `registry.js` so every baseline and every model × iteration from the latest eval output can be dropped into the sandbox in one click. Phase 9B redesigned the page around a two-pane canvas/controls layout, shared design tokens, and a light/dark theme toggle matching `results.html`; the paste-your-own-algorithm flow lives behind an `Advanced: paste a custom algorithm` disclosure at the bottom of the page so no placeholder code is visible on first load.

### `algorithms.js`
Contains the shared baseline opponents used by the benchmark. These are the fixed strategies that keep the comparison fair across models.

### `registry.js`
Shared data layer loaded by both `results.html` and `arena.html`. Exposes `window.ArenaRegistry` with `load()`, `getBaselines()`, `getModelEntries()`, `findEntry(id)`, and `compile(entry)`. On boot it tries `eval-results.json` first and falls back to `sample-eval-results.json`, so a fresh clone without a local run still renders a populated dashboard and a populated arena picker. Model entries are compiled lazily via `new Function(...)` with markdown fences stripped, and the compiled function is memoized on the entry.

### `sample-eval-results.json`
Bundled eval output that ships with the repo. Tracked via an `!` override in `.gitignore`. Used only as a fallback when there is no live `eval-results.json`; a local run overwrites the view on disk (`eval-results.json` takes precedence in the loader).

### `styles.css`
Shared stylesheet loaded by both `arena.html` and `results.html` ahead of each page's own `<style>` block. Carries the design tokens (both dark and light themes), base resets, the `#root` container, the top-nav `.page-links` (with active state), the `.theme-toggle`, and the `.panel-title` primitive. Page-specific typography that intentionally differs (`h1` size, `.subhead` width, `.page-header` margin) stays inline on each page.

---

## Game Rules

- The arena is a circle divided into a `SIZE × SIZE` pixel grid.
- Each player starts with a small seed patch placed evenly around the circle.
- On each tick, an algorithm returns a prioritized list of `[row, col]` cells it wants to claim.
- A cell can only be claimed if it is `EMPTY` (`-1`) and adjacent in 4 directions to territory the player already owns.
- Algorithms cannot claim through enemy territory.
- If two players claim the same cell on the same tick, that cell stays empty.
- Each player may claim up to `floor(SIZE / 8)` cells per tick.
- The game ends when no empty cells remain or nobody makes progress.

---

## Comparison Modes

### Primary Mode: Shared-Protocol Benchmark

Every model runs through the same iterative loop against the same shared baselines. This is the main benchmark because it gives a fair, comparable learning curve for each model.

### Follow-On Mode: Best-vs-Best Replay

After the benchmark is complete, the strongest iterations from the top models can be replayed against each other in the arena. This is useful for intuition and storytelling, but it is downstream of the core benchmark rather than a replacement for it.

---

## Current Direction

The implementation is moving in this order:

1. benchmark-first README and project framing
2. multi-model eval output designed for dashboard consumption
3. results dashboard as the main frontend
4. arena-based replay and best-vs-best follow-up
5. robustness hardening such as safer execution and time limits

---

## Common commands

```bash
# Install dependencies
npm install

# Run syntax/sample/provider smoke checks
npm run check

# Serve the static frontend
npm run serve

# Open the main results surface
# http://localhost:3000/results.html

# Open the arena sandbox
# http://localhost:3000/arena.html

# Run a quick local benchmark (requires ANTHROPIC_API_KEY)
export ANTHROPIC_API_KEY=...
npm run eval:quick

# Run a multi-model comparison
npm run eval -- --model claude-sonnet-4-20250514 --model gpt-4o

# Mixed-provider run (per-model provider via @provider)
npm run eval -- --model claude-sonnet-4-5-20250929@anthropic --model gpt-4o@openai --model gpt-4.1-mini@openai

# Frontier comparison with high reasoning effort on the OpenAI side
npm run eval -- --model claude-opus-4-7@anthropic --model gpt-5.5-2026-04-23@openai --reasoning-effort high --seed 424242
```

The runner writes `eval-results.json` in the repo root. Reload `results.html` after a run to inspect the output. If you haven't run the eval yet, both pages fall back to `sample-eval-results.json` so you still see a working dashboard and a populated arena picker.

When reading the dashboard, treat a "good" result primarily as a relative one: stronger finishing performance and/or faster improvement than peer models under the same protocol. The page should make that clear without requiring a deep read of the methodology document.

## Public repo notes

- `eval-results.json`, `.env`, logs, and `.devin-*.json` local artifacts are ignored by git.
- Commit `sample-eval-results.json` only when intentionally updating the public demo dataset.
- Use `CONTRIBUTING.md` for PR expectations and benchmark-claim discipline.
- Use `docs/roadmap.md` for the public roadmap; old internal orchestration notes are intentionally not part of the public repo surface.

---

## Notes For Future Work

- Direct best-vs-best model matches should be built on top of the benchmark results rather than replacing the benchmark.
- The extraction path in `eval-runner.js` still needs ongoing hardening for messy model outputs.
- The browser engine and the Node runner still duplicate game logic today, so they should stay aligned whenever rules change.