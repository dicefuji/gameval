# Agent Notes

## Start Here
- On a fresh context, read this file first, then `README.md`, then `benchmark-methodology.md`, then the inline comments in the root JS files.
- The authoritative code layout is the repo root. There is no `src/` directory in the current project structure.
- Update this file after any important architecture, methodology, workflow, or setup change.
- Treat this file as the handoff doc for the next agent: it should explain what the benchmark claims, how the current implementation works, what is still weak, and how to continue safely.

## Valid Benchmark Claim
- Arena War should make a narrow, defensible claim:
  "This benchmark measures a model's ability to iteratively improve a spatial territory algorithm through adversarial competition feedback."
- Do not overclaim general coding ability, general reasoning, or broad software engineering ability from this benchmark alone.
- The methodology doc is explicit that construct validity matters more than leaderboard theater.
- Two modes now exist with distinct scientific claims:
  - **Self-play mode**: Measures a model's ability to improve from its own generated feedback loop (closed-system optimization).
  - **Adversarial mode**: Measures a model's ability to analyze and exploit opponent algorithms written by OTHER models (open-system competitive adaptation). This tests cross-model generalization and opponent modeling, not just self-improvement.

## Product Direction
- The primary product story is benchmark-first: compare multiple models on the same iterative Arena War protocol, then inspect the results in the dashboard.
- The main user-facing question is not "who got the highest single score once?" It is "who improved fastest and who finished strongest under the same protocol?"
- Best-vs-best model replays in the arena are a follow-on layer after the benchmark result is understood.
- The results dashboard should explain what a "good result" means without forcing the user to read the methodology doc.
- In the dashboard, "good" is primarily relative: stronger final performance, faster improvement, or both under the same shared run configuration.

## Methodology Commitments
- `benchmark-methodology.md` is the foundation for rigor. The current implementation only partially satisfies it.
- Core methodology principles the next agent should preserve:
  - Learning curve is the primary signal, not a single final score.
  - Use a multi-metric view: primary outcome, efficiency, consistency, improvement rate, and failure modes.
  - Preserve contamination resistance and adversarial pressure by keeping the task generative and iterative.
  - Show protocol and trust metadata prominently.
  - Avoid overclaiming; explicitly state what the benchmark does and does not measure.
- High-priority methodology gaps still open:
  - Run `N >= 5` games per model per iteration for credible variance estimates.
  - Add mean ± spread / CI rather than only point estimates.
  - Add reproducible seeding and expose it.
  - Add variance/consistency reporting.
  - Add failure taxonomy reporting.
  - Add versioning/changelog semantics for the eval itself.
  - Consider Elo or another opponent-aware rating system instead of relying on territory % alone.

## Multi-Game Architecture (Phase 6)
- `games/game-interface.js`
  - Defines the `GameEngine` base class that all benchmark games must implement.
  - Interface methods:
    - `step()` — run one tick, return `{ done, state }`
    - `getResult()` — return `{ scores, metrics }`
    - `getRulesDescription()` — markdown rules string for LLM prompts
    - `getBaselinePrompt()` — first-iteration prompt (no history)
    - `getIterativePrompt(context)` — later-round prompt with history/leaderboard
    - `validateAlgorithm(fn)` — check if an algorithm function is acceptable
    - `getDefaultConfig()` — return default game configuration object
    - `getName()` — return game identifier string
  - Future games must extend `GameEngine` and export a registration object from `games/<game-name>/index.js`.
- `games/arena-war/`
  - The first registered game, implementing the `GameEngine` interface.
  - Files:
    - `engine.js` — `ArenaWarEngine extends GameEngine`, adapted from root `engine.js`
    - `algorithms.js` — built-in baseline strategies (copied from root)
    - `prompts.js` — prompt templates with added interface wrappers
    - `index.js` — game registration object exporting `name`, `GameEngine`, `ALGOS`, `ALGO_NAMES`, and `prompts`
- The root `engine.js`, `algorithms.js`, and `prompts.js` remain the primary working copies.
  - `games/arena-war/` is the foundation for future pluggability.
  - The eval-runner and arena still use root copies directly; full delegation is a future step.
- `eval-runner.js`
  - Added `loadGame(gameName)` and `--game <name>` CLI flag.
  - Default game is `arena-war`.
  - Stores `protocol.game` in `eval-results.json` for future multi-game comparison support.
