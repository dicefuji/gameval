# Gameval Roadmap

This roadmap replaces the old internal orchestration notes. It is intentionally public-facing: phases describe product and methodology work, not individual implementation sessions.

## Completed foundations

- Multi-provider model calls through Anthropic and OpenAI.
- Self-play and adversarial learning modes.
- Reproducible seeding and per-game seed recording.
- Per-iteration mean, standard deviation, min/max, and 95% CI.
- Failure taxonomy and eval version/changelog metadata.
- Bundled sample results so a fresh clone renders the dashboard without live API keys.
- Results dashboard with learning curves, leaderboard, protocol metadata, failure taxonomy, pairwise comparisons, head-to-head matrix, held-out reference benchmark, and inline replay.
- Arena sandbox with registry-backed model iteration loading.
- Initial multi-game interface and `games/arena-war/` registration scaffold.

## Near-term priorities

1. **Finish multi-game delegation**
   - Make `eval-runner.js` load engine, algorithms, prompts, and validation through `games/<name>/index.js`.
   - Retire duplicated root game copies once browser and Node behavior are fully aligned.

2. **Improve public API boundaries**
   - Extract runner internals into smaller modules.
   - Keep `eval-runner.js` as the CLI entrypoint.
   - Add stable module exports for downstream tooling that wants to run or inspect evals.

3. **Strengthen statistical interpretation**
   - Surface Bradley-Terry ratings in the dashboard.
   - Add clearer uncertainty/consistency summaries near the learning curve.
   - Keep learning curves primary and avoid single-score leaderboard overclaims.

4. **Harden generated-code execution**
   - Isolate model-generated algorithms more strictly.
   - Add clearer timeout and resource-limit reporting.
   - Document the security model for local vs hosted use.

5. **Improve release hygiene**
   - Add tagged benchmark releases.
   - Publish a changelog for schema/protocol changes.
   - Keep one clean bundled sample dataset per release.

## Ongoing commitments

- Preserve the benchmark's narrow claim: iterative spatial algorithm improvement under adversarial competition feedback.
- Keep the methodology doc and dashboard interpretation aligned.
- Make every published model comparison reproducible from model IDs, seed, iteration count, game count, provider settings, and eval version.
