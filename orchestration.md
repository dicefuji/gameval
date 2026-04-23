# Arena War Benchmark — Implementation Orchestration

*Generated 2026-04-22. Tracks all sub-agent work across the 7-phase implementation plan.*

## Phases

### Phase 1: Multi-Provider Backend
- **Status**: IN PROGRESS (subagent: 68fe128b)
- **Files**: `providers.js` (new), `eval-runner.js`, `package.json`, `AGENTS.md`
- **Goal**: Add OpenAI API support alongside Anthropic; unified provider interface
- **Owner**: Backend sub-agent
- **Dependencies**: None
- **Blockers**: None

### Phase 2: Two-Mode Adversarial Learning (Self-Play vs Adversarial)
- **Status**: PENDING
- **Files**: `prompts.js`, `eval-runner.js`, `AGENTS.md`
- **Goal**: Implement `--mode self-play|adversarial`; adversarial mode shares anonymized top-2 opponent code after round 1
- **Owner**: TBD
- **Dependencies**: Phase 1 (eval-runner.js provider refactoring must be stable)
- **Blockers**: Phase 1 completion

### Phase 3: Statistical Rigor Engine
- **Status**: PENDING
- **Files**: `eval-runner.js`
- **Goal**: Seeded randomness, per-iteration mean/std/CI95, gamesPerIter=5 default, robust variance
- **Owner**: TBD
- **Dependencies**: Phase 1 (provider abstraction stable); Phase 2 (optional, can be parallel)
- **Blockers**: Phase 1 completion

### Phase 4: Frontend Visual Overhaul
- **Status**: IN PROGRESS (subagent: 3da8d522)
- **Files**: `results.html`, `results.js`
- **Goal**: Dark mode, confidence bands, hover tooltips, syntax highlighting, head-to-head matrix placeholder, failure taxonomy placeholder, responsive layout
- **Owner**: Frontend sub-agent
- **Dependencies**: None
- **Blockers**: None

### Phase 5: Arena Replay Integration
- **Status**: IN PROGRESS (subagent: a7328e26)
- **Files**: `arena.html`, `ui.js`, `results.js`
- **Goal**: One-click "Load in Arena" from dashboard; URL param preloading; side-by-side replay
- **Owner**: Frontend sub-agent
- **Dependencies**: Phase 4 complete
- **Blockers**: None

**Detailed Spec:**
- In `results.js`, each model's best iteration row should show a "Replay in Arena" button.
- The button links to `arena.html?loadModel=<model>&loadIter=<iter>`.
- `arena.html` + `ui.js` must read URL params via `URLSearchParams`.
- If params present, `ui.js` fetches `eval-results.json`, extracts the specific algorithm's `rawCode`, and injects it into the arena automatically (replacing player 0).
- The arena should highlight that a model algorithm is loaded (overlay label).
- Add a "Compare" mode in arena.html: two algorithm slots can each load a different model+iteration, and the game runs with just those two (plus baselines if desired).
- The `ui.js` injection panel should already support this via `replaceAlgorithm` on the `ArenaEngine`.

### Phase 6: Multi-Game Architecture Foundation
- **Status**: IN PROGRESS (subagent: 81eda8ac)
- **Files**: `games/arena-war/` (new), `games/game-interface.js` (new)
- **Goal**: Move game logic into pluggable directory; define `GameEngine` interface; refactor `eval-runner.js` to load games dynamically
- **Owner**: Architecture sub-agent
- **Dependencies**: Phase 1 (eval-runner.js provider refactoring stable)
- **Blockers**: None

**Detailed Spec:**
- Create `games/game-interface.js` defining the base interface:
  ```
  class GameEngine {
    constructor(config) {}
    step() { return { done, state }; }
    getResult() { return { scores, metrics }; }
    getRulesDescription() { return string; }
    getPromptTemplate() { return string; }
    validateAlgorithm(fn) { return boolean; }
    getDefaultConfig() { return object; }
  }
  ```
- Create `games/arena-war/` containing:
  - `engine.js` (moved from root, adapted to extend GameEngine)
  - `algorithms.js` (moved from root)
  - `prompts.js` (moved from root, adapted to game-specific prompt generation)
  - `index.js` (exports the ArenaWar game registration)
- Update `eval-runner.js`:
  - Add `--game <name>` CLI flag (default: `arena-war`)
  - Load game module dynamically: `require(\`./games/${gameName}/index.js\`)`
  - Game module provides prompt templates, engine class, and validation
  - All eval loop logic stays the same; only the prompt building and game execution delegate to the game module
- Update `arena.html`:
  - Load game module dynamically based on URL param `?game=arena-war`
  - Game module provides canvas renderer, stats formatter, and control bindings
- Keep backward compatibility: `npm run eval` without `--game` still runs arena-war exactly as before.