- `arena.html`
  - Added a `<select>` game selector dropdown in the top bar (currently only "Arena War").
  - UI placeholder for future dynamic game loading.

## Current Architecture
- `eval-runner.js`
  - Source of truth for the benchmark loop.
  - Owns prompt -> generated algorithm -> extraction -> headless evaluation -> feedback -> plateau stop -> `eval-results.json`.
  - Supports repeated `--model` flags for multi-model comparisons.
  - Supports multiple LLM providers via `--provider anthropic|openai` (default: anthropic).
  - Supports two learning modes via `--mode self-play|adversarial` (default: self-play):
    - **Self-play**: Each model only sees its own prior iterations when building prompts.
    - **Adversarial**: After round 1, models also see anonymized top-2 opponent algorithms from OTHER models' runs as source code to beat.
  - Uses seeded randomness (`seededRandom`) to vary starting positions per game while keeping game rules and algorithm behavior deterministic.
  - Computes per-iteration statistics (mean, std, min/max, 95% CI) stored in each iteration result.
  - Emits a per-iteration `failureFlags` array with annotated failure codes (see Failure Taxonomy section below).
  - Writes top-level `evalVersion`, `changelog`, and `schemaVersion` on every `eval-results.json`; `schemaVersion` is currently `7`.
  - Records a `terminationReason` on every per-game entry (`games[*].terminationReason`): one of `'board_full'`, `'stalemate'`, or `'max_ticks'`. See **Game Rules and Outcome Modes** below. This is the data source for the dashboard's per-iteration "Game ended" / "Termination mix" meta rows and the arena banner's stalemate-vs-board-full disambiguation.
  - Supports `--reasoning-effort <low|medium|high|xhigh>` to set OpenAI `reasoning_effort` on gpt-5/o1/o3/o4-family calls. Recorded as `protocol.reasoningEffort` (null when unset). Ignored for Anthropic and for non-reasoning OpenAI models.
  - Supports per-model provider pinning via `--model name@provider` syntax (e.g. `--model gpt-4o@openai --model claude-sonnet-4-5-20250929@anthropic`) for mixed-provider runs in a single invocation; models without `@` fall back to `--provider`. Per-model provider is written to `models[<name>].provider` in the output.
  - Supports reproducible runs via `--seed <n>` top-level run seed; per-game seeds are deterministically derived from `(runSeed, modelIndex, iter, gameIndex)` and dumped into `protocol.perGameSeeds` for bit-for-bit replay.
  - Produces Track B rigor fields: bootstrap pairwise CIs, Bradley-Terry opponent-aware ratings, real best-vs-best head-to-head matrix, CI-overlap plateau detection, and held-out reference algorithm benchmark.
  - Current output schema is comparison-oriented and includes protocol metadata, model summaries, per-iteration details, prompt feedback, representative board snapshots, and failure annotations.
- `providers.js`
  - Unified provider interface supporting Anthropic and OpenAI.
  - Exports `callModel(provider, model, prompt, maxTokens, options?)` which returns `{ text, usage, latency }`. `options.reasoningEffort` is forwarded to OpenAI reasoning-family calls as `reasoning_effort`.
  - Also exports `validateReasoningEffort(effort)` (throws on unknown value) and `REASONING_EFFORT_LEVELS` (`low|medium|high|xhigh`).
- `prompts.js`
  - Defines the first-round prompt (`BASELINE_PROMPT`), iterative prompt (`buildIterativePrompt`), and adversarial prompt (`buildAdversarialPrompt`).
  - Iterative prompt feeds leaderboard, current winner code, and recent history back into later rounds.
  - Adversarial prompt adds an "OPPONENT ALGORITHMS TO BEAT" section with anonymized top-2 opponent source code (e.g., "Opponent A", "Opponent B").
