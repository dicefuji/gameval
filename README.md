# gameval

# Arena War — Model Comparison Eval

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

That loop measures both raw coding ability and iterative learning ability. The output is not just a final score. It is a trace of how a model adapts under repeated competitive pressure.

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
├── AGENTS.md           — persistent repo notes for future agent sessions
├── algorithms.js       — built-in baseline strategies
├── arena.html          — interactive sandbox arena
├── engine.js           — browser game engine
├── eval-runner.js      — headless multi-model eval harness
├── package.json
├── prompts.js          — prompt templates and iterative feedback wording
├── results.html        — results dashboard shell
├── results.js          — results dashboard logic
├── ui.js               — sandbox UI controller
├── eval-results.json   — local eval output written by the runner
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
7. writing a comparison-friendly `eval-results.json` tagged with `evalVersion`, `changelog`, and `schemaVersion` (currently `3`)

### `prompts.js`
Defines the first-round prompt and the iterative prompt. Later prompts reuse the current leader, leaderboard, and recent game history so that models can improve based on what they learned.

### `results.html` and `results.js`
Read `eval-results.json` and present the benchmark as a comparison product: learning curves, protocol/trust metadata, relative comparison verdicts, per-iteration inspection, representative board snapshots, final model rankings, a per-model Failure Taxonomy panel (bar rows per flag with a one-sentence summary), and a page-header version badge whose hover tooltip shows the full eval changelog.

### `arena.html`, `engine.js`, and `ui.js`
Provide the manual arena sandbox. This is where algorithms can be watched and inspected directly, and where best-vs-best replay modes can later live.

### `algorithms.js`
Contains the shared baseline opponents used by the benchmark. These are the fixed strategies that keep the comparison fair across models.

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

## Quick Start

```bash
# Install dependencies
npm install

# Serve the static frontend
npm run serve

# Open the main results surface
# http://localhost:3000/results.html

# Open the arena sandbox
# http://localhost:3000/arena.html

# Run a quick local benchmark (requires ANTHROPIC_API_KEY)
export ANTHROPIC_API_KEY=sk-...
npm run eval:quick

# Run a multi-model comparison
npm run eval -- --model claude-sonnet-4-20250514 --model gpt-4o
```

The runner writes `eval-results.json` in the repo root. Reload `results.html` after a run to inspect the output.

When reading the dashboard, treat a "good" result primarily as a relative one: stronger finishing performance and/or faster improvement than peer models under the same protocol. The page should make that clear without requiring a deep read of the methodology document.

---

## Notes For Future Work

- Direct best-vs-best model matches should be built on top of the benchmark results rather than replacing the benchmark.
- The extraction path in `eval-runner.js` still needs ongoing hardening for messy model outputs.
- The browser engine and the Node runner still duplicate game logic today, so they should stay aligned whenever rules change.