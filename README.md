# gameval

# Arena War — LLM Coding Eval

A spatial territory-capture eval that measures LLM coding capability under adversarial, iterative pressure. Models write JavaScript algorithms that compete to claim pixels in a circular arena. The eval loop feeds each model the current winning algorithm and asks it to do better — measuring how quickly and how well models improve under competition.

---

## What This Evaluates

Standard coding evals ask a model to solve a fixed problem. Arena War is different: the target moves. Each iteration, the model sees what the current best algorithm does and must reason about its weaknesses, then write code that exploits them. This tests:

- **Spatial reasoning** — understanding how territory shapes affect expansion strategy
- **Adversarial thinking** — recognizing and exploiting opponent strategies
- **Iterative improvement** — does the model actually get better with feedback, and how fast?
- **Code quality** — does the generated algorithm run correctly, efficiently, and within constraints?

The output is a learning curve per model — not just a pass/fail score — which is a richer capability signal than single-shot evals.

---

## Project Structure

```
arena-war/
├── arena.html          — browser frontend (visual arena + live stats)
├── algorithms.js       — built-in baseline algorithms (8 strategies)
├── engine.js           — core game engine (grid, tick logic, scoring)
├── ui.js               — UI controller (canvas rendering, controls, injection)
├── prompts.js          — prompt templates for the eval loop
├── eval-runner.js      — Node.js headless eval harness
├── package.json
├── eval-results.json   — written by eval-runner after each run
└── README.md
```

---

## File Descriptions

### `arena.html`
The browser-based live frontend. Open this in any browser to watch games play out in real time. Contains:
- Circular pixel grid rendered on a `<canvas>`
- Variable player count (2–6) and grid size (40/60/80)
- Speed control (1–20 ticks/sec)
- Territory % bars updating live each tick
- Iteration history log
- **Algorithm injection panel** — paste any model-generated JS function directly into a player slot and watch it compete live

No build step required. Open directly or serve with `npm run serve`.

### `algorithms.js`
The registry of built-in baseline algorithms. Each algorithm is a named JS function:

```js
function myAlgo(id, grid, size) {
  const EMPTY = -1;
  // ... strategy logic
  return [[row1, col1], [row2, col2], ...]; // prioritized claim list
}
```

The 8 included baselines range from naive BFS to density-weighted and centroid-aware strategies. These serve as the competitive baseline pool that model-generated algorithms must beat.

**This is also where model-generated algorithms are stored between eval runs.** When a model produces a winning algorithm, it gets added here so future iterations compete against it.

### `engine.js`
The game engine. Manages:
- Circular mask generation (only pixels inside the circle are valid)
- Grid initialization with evenly-spaced starting seeds
- Per-tick claim resolution, including conflict detection (two players want the same cell → nobody gets it)
- Win/termination detection
- `replaceAlgorithm(slot, fn)` — hot-swap an algorithm mid-session

The engine passes a **copy** of the grid to each algorithm per tick, so algorithms cannot modify shared state.

### `ui.js`
Wires the engine to the browser DOM. Handles:
- Canvas rendering (pixel grid at up to 10px per cell)
- Live territory stats panel
- Start/Pause/Reset controls
- Speed slider
- Iteration history log
- Safe `eval`-based injection of model-generated code from the textarea

### `prompts.js`
The prompt templates used by the eval runner. Two modes:
- `BASELINE_PROMPT` — first iteration, model writes from scratch
- `buildIterativePrompt({...})` — subsequent iterations, model sees the leaderboard, the winning algorithm's source code, and recent game history

The prompts include the full game rules, function signature, constraints, and strategic hints. They are designed to elicit code-only responses (no markdown, no explanation).

### `eval-runner.js`
The headless Node.js eval harness. This is the core of the eval system. It:
1. Calls the Anthropic API with the current prompt
2. Extracts the returned JS function from the model's response
3. Runs N headless games (no browser, pure JS) with the model's algorithm as player 0 and baselines filling the remaining slots
4. Records scores, tick counts, and win rates
5. Updates the leaderboard and selects the new winner for the next iteration
6. Repeats for `--iterations` rounds
7. Writes `eval-results.json` with the full run history

---

## Game Rules