- `results.html` and `results.js`
  - Main user-facing results surface.
  - Intended to show who improved fastest, who finished strongest, why the comparison is trustworthy, and what the selected iteration actually did.
  - Loads run data through `window.ArenaRegistry` (see `registry.js`) so a fresh clone without a local eval run still renders the bundled `sample-eval-results.json`. Legacy fetch path stays as a fallback when the registry is not loaded (e.g. running `results.html` as a plain file without the `<script src="registry.js">` tag).
  - Also loads `engine.js` so the inline mini-arena (Phase 9C) can run the registry-compiled model code live, not just render a static snapshot.
  - Phase 9C redesign hierarchy (first-screen surfaces first):
    1. Hero: Figure 1 learning-curves panel with an optional dashed held-out-reference anchor (drawn when `referenceBenchmark.entries[*].referenceMeanPct` is present).
    2. Compact Leaderboard (Rank / Model / Best / Iter / Replay) with a filter strip (`All / Frontier / Cheap / Mid-tier`) and a per-row `▸` disclosure that expands to show net improvement, improvement rate, latest score, successful iterations, stop reason, and tier. Tiering is a substring heuristic in `tierFor()` — unknown model names fall through to `frontier` so new models are visible by default.
    3. Held-Out Reference Benchmark panel with a one-line summary above per-model cards (Δ, 95% CI, wins, verdict tag). Hidden when no reference data is present.
    4. Shared Protocol strip, Benchmark Summary, Comparison Verdict, methodology + how-to-read cards.
    5. Pairwise Comparisons panel (Phase 10): one card per pair from `pairwiseComparisons[]` showing bootstrap Δ, 95% CI, sample sizes, and verdict (`a_better` / `b_better` / `tied`); panel auto-hides when the key is absent.
    6. Head-to-Head Matrix (Phase 10): (N+1)×(N+1) grid consuming `headToHead.pairs[]`. Row/column model-name headers with a `row vs col` corner legend; each data cell shows `rowWins–colWins (N draws)` tinted green/orange when `significant` is true and muted otherwise, plus a second-line `Δ X% · CI [L,H]`. Cells flip the stored pair's wins/delta when `pair.modelA === colModel` so the matrix reads symmetrically.
    7. Failure Taxonomy (unchanged from earlier phases).
    8. "Inspect a model run" toolbar + detail grid. The old static "Representative Board Snapshot" canvas is gone; its place is taken by a **Live Replay** mini arena that runs a real `ArenaEngine` game with the selected iteration's algorithm in seat 0 against the registry baselines, auto-looping between games. Pause/Play toggles the loop; "Open in full arena" links through to `arena.html?loadModel=...&loadIter=...`.
  - Currently includes:
    - "How to read this run"
    - methodology bridge
    - benchmark summary
    - comparison verdict
    - shared protocol strip
    - comparison table
    - learning curves
    - selected model / selected eval iteration inspection
    - generated code
    - representative board snapshot
    - follow-on best-vs-best replay candidates
- `arena.html`
  - Interactive sandbox and future replay surface.
  - Not the main benchmark surface.
  - Hosts a "Load algorithm into seat 0" combobox (Phase 9A) populated from `ArenaRegistry` — every baseline plus every model × iteration in the loaded eval output. The URL-params auto-load path (`?loadModel=...&loadIter=...`) also routes through the registry.
  - Phase 9B redesign: shares the same CSS custom-property design tokens as `results.html`; Phase 9D extracted those tokens + base resets + `.page-links` + `.theme-toggle` + `.panel-title` into a shared `styles.css` loaded by both pages. Includes a light/dark theme toggle with `localStorage`-backed preference. Layout is a two-pane grid at ≥1000px (canvas stage left, controls column right); canvas is the left pane, the right pane stacks `seat 0 algorithm` picker → `territory` → `players` → `game history`. The manual paste flow lives inside a collapsed `<details class="advanced">` disclosure at the bottom so the placeholder textarea does not sit under the canvas on first load.
- `engine.js`
  - Browser game engine.
  - Still duplicates logic that also exists in `eval-runner.js`.
- `ui.js`
  - Sandbox UI controller.
  - Uses `game history` terminology deliberately to avoid confusion with eval iterations.
  - Boot sequence: `init()` → `ArenaRegistry.load()` → `populateAlgoPicker()` → `maybeAutoLoadFromParams()`. Compile path for model-generated code is centralized in `ArenaRegistry.compile(entry)` (fence-strip + `new Function`); the manual-paste button still uses the local `compileAlgorithm` helper.
- `algorithms.js`
  - Shared built-in baseline strategies.
  - Exports `{ ALGOS, ALGO_NAMES }` for Node. In browsers these are top-level `const` bindings: `registry.js` must access them via bare name (not `window.*`).
