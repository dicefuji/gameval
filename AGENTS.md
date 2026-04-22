# Agent Notes

## Start Here
- On a fresh context, read this file first, then `README.md`, then the inline comments in the root JS files.
- The authoritative code layout is the current repo root. The project does not use a `src/` directory right now.
- Update this file after any important architecture, workflow, or setup change.

## Architecture
- `arena.html` is the no-build browser entrypoint. It loads `algorithms.js`, `engine.js`, and `ui.js` directly.
- `algorithms.js` defines the built-in baseline strategies and exports `{ ALGOS, ALGO_NAMES }` for Node usage.
- `engine.js` contains the browser game engine: circular mask creation, seed placement, per-tick claim resolution, scoring, snapshots, and hot-swapping algorithms.
- `ui.js` owns canvas rendering, controls, live stats, history, and the model-code injection panel.
- `prompts.js` contains the baseline and iterative prompt templates used by the eval loop.
- `eval-runner.js` is the Node eval harness. It calls the Anthropic API, extracts a returned JS function, runs headless games against baselines, tracks the best iteration, and writes `eval-results.json`.
- `package.json` provides the main project commands. `npm run serve` serves the repo root so `arena.html` is reachable at `/arena.html`.

## Setup And Validation
- Install dependencies with `npm install`.
- Run the browser UI with `npm run serve`, then open `http://localhost:3000/arena.html`.
- Run the quick eval with `npm run eval:quick`.
- `ANTHROPIC_API_KEY` must be set before running the eval harness.

## Working Agreements
- Keep the browser engine and the Node eval harness behavior aligned when game rules change.
- Prefer small, scoped improvements over large mixed changes.
- If the user explicitly asks for commits, make small commits for micro improvements or narrowly scoped features instead of bundling unrelated work.
- Do not create commits unless the user explicitly requests them.
- When changing file layout, commands, or core architecture, update `README.md` and this file together.
