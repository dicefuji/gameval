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

## Current Architecture
- `eval-runner.js`
  - Source of truth for the benchmark loop.
  - Owns prompt -> generated algorithm -> extraction -> headless evaluation -> feedback -> plateau stop -> `eval-results.json`.
  - Supports repeated `--model` flags for multi-model comparisons.
  - Current output schema is comparison-oriented and includes protocol metadata, model summaries, per-iteration details, prompt feedback, and representative board snapshots.
- `prompts.js`
  - Defines the first-round prompt and iterative prompt.
  - Iterative prompt feeds leaderboard, current winner code, and recent history back into later rounds.
- `results.html` and `results.js`
  - Main user-facing results surface.
  - Intended to show who improved fastest, who finished strongest, why the comparison is trustworthy, and what the selected iteration actually did.
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
- `engine.js`
  - Browser game engine.
  - Still duplicates logic that also exists in `eval-runner.js`.
- `ui.js`
  - Sandbox UI controller.
  - Uses `game history` terminology deliberately to avoid confusion with eval iterations.
- `algorithms.js`
  - Shared built-in baseline strategies.
  - Exports `{ ALGOS, ALGO_NAMES }` for Node.
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
- The current frontend is still limited by the data it receives:
  - no confidence intervals
  - no variance bands
  - no failure taxonomy section
  - no Elo
  - no head-to-head matrix
  - no automated arena preloading for replay

## Current State Of The Runner
- Function extraction was fixed to support model-generated code that contains JavaScript template literals.
- A real smoke run succeeded after that extractor fix.
- Known runner caveats:
  - repeated games in one iteration are currently effectively deterministic under the present setup, so `gamesPerIter` is not yet giving meaningful spread
  - plateau logic exists, but the methodology wants stronger statistical interpretation around plateau and significance
  - full game logic is duplicated between browser and Node paths

## Known Gaps And Next Priorities
- The most important rigor gaps to address next:
  1. Add controlled variance to evaluation runs so multi-game averages mean something.
  2. Report consistency / spread, not just mean territory and mean ticks.
  3. Move toward `N >= 5` as the default comparison setting.
  4. Add failure taxonomy fields to `eval-results.json`.
  5. Add eval versioning / changelog metadata.
  6. Consider held-out reference algorithms and Elo-style rating.
- The most important UX gaps to address next:
  1. Show consistency or uncertainty in the dashboard.
  2. Surface limitations more explicitly.
  3. Provide a more seamless path from "best-vs-best candidate" to actual arena replay.

## Setup And Validation
- Install dependencies with `npm install`.
- Start the local frontend with `npm run serve`.
- Open:
  - `http://localhost:3000/results.html` for the main dashboard
  - `http://localhost:3000/arena.html` for the sandbox
- Run evals with:
  - `npm run eval:quick`
  - `npm run eval -- --model claude-sonnet-4-20250514 --model gpt-4o`
- `ANTHROPIC_API_KEY` must be set before running the eval harness.
- `eval-results.json` is written locally and ignored by git.

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
