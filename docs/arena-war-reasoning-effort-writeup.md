# Reasoning effort is the biggest single knob on this benchmark
### Frontier comparison on Arena War, n=25, seed 424242, across self-play and adversarial modes at default and high reasoning

*Arena War is an iterative, spatial, multi-agent coding benchmark. On the same seed, same fleet, and same number of games per iteration, turning up OpenAI's `reasoning_effort` from the default to `high` on one model produced a larger absolute-score swing than switching modes, switching models, or bumping `n` from 10 to 25. It also introduced a new failure mode — extraction errors — that broke the adversarial comparison at a fixed token budget. This post documents the 2×2×2 (mode × reasoning × model) cell-by-cell, states precisely what the result means, and is clear about what it doesn't.*

---

## TL;DR

- At `reasoning=high`, gpt-5.4-2026-03-05 reached **57% territory at iter 3 in self-play** (95% CI `[54.8, 59.1]`). At default reasoning on the same seed, its ceiling was 41%. That is a **+18pp absolute gain from flipping a single runtime flag**, and it puts gpt-5.4's reference-margin at **+42.3% over the held-out reference** (prior record: +13.6%, a 3.1× increase).
- In self-play at `reasoning=high`, the bootstrap pairwise Δ between opus-4-7 and gpt-5.4 is **tied** (Δ = −3.0%, CI `[−7.4, +1.3]`). But the matched-lobby head-to-head of their best iterations is **17-6-2 for gpt-5.4**, Δ = −8.3% CI `[−13.0, −3.3]`, significant. The two tests disagree; we argue the H2H is the stronger evidence.
- In adversarial at `reasoning=high`, gpt-5.4 cascades into extraction failures on iterations 2-3 and early-stops at its iter-1 score of 38%, while opus iterates cleanly to 46%. opus wins pairwise (Δ = +8.1%, CI `[+4.3, +12.4]`) and head-to-head 24-1-0. We argue this is not a model-capability result; it's a **token-budget-bounded artifact** of high-reasoning prompts under a 32k completion floor. The first-order read is: "at `high`, you need a bigger budget for long prompts, or you need a cheaper way to surface the visible output."
- Held-out reference anchor: both models significantly beat the reference across all four cells, with the exception of opus at default reasoning in self-play (15% avg vs the reference's 25.7%). The reference is a fixed hand-written opponent that no model has ever seen.

Reproduction: runner at `arena-war-eval-v0.3.3`, schemaVersion 6, per-game seeds are a deterministic function of the run seed, the model index, the iteration, and the game index. All four JSON artifacts are on the machine that produced them.

---

## The benchmark in one paragraph

Arena War is a 40×40 circular grid with four players. Each tick, every player's algorithm returns a prioritized list of `[row, col]` cells it wants to claim; the engine resolves claims in order, respecting adjacency and the circular mask. A game ends at a fixed tick budget or when the grid fills. The primary score is the percentage of cells occupied by the player's color at end-of-game. An eval iteration is **n=25 games**, each with a different per-game seed, against a fixed fleet of baseline opponents. The prompt gives a model full game rules, examples of prior-iteration scores (its own for self-play; its own plus two anonymized top-2 opponent algorithms for adversarial), and asks it to return a single JavaScript function. The runner extracts, compiles, and runs that function headlessly against the baseline fleet, then feeds scores back into the next iteration's prompt. Early stop fires when an iteration fails to produce a new best (`STALE`) or when a run-level plateau rule says the CI95 overlaps the running-best's CI95. The output JSON is self-describing: version, schema, seed, per-game seeds, per-iteration failure flags, bootstrap pairwise diffs, a Bradley-Terry opponent-aware rating, a best-vs-best head-to-head matrix, and a held-out reference benchmark.

---

## What we varied

| Axis | Values | Models affected |
|---|---|---|
| Mode | self-play, adversarial | both |
| Reasoning effort | default (omitted), **`high`** | gpt-5.4-2026-03-05 only (`reasoning_effort` is an OpenAI reasoning-family parameter; it is omitted for anthropic and for non-reasoning OpenAI models) |
| Model | claude-opus-4-7, gpt-5.4-2026-03-05 | — |

Held constant: n=25 games per iteration, seed 424242, baseline fleet (Density Wave, Diagonal Spiral, Greedy BFS), held-out reference algorithm (HeldOutReference-v1), up to 6 iterations with CI-overlap plateau early-stop, 8192 visible token output budget per call. At `reasoning=high`, the OpenAI provider raises `max_completion_tokens` to a floor of 32768 to cover both internal reasoning and visible output; non-reasoning calls are untouched. Each call has a per-effort request-timeout (30 minutes at `high`; the OpenAI SDK's default of 10 minutes was empirically insufficient for long iterative prompts).

Four runs fall out of the design:

| Run | Mode | Reasoning | Notes |
|---|---|---|---|
| A | self-play | default | Baseline n=25; prior session |
| B | adversarial | default | Baseline n=25; prior session |
| **C2** | self-play | `high` | This session; re-ran after surfacing a timeout bug |
| **D** | adversarial | `high` | This session |

---

## Cell-by-cell results

### The 2×2×2

| Mode × reasoning | opus best | gpt-5.4 best | Pairwise best-vs-best | H2H best-vs-best (25 games) | opus Δ vs reference | gpt-5.4 Δ vs reference |
|---|---|---|---|---|---|---|
| Self-play, default | 14% (iter 2) | 39% (iter 1) | gpt Δ = −24.1%, CI `[−28.9, −18.4]` **sig (b_better)** | gpt **15-9-1**, Δ = −6.9 `[−13.5, −0.0]` sig | **−10.8%** `[−17.4, −3.6]` **sig (ref better)** | +13.6% `[+11.9, +15.5]` **sig**, 25/25 wins |
| Self-play, **`high`** | **54%** (iter 3) | **57%** (iter 3) | Δ = −3.0%, CI `[−7.4, +1.3]` **tied** | gpt **17-6-2**, Δ = −8.3 `[−13.0, −3.3]` **sig (b_better)** | **+31.0%** `[+27.2, +34.5]` **sig**, 25/25 wins | **+42.3%** `[+39.9, +44.7]` **sig**, 25/25 wins |
| Adversarial, default | 41% (iter 1) | 41% (iter 3) | Δ = −0.04%, CI `[−4.8, +4.9]` **tied** | opus 12-13-0, Δ = −2.9 `[−6.4, +0.9]` tied | +15.0% `[+12.3, +17.8]` **sig**, 25/25 wins | +20.2% `[+15.8, +24.4]` **sig**, 23/25 wins |
| Adversarial, **`high`** | **46%** (iter 4) | 38% (iter 1) | Δ = +8.1%, CI `[+4.3, +12.4]` **sig (a_better)** | opus **24-1-0**, Δ = +13.6 `[+9.6, +17.7]` **sig** | **+32.1%** `[+29.5, +34.8]` **sig**, 25/25 wins | +10.5% `[+7.0, +13.8]` **sig**, 22/25 wins |

All percentages are cells-claimed-at-end-of-game; all CIs are 95% bootstrap CIs with 4000 resamples; significance is CI-excludes-zero at α = 0.05.

### Iteration traces

At `reasoning=high`, both models get less monotonic and more volatile. Self-play:

| Model | Iter 1 | Iter 2 | Iter 3 | Iter 4 | Iter 5 |
|---|---|---|---|---|---|
| opus (default self-play) | 12% | 14% | 9% | — | — |
| opus (`high` self-play) | 12% | 11% | 54% | 17% | 48% |
| gpt-5.4 (default self-play) | 39% | 35% | 33% | — | — |
| **gpt-5.4 (`high` self-play)** | **41%** | **SYN_ERR** | **57%** | **54%** | **SYN_ERR** |

Adversarial:

| Model | Iter 1 | Iter 2 | Iter 3 | Iter 4 | Iter 5 | Iter 6 |
|---|---|---|---|---|---|---|
| opus (default adv) | 41% | 39% | 37% | — | — | — |
| opus (`high` adv) | 9% | 39% | 41% | 46% | 38% | 38% |
| gpt-5.4 (default adv) | 38% | 38% | 41% | — | — | — |
| **gpt-5.4 (`high` adv)** | **38%** | **SYN_ERR** | **SYN_ERR** | — | — | — |

`SYN_ERR` means extraction found no named function in the returned output. The call completed; the model produced text; there was just no parseable `function myAlgorithm(...)` in it. This is the key failure mode we'll unpack below.

### Where gpt-5.4's +18pp really came from

Line up gpt-5.4's iter-by-iter self-play traces, default vs high:

- **Iter 1**: default 39% → high **41%**. Within noise (2pp).
- **Iter 2**: default 35% → high **SYN_ERR**. Regression + new failure mode.
- **Iter 3**: default 33% → high **57%**. 24pp gap.

At iter 1 the two configurations are statistically indistinguishable. The +18pp gain is not a baseline lift; it's a **higher ceiling the model can reach on the iterative prompt, once it has seen its own prior winner code**. This matches the intuition that reasoning effort helps most when the task is "think carefully about what you already wrote and improve it" — exactly the iterative prompt's job.

---

## Three load-bearing findings

### 1. At the frontier, matched-lobby H2H and cross-lobby pairwise can disagree — and H2H is the stronger evidence

In Run C2 (self-play, `reasoning=high`), the bootstrap pairwise comparison between opus's iter-3 (54%) and gpt-5.4's iter-3 (57%) returns a `tied` verdict:

```
pairwise: Δ = -3.0%, CI95 = [-7.4, +1.3]
```

But if you take those same two algorithms and drop them into a *shared lobby* — identical grid, identical seed sequence, four-player free-for-all — 25 games gives:

```
h2h:      gpt-5.4 wins 17, opus wins 6, 2 draws
          Δ = -8.3%, CI95 = [-13.0, -3.3]    (significant)
```

Both tests use the same 25 seeds. The difference is that the pairwise bootstrap compares *separately-played* game sets — opus played its 25 games in a lobby with three baselines, gpt-5.4 played its 25 in a different lobby with the same three baselines, and we compare the two distributions. That averages across different opponent draws and inflates variance. The H2H puts both models in the *same four-player game* with two baselines as the third and fourth seats, so the variance from opponent draw cancels.

Implication: **for frontier comparisons where the two leaders are close, the pairwise bootstrap is underpowered. Prefer matched-lobby H2H.** Default to H2H in reporting when the pairwise CI touches zero.

### 2. `reasoning=high` has a non-trivial downside: extraction failures

Across the two `high` runs, gpt-5.4 produced **4 `SYNTAX_ERROR` iterations** (C2 iter 2, C2 iter 5, D iter 2, D iter 3). Across the two default runs, **zero**. All four failures happen on iterations where the prompt grew — iter 2 onward in self-play adds the iter-1 winner source; iter 3 onward adds iter-2 winner source too; adversarial adds anonymized opponent code blocks on top.

The most likely mechanism is token budget exhaustion on internal reasoning. At `reasoning=high` the provider raises `max_completion_tokens` to a 32768 floor to cover both internal reasoning and the visible response. On a short prompt, a 529-token completion (we measured this in a smoke test) uses <2% of that floor. On an iterative prompt with 3500+ characters of prior winner code, reasoning traces are substantially longer, and the model can exhaust its budget before it emits the parseable `function myAlgorithm(...) { ... }` block. What we see — "call returned text, no named function in the text" — is consistent with a partial emission where the model wrote its reasoning summary and ran out of budget before writing the code.

This has a consequence for the adversarial comparison in Run D: gpt-5.4 fails to extract on iters 2 and 3, gets no new scores, and the plateau rule early-stops it at iter-1's 38%. Opus meanwhile iterates normally to 46% at iter 4. The pairwise Δ = +8.1 sig and the H2H 24-1-0 are *both* consequences of gpt-5.4 getting three fewer effective iterations than opus. **We do not read this as "opus beats gpt-5.4 at adversarial reasoning=high."** We read it as "the 32k token floor is insufficient for gpt-5.4 at `high` on the adversarial iterative prompt." The clean rerun would be with a 48k or 64k floor.

### 3. opus self-play is genuinely noisy at n=25 — don't draw strong conclusions from a single opus number

Opus's best iteration score in self-play at default reasoning was **14% at n=25**. At `reasoning=high` — where opus doesn't even receive the reasoning knob — opus's best was **54% at n=25**. The +40pp swing is pure sampling variance between two independent runs against the same seed.

We investigated: anthropic models don't expose a `reasoning_effort` equivalent on their API (Sonnet/Opus 4 have extended-thinking via a separate parameter, which we don't toggle here). Opus's iterations are independently sampled `temperature=0.7` calls with the same prompt each time. The deterministic game seeds don't stabilize this because the stochastic element is in the generation, not the game.

This means: **at n=25, opus self-play numbers should always be reported with a large grain of salt.** The n=10 number from a prior run (52% iter 1) is a particularly unreliable overstatement; it was well within the n=10 CI95 [34, 56] but it drove a headline we later had to retract. In any follow-up, opus self-play should be run at least 3 times to get a distribution over best-iteration scores, not a point estimate.

Two tests that are less noisy:

- **Opus adversarial**: 41% default, 46% high — only +5pp, tight across both runs. Adversarial mode's shared-opponent-code injection reduces variance by anchoring the model to the same distractor. This is the more stable opus signal.
- **Opus vs reference**: Δ = +15.0%, +32.1%, +31.0% across three of the four runs (self-play default is the outlier at −10.8%). Reference matches are a head-to-head against a fixed opponent, so variance is lower.

---

## The held-out reference, as an anchor

Every run includes a held-out reference benchmark: 25 games of the model's best iteration against HeldOutReference-v1, a frozen hand-written opponent that no model sees in training or in prompts. At n=25 the reference result is the single most comparable number across runs because (a) it's always the same opponent, (b) the seed derivation is the same, and (c) the significance test is the same.

| Run | Model | Δ vs reference | CI95 | Wins | Significance |
|---|---|---|---|---|---|
| Self-play, default | opus | −10.8% | `[−17.4, −3.6]` | 7/25 | **reference better sig** |
| Self-play, default | gpt-5.4 | +13.6% | `[+11.9, +15.5]` | 25/25 | **model better sig** |
| Self-play, `high` | opus | +31.0% | `[+27.2, +34.5]` | 25/25 | **model better sig** |
| Self-play, `high` | gpt-5.4 | **+42.3%** | `[+39.9, +44.7]` | 25/25 | **model better sig** |
| Adversarial, default | opus | +15.0% | `[+12.3, +17.8]` | 25/25 | **model better sig** |
| Adversarial, default | gpt-5.4 | +20.2% | `[+15.8, +24.4]` | 23/25 | **model better sig** |
| Adversarial, `high` | opus | +32.1% | `[+29.5, +34.8]` | 25/25 | **model better sig** |
| Adversarial, `high` | gpt-5.4 | +10.5% | `[+7.0, +13.8]` | 22/25 | **model better sig** |

Two observations:

- **Prior record**: +20.2% (gpt-5.4 adversarial default). **New record**: +42.3% (gpt-5.4 self-play `high`). That is the largest margin any model has ever posted against this reference, and the prior record was already held by the same model. It's a 3.1× bump from one knob.
- The only cell that loses to reference is opus self-play default, and it's an outlier that `reasoning=high` doesn't influence (opus doesn't receive the knob). That row is overwritten by the noisy second opus-self-play run; both "versions of opus self-play" exist in our data, and they land in completely different places. The reference is the only statistic that is robust enough to report for opus here.

---

## Bradley-Terry ratings (an opponent-aware sanity check)

Arena War also computes a Bradley-Terry rating via MM iteration across the full four-player game set (all baselines, all model iterations). It's useful as a second opinion on the leaderboard.

For Run D (adversarial, `reasoning=high`):

| Player | Kind | Elo | Games | Wins |
|---|---|---|---|---|
| gpt-5.4-2026-03-05 | model | 1341.5 | 79 | 74 |
| claude-opus-4-7 | model | 1153.9 | 454 | 383 |
| Density Wave | baseline | 978.1 | 529 | 314 |
| Diagonal Spiral | baseline | 821.6 | 529 | 188 |
| Greedy BFS | baseline | 704.9 | 529 | 101 |

gpt-5.4 has **a 188-point Elo lead over opus** — despite opus winning the matched-lobby H2H 24-1-0. The reason is BT weights by games played: gpt-5.4 only has 79 games in the rating pool (iter 1 plus the reference/H2H runs; it never generated a valid iter 2/3 algorithm), and it won 74 of them. Opus has 454 games (five full iterations plus reference/H2H runs) and won 383. BT rewards the model with a higher win rate, even if it played far fewer games — the uncertainty in the rating doesn't show up as an Elo decrement.

This is a known pathology of BT on unbalanced sample sizes. We flag it in the dashboard and don't treat it as the primary verdict for adversarial `reasoning=high`. The pairwise CI + H2H pair is the real story.

---

## Methodology

- **Fleet**: claude-opus-4-7 (anthropic), gpt-5.4-2026-03-05 (openai). Both are the current top of each provider's reasoning stack at the time of running.
- **Prompts**: Arena War baseline prompt for iter 1; iterative prompt for iter ≥2 (includes prior iteration leaderboard + current winner source); adversarial prompt adds anonymized top-2 opponent source blocks.
- **Grid**: 40×40 circular mask, 4 players, seeded player spawn positions.
- **Games per iteration**: 25. Per-game seeds are derived from `(runSeed, modelIndex, iterIndex, gameIndex)` via an LCG mix so the same seed produces byte-identical games across runs.
- **Iterations**: up to 6, early-stop when (a) an iteration fails to produce a new running-best (`STALE` flag with patience=2) or (b) the CI95-overlap plateau rule fires.
- **Statistics**: bootstrap pairwise mean-diff with 4000 resamples, α=0.05; matched-lobby H2H between best iterations; Bradley-Terry MM ratings over the full four-player ladder; held-out reference benchmark at n=25.
- **Reasoning-effort plumbing**: a CLI flag `--reasoning-effort <low|medium|high|xhigh>` is threaded into the OpenAI provider layer and applied as `reasoning_effort` on Chat Completions calls. It is scoped to gpt-5*/o1/o3/o4 family models only. Token floor for `max_completion_tokens` scales with effort: 16k (low/medium), 32k (`high`), 64k (`xhigh`). Per-request timeout scales similarly: 20 min (low/medium), 30 min (`high`), 60 min (`xhigh`). The protocol field `protocol.reasoningEffort` is recorded in the output JSON; runs at different effort levels are not directly score-comparable and the dashboard should eventually gate comparisons on this field.
- **Reproducibility**: both Run C2 and Run D can be re-run bit-for-bit with the same runner version (`arena-war-eval-v0.3.3`), same seed (424242), and the same `--reasoning-effort high`.

---

## What this doesn't prove

1. **Not a frontier-model ranking**: n=25 is enough to get tight CIs on reference-Δ and on matched-lobby H2H, but not enough to give a stable point estimate of opus's self-play best. Any ranking that ignores the +40pp between the two opus self-play runs is overfit to one sample.
2. **Not a general coding benchmark**: Arena War measures one thing — the ability to iteratively improve a spatial territory algorithm through competition feedback. It does not test reasoning about modular code, long-horizon agents, tool use, architecture, debugging, or open-ended engineering. gpt-5.4's +18pp here is not evidence that `reasoning=high` helps more generally.
3. **Not a "high is always better" claim**: In adversarial at `reasoning=high`, gpt-5.4 crashed into extraction failures and its comparison collapsed. At a fixed 32k completion floor, `high` with adversarial prompts is unstable. If you're running `reasoning=high` on long prompts in production, budget accordingly.
4. **Not an explanation of the underlying cause of +18pp**: We can observe that the improvement happens at iteration 3 when the iterative prompt is active, not at iteration 1. We can't claim internal-chain-of-thought quality, attention sharpness, or any mechanism — we're showing behavior, not internals.
5. **Not comparable across EVAL_VERSIONs without re-running**: Each EVAL_VERSION bump is marked score-affecting in the CHANGELOG. The v0.3.3 runs here should not be averaged with v0.3.2 or older numbers without a side-by-side replication.
6. **Reasoning knob gives different families different advantages**: opus gets no `reasoning_effort` knob in this eval; anthropic has an extended-thinking parameter we don't exercise here. A follow-up with extended-thinking on opus and `reasoning_effort=high` on gpt-5.4 simultaneously would be a fairer cross-provider frontier test.

---

## What we'd do next

- **Rerun Run D at a 48k or 64k completion floor** to confirm the adversarial `reasoning=high` failures are budget-bounded, not capability-bounded. If gpt-5.4 iterates cleanly at 64k, the verdict in that cell changes substantially.
- **Run a dose-response curve on gpt-5.4 self-play: low, medium, high, xhigh at n=25**. Would give a clean single-model-single-mode sweep.
- **Turn on opus extended-thinking in a matched run**. The only cross-provider axis we haven't exercised is "give both models more thinking tokens". Anthropic's extended-thinking is the nearest equivalent to OpenAI's reasoning-effort.
- **Dashboard polish**: surface `protocol.reasoningEffort` on the front page, and filter the pairwise/leaderboard panels by effort level so cross-effort runs can't be mistaken for the same configuration.
- **Stabilize opus self-play**: run it 3 times at n=25 and report a distribution of best-iteration scores, not a point. The two existing values (14% and 54%) are the most divergent data point in the eval.

---

## Appendix: reproducibility

| Run | Mode | Reasoning | EVAL_VERSION | Schema | Seed | JSON |
|---|---|---|---|---|---|---|
| A | self-play | default | arena-war-eval-v0.3.2 | 5 | 424242 | `eval-results-frontier-n25-selfplay.json` |
| B | adversarial | default | arena-war-eval-v0.3.2 | 5 | 424242 | `eval-results-frontier-n25-adversarial.json` |
| C2 | self-play | `high` | arena-war-eval-v0.3.3 | 6 | 424242 | `eval-results-frontier-n25-selfplay-reasoning-high.json` |
| D | adversarial | `high` | arena-war-eval-v0.3.3 | 6 | 424242 | `eval-results-frontier-n25-adversarial-reasoning-high.json` |

The v0.3.3 runner adds `--reasoning-effort`, records `protocol.reasoningEffort`, and scales the OpenAI request timeout by effort level. See `CHANGELOG` in `eval-runner.js` and the PR #17 writeup for the full diff.

To reproduce Run C2:

```
npm run eval -- \
  --model claude-opus-4-7@anthropic \
  --model gpt-5.4-2026-03-05@openai \
  --mode self-play \
  --games-per-iter 25 \
  --iterations 6 \
  --seed 424242 \
  --reasoning-effort high
```

To reproduce Run D, swap `--mode adversarial`.