- The arena is a circle divided into a SIZE×SIZE pixel grid (default 60×60)
- Each player starts with a small seed patch, evenly distributed around the circle
- Each tick, an algorithm returns a prioritized list of `[row, col]` cells it wants to claim
- A cell can only be claimed if it is `EMPTY` (-1) and **adjacent (4-directional) to a cell the player already owns**
- Players **cannot claim through enemy territory** — if fully enclosed, they are confined to that boundary
- If two players claim the same cell in the same tick, the cell stays `EMPTY` (contested)
- Each player may claim up to `floor(SIZE / 8)` cells per tick
- The game ends when no empty cells remain or no player makes progress

---

## The Eval Loop

```
Iteration 1:
  → Send BASELINE_PROMPT to model
  → Model returns algorithm JS function
  → Run 5 games: model vs. 3 baseline algos
  → Record avg territory %

Iteration 2+:
  → Send ITERATIVE_PROMPT with leaderboard + winning algo source
  → Model analyzes weakness, returns improved algorithm
  → Run 5 games: new model algo vs. baselines (+ previous best model algo)
  → Record improvement delta

Repeat for N iterations.
Output: learning curve (% territory per iteration)
```

The key metric is **improvement rate** — how many iterations does it take for a model to meaningfully beat the baseline, and how much does it improve per iteration?

---

## Implementation Plan (for Claude Code)

The frontend is complete and working. The following work remains:

### Phase 1 — Wire up eval-runner.js (priority)

1. `npm install` in the repo root
2. Verify `eval-runner.js` correctly loads `algorithms.js` in Node context (the current `loadBaselineAlgos()` uses a fragile eval — replace with a clean CommonJS export from `algorithms.js`)
3. Add `module.exports = { ALGOS, ALGO_NAMES }` to `algorithms.js`
4. Update `eval-runner.js` to `const { ALGOS, ALGO_NAMES } = require('./algorithms')`
5. Test with `npm run eval:quick` (3 iterations, 3 games each)

### Phase 2 — Multi-model comparison

Extend `eval-runner.js` to accept multiple `--model` flags and run the full eval loop for each model in sequence. Write results per-model to `eval-results.json` under a keyed structure:

```json
{
  "claude-sonnet-4-20250514": { "iterations": [...] },
  "gpt-4o": { "iterations": [...] }
}
```

### Phase 3 — Results visualization

Add `src/results.html` — a second browser page that reads `eval-results.json` and renders:
- Learning curve chart (territory % per iteration, one line per model)
- Algorithm source code viewer per iteration
- Head-to-head comparison: model A's best algo vs. model B's best algo, played live in the arena

### Phase 4 — Algorithm persistence

After each eval run, append the best model-generated algorithm to `algorithms.js` so future runs compete against past best. This creates a true "arms race" environment across multiple eval sessions.

### Phase 5 — Robustness hardening

- Add a sandboxed worker for algorithm execution (prevent infinite loops or DOM access)
- Add timeout enforcement (50ms per tick per algorithm)
- Add input validation on the grid copy passed to algorithms
- Consider running games in a Worker thread to avoid blocking the event loop

### Phase 6 — Extended eval dimensions

Beyond territory %, consider tracking:
- **Encirclement events** — how often does the model's algo successfully trap an opponent?
- **Early-game speed** (territory at tick 10) vs. **late-game efficiency** (territory at termination)
- **Consistency** — variance across games (high variance = brittle strategy)
- **Prompt sensitivity** — does the model improve more with strategic hints or just code feedback?

---

## Quick Start

```bash
# Install deps
npm install

# Open frontend in browser
npm run serve
# → open http://localhost:3000/arena.html

# Run eval (requires ANTHROPIC_API_KEY)
export ANTHROPIC_API_KEY=sk-...
npm run eval:quick

# Full eval
npm run eval:full
```

---

## Notes for Agent

- The frontend (`arena.html` + its three JS files) works as-is — open it in a browser to verify
- The main work is in `eval-runner.js` — specifically Phase 1 above
- The `prompts.js` templates are ready but may need tuning based on what model output actually looks like
- The `extractFunction` utility in `eval-runner.js` is fragile for edge cases — improving it is a good early task
- All game logic is duplicated between `engine.js` (browser) and `eval-runner.js` (Node) intentionally — consider extracting a shared `game-core.js` that works in both environments