### Phase 7: Failure Taxonomy & Benchmark Versioning
- **Status**: DONE
- **Files**: `eval-runner.js`, `results.js`, `results.html`, `AGENTS.md`
- **Goal**: Failure codes per iteration (`SYNTAX_ERROR`, `RUNTIME_CRASH`, `REGRESSION`, etc.); `evalVersion` metadata; changelog semantics
- **Outcome**:
  - `eval-runner.js` emits all seven failure codes into `iteration.failureFlags` and writes `evalVersion` + `changelog` + `schemaVersion: 3` into every `eval-results.json`.
  - `results.html` / `results.js` render a per-model Failure Taxonomy panel (color-coded bars + summary sentence per model) and a version badge in the page header with the changelog as a hover tooltip; `evalVersion` is also shown in the Shared Protocol strip.
  - `AGENTS.md` now documents the failure codes and versioning policy.

**Detailed Spec:**
- `eval-runner.js` failure taxonomy:
  - Each iteration gets a `failureFlags` array:
    - `SYNTAX_ERROR`: function extraction failed
    - `RUNTIME_CRASH`: algorithm threw during a game tick
    - `REGRESSION_VS_PRIOR`: avgPct < previous successful iteration's avgPct
    - `REGRESSION_VS_BEST`: avgPct < best-ever avgPct for this model
    - `EXPLOIT_DETECTED`: algorithm claims cells outside valid mask (detected in game logic)
    - `TIMEOUT`: single tick exceeded 50ms (measure in eval-runner)
    - `STALE`: no meaningful improvement for >2 iterations (related to plateau)
  - `benchmarkMeta` object in `eval-results.json`:
    ```
    {
      evalVersion: "arena-war-eval-v0.2.0",
      changelog: [
        "v0.2.0: Added failure taxonomy, OpenAI provider support, adversarial mode",
        "v0.1.0: Initial eval harness with Anthropic-only, self-play mode"
      ],
      runTimestamp: ISO string,
      schemaVersion: 3
    }
    ```
- `results.js` failure taxonomy panel:
  - Small bar chart per model showing counts of each failure type
  - Color-coded: syntax errors (red), runtime crashes (orange), regressions (yellow), timeouts (purple)
  - Summary sentence: "Model X had 2 runtime crashes and 1 regression; its failure profile suggests..."
- Version badge in page header: "Arena War Eval v0.2.0" with hover tooltip showing changelog

### Phase 8A: Visual Refactor (Thinking-Machines-inspired)
- **Status**: COMPLETE
- **Files**: `results.html`, `results.js`
- **Goal**: Match Thinking Machines' research-post typography/layout/rigor while keeping the eval-arena framing (no "limitations" or "discussion" sections).
- **Delivered**: Warm-beige default theme, Source Serif Pro body + Inter sans + JetBrains Mono code, centered ~720px reading column, sticky left TOC with auto-highlight on scroll, numbered "Figure N:" captions with interpretation prose.

### Phase 8B: Rating, Reference Anchors, & Plateau Rigor
- **Status**: COMPLETE
- **Files**: `eval-runner.js`, `reference-algorithms.js`, `results.js`, `results.html`, `scripts/generate-fixture.js`, `AGENTS.md`, `README.md`
- **Goal**: Move beyond raw territory % as the only outcome metric and tighten the statistical interpretation of plateaus.
- **Delivered**:
  - **B1 Reproducible seeds**: top-level `runSeed` + per-game `seed` written into `eval-results.json`; `--seed <n>` CLI flag.
  - **B2 Bradley-Terry / Elo rating**: opponent-aware ratings fit across every model-vs-baseline pairwise outcome; Laplace-smoothed MM update; Elo-scaled output at 1000.
  - **B3 CI-overlap plateau detection**: new default `--plateau-mode ci_overlap`; an iteration is only a meaningful gain when its CI95 low clears the best-so-far's CI95 high. Falls back to `fixed_threshold` when stats are missing.
  - **B4 Held-out reference**: new `reference-algorithms.js`; source never exposed in prompts or output; per-model vs-reference benchmark with bootstrap CI.
  - **B5 Bootstrap pairwise comparison**: every model-pair comparison reports bootstrap 95% CI on the mean-pct delta and a verdict, rendered under the comparison table.
  - **B6 Real head-to-head matrix**: best-vs-best round-robin with shared baselines; delta matrix with bootstrap-CI highlighting.
  - Schema bumped to v0.3.0 / `schemaVersion: 4`; dashboard wired for every new field.
- **Deferred**:
  - **B7 Multi-game delegation**: full routing of `eval-runner.js` through `games/<name>/index.js` (still open; tracked separately).

## Git Workflow
- Pull `origin/main` before any agent starts work
- Commit after each phase completes
- Push to `origin/main` after every successful phase
- If `git commit` fails with `--trailer` error, use the `git commit-tree` workaround documented in AGENTS.md
- Check `git status` before each new phase to ensure no uncommitted changes from other agents

## Coordination Notes
- **eval-runner.js** is the most contended file (Phases 1, 2, 3, 6, 7 all touch it). Serialize these phases.
- **results.js** is the second most contended file (Phases 4, 5, 7). Serialize these phases.
- Phases 1 and 4 can run fully in parallel since they touch disjoint file sets.
- Phase 6 can start in parallel with Phase 1 if we create the `games/` directory structure first.