- `registry.js` (Phase 9A)
  - Shared data layer imported by both `results.html` and `arena.html` ahead of each page's main script.
  - Exposes `window.ArenaRegistry` with `load()`, `getBaselines()`, `getModelEntries()`, `findEntry(id)`, `compile(entry)`, `getResults()`, `getSource()`, `getLoadError()`.
  - Load order tries `eval-results.json` first, falls back to `sample-eval-results.json`. Emits a `registry:loaded` CustomEvent on `window` when done.
  - Model entries are keyed `<model>@<iter>`; compiled functions are memoized on the entry so repeated selection is cheap.
- `sample-eval-results.json` (Phase 9A)
  - Bundled eval output that ships with the repo so fresh clones render the dashboard and populate the arena picker without first running `npm run eval`.
  - Tracked via an `!sample-eval-results.json` override in `.gitignore`; `eval-results.json` remains ignored.
- `package.json`
  - `npm run serve` uses `python3 -m http.server 3000`.
  - `npm run eval:quick` is a short smoke test.
  - `npm run eval -- --model ...` is the main comparison entrypoint.

## Current State Of The Frontend
- `results.html` should now answer, at a glance:
  - Which model did best?
  - Why should the comparison be trusted?
  - How should the user interpret the learning curves?
- The dashboard intentionally distinguishes:
  - global comparison verdicts
  - same-model feedback leaderboard/history inside a run
  - eval iteration vs sandbox game history
  - representative snapshot vs full run evidence
- The header carries a `version-badge` pill showing `evalVersion` with a hover tooltip surfacing the full `changelog`; `evalVersion` also shows in the Shared Protocol strip.
- The Failure Taxonomy section renders per-model bar rows for each annotated flag and writes a one-sentence natural-language summary per model. It falls back to an "older eval version" message when the loaded `eval-results.json` predates Phase 7.
- The arena (`arena.html`) surfaces real model-generated algorithms via the Phase 9A picker, not just hardcoded baselines.
- The arena received its Phase 9B visual redesign: two-pane canvas/controls layout, shared tokens + theme toggle matching `results.html`, and the manual-paste flow moved behind a `<details>` disclosure so no placeholder code is visible on first load.
- `results.html` received its Phase 9C visual redesign: hero learning curve with held-out-reference dashed anchor, compact Vending-Bench-style leaderboard with filter strip and per-row expand disclosure, promoted held-out reference panel with one-line summary, and a live inline mini-arena replay (using `ArenaEngine`) that replaces the static representative-snapshot canvas.
- `styles.css` (Phase 9D) now carries the shared design tokens (both themes), base resets, `#root` container, `.page-links` (including active state), `.theme-toggle`, and the `.panel-title` primitive. Both pages link it ahead of their page-specific `<style>` block. Typography that genuinely differs per page (`h1` size, `.subhead` width, `.page-header` margin) intentionally stays inline so the extraction is visual-regression-free.
- The frontend is still limited in a few areas:
  - Phase 8B `pairwiseComparisons[]` and `headToHead.pairs[]` now render via the Phase 10 panels above. The Bradley-Terry `ratings[]` table remains unrendered on the dashboard — re-landing it is the remaining Phase 8B surface.

## Current State Of The Runner
- Function extraction was fixed to support model-generated code that contains JavaScript template literals.
- A real smoke run succeeded after that extractor fix.
- Phase 2 (Two-Mode Adversarial Learning) is complete:
  - `self-play` and `adversarial` modes are both implemented.
  - Adversarial mode uses round-robin per iteration: all models complete iteration N before any model starts iteration N+1.
  - Opponent algorithms are anonymized ("Opponent A", "Opponent B") and only exposed after iteration 1.
  - Single-model adversarial requests gracefully degrade to self-play with a console warning.
- Phase 3 (Statistical Rigor Engine) is complete:
  - `seededRandom` LCG produces deterministic but varied starting positions per game.
  - `createGrid` varies seed radius (0.50-0.60 of base) and angular jitter per player based on the seed.
  - Per-iteration statistics (mean, std, min/max, 95% CI) are computed and stored in `iteration.stats`.
  - Summary `bestIteration` and `latestIteration` both include `stats`.
- Known runner caveats:
  - plateau logic exists, but the methodology wants stronger statistical interpretation around plateau and significance
  - full game logic is duplicated between browser and Node paths

