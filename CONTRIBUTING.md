# Contributing to Gameval

Thanks for improving Gameval. This project is an evaluation harness, so small changes can affect benchmark claims. Please keep changes narrow, reproducible, and well documented.

## Local setup

```bash
npm install
npm run check
npm run serve
```

Open:

- `http://localhost:3000/results.html` for the dashboard
- `http://localhost:3000/arena.html` for the sandbox

The frontend works without API keys by loading `sample-eval-results.json`.

## Running live evals

Live evals require provider credentials:

```bash
cp .env.example .env
# fill in ANTHROPIC_API_KEY and/or OPENAI_API_KEY, then export them
```

Example:

```bash
npm run eval -- \
  --model claude-opus-4-7@anthropic \
  --model gpt-5.5-2026-04-23@openai \
  --iterations 6 \
  --games-per-iter 25 \
  --seed 424242 \
  --reasoning-effort high
```

The runner writes `eval-results.json`, which is intentionally gitignored. Only commit a new bundled `sample-eval-results.json` when you intentionally want to update the public demo dataset.

## Benchmark discipline

- Keep the valid claim narrow: Gameval measures iterative spatial algorithm improvement under adversarial competition feedback.
- Do not use one run to make broad claims about general coding ability or general reasoning.
- Preserve the shared protocol when comparing models.
- Record seeds, model identifiers, iteration counts, game counts, and failure modes.
- If the JSON output shape changes, update `schemaVersion`, prepend to the runner changelog, and document the change.
- Keep browser engine and Node eval harness rules aligned.

## Pull request checklist

- [ ] `npm run check` passes.
- [ ] `npm run eval:quick` is not required for doc-only changes, but any runner/game-rule change should be smoke-tested with provider keys.
- [ ] `README.md` and `AGENTS.md` are updated for setup, workflow, architecture, or methodology changes.
- [ ] No real API keys, `.env` files, or local `.devin-*.json` artifacts are committed.
- [ ] Public-facing claims are supported by the methodology and the generated data.
