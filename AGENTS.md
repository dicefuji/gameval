# Agent Notes

## Start Here
- On a fresh context, read this file first, then `README.md`, then the inline comments in the root JS files.
- The authoritative code layout is the current repo root. The project does not use a `src/` directory right now.
- Update this file after any important architecture, workflow, or setup change.

## Architecture
- The primary product story is benchmark-first: compare multiple models on the same iterative Arena War protocol, then inspect the results in the dashboard.
- `eval-runner.js` is the source of truth for the iterative eval loop. It should own prompt -> generated algorithm -> headless testing -> reward feedback -> plateau/stop logic -> `eval-results.json`.
- `prompts.js` defines the first-round prompt and the iterative feedback prompt wording. Keep the prompt contract aligned with the benchmark loop described in `README.md`.
- `results.html` and `results.js` are the main user-facing results surface. They should explain who improved fastest, who finished strongest, and what each iteration's algorithm did.
- `arena.html` is the interactive sandbox and future replay surface. It loads `algorithms.js`, `engine.js`, and `ui.js` directly.
- `engine.js` contains the browser game engine: circular mask creation, seed placement, per-tick claim resolution, scoring, snapshots, and hot-swapping algorithms.
- `ui.js` owns sandbox canvas rendering, controls, live stats, game history, and the model-code injection panel.
- `algorithms.js` defines the built-in baseline strategies and exports `{ ALGOS, ALGO_NAMES }` for Node usage.
- `package.json` provides the main project commands. `npm run serve` serves the repo root so `results.html` and `arena.html` are reachable directly.

## Setup And Validation
- Install dependencies with `npm install`.
- Run the browser UI with `npm run serve`, then open `http://localhost:3000/results.html` for the main dashboard and `http://localhost:3000/arena.html` for the sandbox.
- Run the quick eval with `npm run eval:quick`, or pass multiple `--model` flags through `npm run eval -- ...` for comparisons.
- `ANTHROPIC_API_KEY` must be set before running the eval harness.

## Product And Terminology
- The primary benchmark is per-model comparison under a shared protocol, not direct co-evolution between models.
- Best-vs-best model replays are a follow-on layer after the benchmark results are clear.
- Use `eval iteration` for a runner round that feeds reward signals back into the next prompt.
- Use `game history` for completed browser matches in the sandbox UI to avoid conflating it with eval iterations.

## Working Agreements
- Keep the browser engine and the Node eval harness behavior aligned when game rules change.
- Prefer small, scoped improvements over large mixed changes.
- If the user explicitly asks for commits, make small commits for micro improvements or narrowly scoped features instead of bundling unrelated work.
- Do not create commits unless the user explicitly requests them.
- When changing file layout, commands, result schema, or core architecture, update `README.md` and this file together.