## Failure Taxonomy (Phase 7)
- Every iteration result in `eval-results.json` carries a `failureFlags: string[]` array. Possible codes:
  - `SYNTAX_ERROR` — function extraction from model output failed; no games were run.
  - `RUNTIME_CRASH` — the algorithm threw during one or more game ticks.
  - `TIMEOUT` — a single tick call took longer than 50ms.
  - `EXPLOIT_DETECTED` — the algorithm tried to claim a cell outside the circular play mask.
  - `REGRESSION_VS_PRIOR` — iteration scored below its own previous successful iteration.
  - `REGRESSION_VS_BEST` — iteration scored below this model's best-so-far.
  - `STALE` — plateau streak hit the configured patience threshold.
- `RUNTIME_CRASH`, `TIMEOUT`, and `EXPLOIT_DETECTED` are detected inside `runGame()` via a `perPlayerFlags` set that is aggregated across all games in the iteration.
- The runner logs `⚠ Failure flags: ...` to stdout whenever a non-empty set is emitted.
- The dashboard consumes these flags through `renderFailureTaxonomy()` in `results.js`. Flag labels, colors, and blurbs live in `FAILURE_FLAG_META`; adjust them there when adding new flags.

## Benchmark Versioning (Phase 7)
- `EVAL_VERSION` (currently `arena-war-eval-v0.3.4`) and `CHANGELOG` live at the top of `eval-runner.js` and are written into both the top-level result object and `protocol.evalVersion`.
- When introducing any eval-behavior change that affects scores, bump `EVAL_VERSION` and prepend a one-line entry to `CHANGELOG`.
- When changing the shape of `eval-results.json`, bump `schemaVersion`. The frontend reads both `state.results.evalVersion` and `state.results.schemaVersion`.

## Game Rules and Outcome Modes
- Arena War is a 4-player territorial expansion game on a circular `N × N` grid (`DEFAULT_GRID_SIZE = 60`, ~2724 in-play cells; `arena.html` and `eval-runner.js` both default to 60). Each tick, every algorithm returns up to `max(1, floor(N/8))` candidate cells (`frontier`) — 7 cells/tick at the default; the engine resolves conflicts (same-tick collisions stay unclaimed) and applies non-conflicting claims.
- Every game ends in exactly one of three modes, surfaced as `terminationReason` on `games[*]` in `eval-results.json` (`schemaVersion >= 7`) and on the live engine `step()` return value (runtime only):
  - **`board_full`** — every reachable in-circle cell claimed. Territories sum to ~100%.
  - **`stalemate`** — no player claimed anything this tick. Visible unclaimed territory is *expected* and legitimate; the winner is the largest-territory player at arrest-time, even if that's 21% of the board.
  - **`max_ticks`** — runaway safety cap (`size * size` ticks) enforced by `eval-runner.js runGame()` only. Hitting it is a livelock-bug signal, not a game outcome. Browser `engine.js` does not enforce this cap.
