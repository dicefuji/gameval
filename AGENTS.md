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
  - Current output schema is comparison-oriented and includes protocol metadata, model summaries, per-iteration details, prompt feedback, and representative board snapshots.
- `providers.js`
  - Unified provider interface supporting Anthropic and OpenAI.
  - Exports `callModel(provider, model, prompt, maxTokens)` which returns `{ text, usage, latency }`.
- `prompts.js`
  - Defines the first-round prompt (`BASELINE_PROMPT`), iterative prompt (`buildIterativePrompt`), and adversarial prompt (`buildAdversarialPrompt`).
  - Iterative prompt feeds leaderboard, current winner code, and recent history back into later rounds.
  - Adversarial prompt adds an "OPPONENT ALGORITHMS TO BEAT" section with anonymized top-2 opponent source code (e.g., "Opponent A", "Opponent B").
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

## Known Gaps And Next Priorities
- Phase 3 addressed: controlled variance (seeded randomness), consistency/spread reporting, and `N >= 5` default are all implemented.
- The most important rigor gaps still open:
  1. Add failure taxonomy fields to `eval-results.json`.
  2. Add eval versioning / changelog metadata.
  3. Consider held-out reference algorithms and Elo-style rating.
  4. Stronger statistical interpretation around plateau detection (e.g., compare against CI overlap rather than fixed thresholds).
- The most important UX gaps to address next:
  1. Show consistency or uncertainty in the dashboard (CI bands, variance indicators).
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