- The browser engine (`engine.js`), the games/arena-war mirror (`games/arena-war/engine.js`), and the node eval harness (`eval-runner.js runGame()`) all emit `terminationReason`. When changing game rules or termination logic, update all three in lockstep.
- **Cache-busting on engine/UI changes.** `arena.html` and `results.html` reference `engine.js`, `ui.js`, and `results.js` with a `?v=<token>` query string (currently `?v=trv1`). Browsers aggressively cache these scripts, so users pulling a PR that changes engine rules or UI rendering will silently keep the old version unless the token is bumped. Rule: any PR that touches `engine.js`, `ui.js`, `results.js`, or `games/arena-war/engine.js` must bump the cache-bust token in both HTML files. Pick a short semantic suffix tied to the change (e.g., `trv1` = terminationReason v1, `mode1` = mode-row addition).
- The arena winner banner (`ui.js`) reads `result.terminationReason` and renders, e.g., `winner: X — 21% (stalemate at tick 145 — no player could make progress)` vs `winner: X — Y% (board full at tick N — every reachable cell claimed)`.
- The results dashboard (`results.js`) renders `formatTerminationReason(reason)` in the Inspect-a-model-run panel's meta rows: a per-representative-game `Game ended: ...` line and a per-iteration `Termination mix: 3× board_full · 2× stalemate` aggregate.
- Full spec and stalemate-cause taxonomy in [`benchmark-methodology.md` §9](benchmark-methodology.md#part-9-arena-war-game-rules-and-outcome-modes). User-facing summary in [`README.md` §"Game Rules and Outcome Modes"](README.md#game-rules-and-outcome-modes).

## Known Gaps And Next Priorities
- Phase 3 addressed: controlled variance (seeded randomness), consistency/spread reporting, and `N >= 5` default are all implemented.
- Phase 7 addressed: failure taxonomy fields, eval versioning, and changelog metadata are all implemented in both runner and dashboard.
- The most important rigor gaps still open (tracked as Phase 8 below):
  1. Consider held-out reference algorithms and Elo-style rating.
  2. Stronger statistical interpretation around plateau detection (compare CI overlap rather than fixed thresholds).
  3. Full delegation of `eval-runner.js` to `games/<name>/index.js` so the root `engine.js` / `algorithms.js` / `prompts.js` copies can be retired.
- Phase 10 addressed: head-to-head matrix and pairwise comparisons panel now render `headToHead.pairs[]` and `pairwiseComparisons[]` respectively; both include CIs and significance tints.
- The most important UX gaps still open:
  1. Surface the Bradley-Terry `ratings[]` table (last remaining Phase 8B dashboard surface).
  2. Further surface consistency/uncertainty alongside the CI bands on the learning curve.
  3. Provide a more seamless path from "best-vs-best candidate" to actual arena replay.

## Phase 8 Backlog (post-Phase-7)
- **Elo / opponent-aware rating**: replace or supplement `avgPct` with a rating that accounts for which opponents each algorithm actually beat. Needed before any cross-run leaderboard claim.
- **Held-out reference algorithms**: a small frozen set of strong-but-fixed algorithms that are never shared with models, used to produce a stable anchor across eval versions.
- **CI-overlap plateau detection**: declare a plateau only when the current iteration's CI95 overlaps the running best's CI95, instead of the current fixed-gain rule. Store the plateau rationale in the iteration result.
- **Head-to-head matrix**: run each model's best iteration against every other model's best iteration in a round-robin and populate the matrix panel.
- **Multi-game delegation**: make `eval-runner.js` fully load the engine/algorithms/prompts from `games/<name>/index.js` instead of the root files, and remove the duplicated root copies.
- **Schema changelog discipline**: any change to `eval-results.json` shape must bump `schemaVersion` and prepend an entry to `CHANGELOG`.

## Setup And Validation
- Install dependencies with `npm install`.
- Start the local frontend with `npm run serve`.
- Open:
  - `http://localhost:3000/results.html` for the main dashboard
  - `http://localhost:3000/arena.html` for the sandbox
- Run evals with:
  - `npm run eval:quick`
  - `npm run eval -- --model claude-sonnet-4-20250514 --model gpt-4o`
  - `npm run eval -- --provider openai --model gpt-4o`
  - `npm run eval -- --mode adversarial --model claude-sonnet-4-20250514 --model gpt-4o`
- API keys required before running the eval harness:
  - `ANTHROPIC_API_KEY` for anthropic provider (default)
  - `OPENAI_API_KEY` for openai provider
- `eval-results.json` is written locally and ignored by git.
- Run `node test-providers.js` to verify the provider backend loads without making API calls.

## Interpretation Rules
- Prefer shared-protocol comparison over isolated single-run impressions.
- Treat the learning curve as primary evidence.
- Treat a representative board snapshot as illustration, not proof by itself.
- Do not present raw territory % as the only or final truth.
- If two models are close and variance is missing, avoid strong claims.

## Git And Environment Notes
- The repo currently has local commits beyond `origin/main`.
- This machine's git/tooling environment can fail on normal `git commit` because an unsupported `--trailer` flag is injected against an older git version.
- If standard `git commit` fails with `unknown option 'trailer'`, use the same safe low-level `git commit-tree` workaround used earlier in this conversation.
- Do not change git config to work around this.

## Working Agreements
- Keep the browser engine and Node eval harness behavior aligned when game rules change.
- Prefer small, scoped improvements over large mixed changes.
- If the user explicitly asks for commits, make small commits for micro improvements or narrowly scoped features instead of bundling unrelated work.
- Do not create commits unless the user explicitly requests them.
- When changing file layout, commands, result schema, dashboard interpretation, or core architecture, update `README.md` and this file together.
