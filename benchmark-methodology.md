# The Holy Grail of Benchmark Design
## A Reference Guide for Building Evaluations That Actually Measure Something

*Synthesized from academic literature, industry frameworks, and recent research (2022–2026)*

---

## Why Most Benchmarks Fail

Before building, understand the graveyard. MMLU, GLUE, SuperGLUE, HumanEval — all once considered state-of-the-art, all saturated within 18–24 months of release. The pattern is identical every time: a benchmark launches, becomes a leaderboard target, and within two years every frontier model scores above 90%, making it useless as a differentiator.

The root causes are structural, not accidental:

1. **Goodhart's Law** — "When a measure becomes a target, it ceases to be a good measure." The moment a benchmark becomes the thing labs optimize for, it stops measuring what it was designed to measure. Leaderboard Illusion papers have shown that labs deploy specialized optimization, selective variant submission, and coordinated private testing to game arena rankings — not necessarily improving real-world capability at all.

2. **Construct invalidity** — A 2025 systematic review of 445 LLM benchmarks found that most suffer from construct validity issues: they don't actually measure what they claim to measure. High math benchmark scores don't prove general reasoning ability; they prove the model is good at that specific benchmark's math questions.

3. **Data contamination** — LLMs train on vast web scrapes. If your benchmark data has ever appeared online, it's likely in the training set. Studies found widespread contamination across frontier models, with 5–15% accuracy inflation on contaminated benchmarks being common.

4. **Static fragility** — Static benchmarks have a half-life. GLUE took ~18 months to saturate. As compute scales exponentially, that window is shortening.

5. **Single-metric collapse** — Most benchmarks report a single accuracy number. A 2025 multi-dimensional study found 50x cost variation and 60% to 25% consistency drops that single-metric leaderboards completely hide.

The goal of this document is to help you build a benchmark that resists all five failure modes.

---

## Part 1: Foundational Principles

### 1.1 — Define what you are actually measuring (construct validity)

This is the most important step. Before writing a single line of code, write one sentence:

> *"This benchmark measures [X capability] by testing [Y behavior] using [Z metric], and a model that scores high genuinely has [X capability] in the real world."*

If you can't fill that sentence in without hedging, you don't have a construct — you have a task. The Stanford HAI validity framework recommends a three-step process:

1. **Decide the object of the claim** — Is the capability a *criterion* (directly measurable, like "can solve HackerRank Easy problems") or a *construct* (abstract, like "is a good programmer")?
2. **State the claim precisely** — "Model A can solve competitive programming problems at Codeforces Div. 2 level" is a valid criterion claim. "Model A is a great coder" is a vague construct claim.
3. **Review the evidence** — Does your benchmark actually provide evidence for the stated claim?

The five most important validity types for AI:
- **Content validity** — Does the benchmark cover the full range of the capability, not just a narrow slice?
- **Criterion validity** — Does performance correlate with real-world performance on the actual thing you care about?
- **Construct validity** — Does the benchmark measure the abstract capability, not a proxy that can be hacked?
- **Ecological validity** — Does the benchmark resemble real deployment conditions, or is it a toy?
- **Discriminant validity** — Does the benchmark distinguish between models that actually differ in the capability?

**For Arena War specifically:** The construct is *"iterative algorithmic reasoning under adversarial pressure"* — the ability to read code, identify weaknesses, and write improvements that work in practice. Each of these sub-constructs should be independently measurable.

---

### 1.2 — Pick a metric architecture, not a single metric

Stanford's HELM framework (Holistic Evaluation of Language Models) demonstrated that measuring 7 metrics across 16 scenarios simultaneously surfaces trade-offs that single-metric leaderboards hide. Before HELM, models were evaluated on only 17.9% of core scenarios in common — making cross-model comparison nearly meaningless.

**Minimum viable metric architecture:**

| Layer | What it measures | Why it's needed |
|---|---|---|
| Primary outcome | The thing you care about (e.g., territory %) | The headline number |
| Efficiency | How quickly the outcome is achieved | Prevents degenerate slow solutions |
| Consistency | Variance across runs with same algorithm | Distinguishes robust from lucky strategies |
| Improvement rate | Delta per iteration with feedback | The actual capability signal |
| Failure modes | What breaks, when, how | Harder to game than success metrics |

Never aggregate these into a single composite score by default. Show them separately. Aggregation hides trade-offs — a model might score 80% overall by being great on 3 dimensions and terrible on 2, looking identical to a model that's competent across all 5.

---

### 1.3 — Design for the full difficulty spectrum

The BeTaL automated benchmark design research found that benchmarks should be calibrated to target difficulty levels, with average deviations of 5–13% from target. Key lessons:

- **Floor and ceiling matter equally.** A ceiling effect (everyone scores 90%+) kills discriminability just as much as a floor effect (everyone scores 5–10%).
- **Difficulty stratification** — bin problems by difficulty tier, track model performance per tier. A model can look average overall but be exceptional at hard cases, or vice versa.
- **Build in headroom.** RE-Bench (METR's AI R&D benchmark) explicitly designed tasks where "human experts can make steady progress towards a high ceiling" — meaning the benchmark remains useful even as models improve significantly.
- **The Arena War corollary:** Your iterative design naturally avoids ceiling effects because each iteration raises the bar. But you should explicitly track improvement rate per iteration, not just final score — that's where the real capability signal lives.

---

## Part 2: Anti-Gaming Architecture

### 2.1 — Contamination prevention

Data contamination is the hardest problem in static benchmarking. The solutions, roughly in order of effectiveness:

**Dynamic generation** — The most robust approach. Generate test instances at evaluation time using rules, graph structures, or programmatic constraints. DyVal (ICLR 2024) uses directed acyclic graphs to generate evaluation samples with controllable complexity at runtime, making memorization impossible. LiveCodeBench uses timestamp-based splits: every problem was published *after* the model's training cutoff.

**Temporal gatekeeping** — Require that test data is provably post-training. LiveBench, AntiLeak-Bench, and LiveAoPSBench all use Wikidata revision logs or publication timestamps to guarantee this.

**Private held-out sets** — SWE-Bench Pro uses three tiers: public set (released), held-out set (private, used to monitor overfitting), commercial set (proprietary code, impossible to have in training data). This is the gold standard for code benchmarks.

**Paraphrasing/rewriting** — Weaker but practical: systematically paraphrase questions, shuffle answer choices, back-translate. MMLU-CF showed this meaningfully reduces contamination artifacts.

**For Arena War:** Contamination is structurally impossible because the evaluation is *generative* — you're asking a model to write code, then running it. There's nothing to memorize. This is a major structural advantage of your benchmark design. Document this explicitly.

---

### 2.2 — Adversarial pressure by design

Arena War's iterative structure is actually the cutting edge of anti-gaming architecture. The self-play and adversarial dynamic mirrors what the research community has converged on as the best way to prevent benchmark gaming:

- **The SEAS framework** (Self-Evolving Adversarial Safety) runs three iterative stages — Initialization, Attack, Adversarial Optimization — where both attacker and defender improve against each other. After three iterations, the defended model reached GPT-4-level robustness.
- **Chatbot Arena / LMSYS** uses pairwise human preference with hidden model identities, making it hard to game because you don't know which model you're optimizing against.
- **CodeElo** adapts the Elo rating protocol to competitive programming — models compete against the same adversarial test suites that human competitors face on Codeforces.

The key insight: **an adversarial environment where the target keeps moving is structurally resistant to gaming.** A model can't overfit to a benchmark that changes every iteration.

---

### 2.3 — The Elo architecture

For competitive multi-participant benchmarks, Elo is the right scoring system. It was originally designed for chess by Arpad Elo in the 1960s and has been extensively studied for AI leaderboards.

**Why Elo over raw percentage:**
- Accounts for opponent strength — beating a strong algorithm earns more points than beating a weak one
- Self-correcting — adds pressure against narrow optimization
- Produces continuous rankings even with sparse comparisons
- LiveSecBench, CodeElo, Chatbot Arena, and GDPval-AA all use Elo variants for exactly this reason

**Modern Elo variants worth knowing:**
- **m-ELO (batch-concave likelihood)** — addresses instability in adversarial/noisy settings, guarantees order-invariance
- **am-ELO (annotator-aware)** — down-weights unreliable annotators/evaluators via discriminative parameters
- **AGI-Elo** — simultaneously rates models (competency) and individual test cases (difficulty), producing a joint leaderboard that quantifies difficulty-awareness

**For Arena War:** Track Elo across iterations, not just % territory. A model whose algorithm beats a strong prior best earns more than one that beats a weak baseline. Add K-factor tuning — start with K=32 for early iterations (high learning rate), decay to K=16 as rankings stabilize.

---

## Part 3: Statistical Rigor

### 3.1 — Report confidence intervals, not point estimates

NIST AI 800-3 (2026) and the BetterBench study (Stanford, 2024) both flag this as the most widespread flaw in existing benchmarks: **14 out of 24 major benchmarks don't perform multiple evaluations of the same model or report statistical significance.** This means reported differences between models may be pure noise.

**Minimum statistical requirements:**

- **Run N ≥ 5 games per model per iteration.** Fewer than 5 makes variance indistinguishable from signal.
- **Report mean ± standard deviation** (or 95% confidence intervals) for every metric.
- **Bootstrap resampling** for confidence intervals when sample sizes are small. Run 1000 bootstrap resamples of your game results to get stable CI estimates.
- **Report p-values when claiming one model is better than another.** A 3% difference with ±4% standard deviation is not a real difference.
- **Effect size** matters more than p-value for small samples. Cohen's d ≥ 0.5 is a meaningful improvement; anything below 0.2 is probably noise.

**For Arena War specifically:**
```
Per iteration report:
  mean_territory ± std  (across N games)
  95% CI: [lower, upper]
  vs. prior best: Δmean = X%, p = Y, Cohen's d = Z
  improvement rate: (current_mean - baseline_mean) / iteration_number
```

---

### 3.2 — Control for variance sources

Multiple sources of variance will inflate your error bars if uncontrolled:

| Variance source | How to control |
|---|---|
| Starting position luck | Fix random seed per game slot, or average across many seeds |
| Opponent assignment | Run round-robin (each model plays every other model), not random |
| Grid size sensitivity | Report results at multiple grid sizes (40, 60, 80) |
| Algorithm determinism | Check if algorithm produces same output given same grid — flag if not |
| Model temperature | If using API calls, run at temperature=0 for reproducibility; or run 3x at T=0.7 and average |

---

### 3.3 — The reproducibility requirement

The BetterBench study found that 17/24 major benchmarks don't provide scripts to replicate their results. This is a scientific integrity problem. For Arena War:

- **Version-control everything** — lock algorithm code, game seed, grid size, player count, and prompt template per iteration run
- **Store raw results, not summaries** — keep every game's full grid snapshot and score, not just averages
- **Publish the full iteration transcript** — what prompt was sent, what code was returned, what score it got
- **Deterministic seeding** — `Math.random()` seeded with a fixed value per game, so any game can be exactly replicated

---

## Part 4: Measuring What You Actually Care About

### 4.1 — The learning curve is the signal

Standard benchmarks measure capability at a point in time. Arena War measures capability *as a function of feedback* — which is the more important question for evaluating LLMs as engineering tools.

The Meeseeks benchmark (iterative self-correction) and the CYCLE framework (self-refinement via test feedback) both demonstrate that the improvement rate per iteration is a richer capability signal than any single-shot score. Key findings:
- Most models plateau after 1–2 refinement steps
- Reasoning models (o3-mini, etc.) continue improving where non-reasoning models stall
- The slope of the improvement curve, not the starting point, predicts long-term utility

**What to track per iteration:**
1. `raw_score[i]` — territory % at iteration i
2. `improvement[i]` = `raw_score[i] - raw_score[i-1]` — marginal improvement
3. `cumulative_improvement[i]` = `raw_score[i] - raw_score[0]` — total improvement from baseline
4. `improvement_rate` = slope of linear regression over all iterations — the key comparison metric between models
5. `plateau_iteration` — iteration at which improvement drops below 2% — when does the model stop learning?
6. `peak_score` — maximum score achieved across all iterations

**The insight this unlocks:** Two models might reach the same final score, but one does it in 3 iterations and the other in 10. That's a meaningful capability difference that raw leaderboard scores hide entirely.

---

### 4.2 — Beyond territory %: the full metric suite for Arena War

**Primary metrics (always report):**
- Mean territory % per model per iteration (with CI)
- Improvement rate (slope of learning curve)
- Iterations to reach baseline+10% (speed-to-improvement)

**Secondary metrics (report in detailed results):**
- Tick count at game end — fast-converging algorithms vs. slow-converging ones
- Encirclement events — did the algorithm successfully trap an opponent? (shows strategic depth)
- Early-game territory at tick 10 vs. late-game territory — is the model good at opening, endgame, or both?
- Variance across games — high variance = brittle strategy, low variance = robust
- Territory shape compactness — a solid blob is harder to cut off than thin tendrils (can be measured as perimeter²/area)

**Meta-eval metrics (report across models):**
- Elo rating trajectory — how the model's rating evolves as it plays more games
- Code quality signals — does the generated algorithm run without errors? (pass rate)
- Code efficiency — does it run within the 50ms tick budget?
- Prompt sensitivity — how much does the improvement rate change with different prompt templates?

---

### 4.3 — Failure mode analysis is more informative than success metrics

METR's RE-Bench and the SEAS framework both emphasize that failure modes are harder to game than success metrics. For Arena War:

Document what *went wrong* in each iteration, not just what scored well:
- Did the model produce syntactically invalid code? (rate)
- Did the algorithm crash/throw mid-game? (rate)
- Did the algorithm exploit loopholes (e.g., claiming cells outside the circle) rather than improve strategy? (qualitative flag)
- Did the algorithm regress vs. prior iteration? (rate — surprisingly common)
- Did the model's reasoning in the prompt explanation predict its actual performance? (calibration check)

This creates a qualitative error taxonomy that's much harder to game than a percentage score, and much more informative about what capability the model actually has.

---

## Part 5: Benchmark Lifecycle and Saturation Resistance

### 5.1 — Design for longevity

The half-life of static benchmarks is shortening. GLUE saturated in ~18 months; the expectation is that most 2025-era benchmarks will saturate even faster as models scale. Three design principles for longevity:

**Continuous difficulty escalation** — Arena War's iterative structure naturally does this. Each iteration's baseline is stronger than the last. Document this explicitly: "the benchmark floor rises each iteration."

**Parametric complexity** — Your grid size (40/60/80) and player count (2–6) are knobs that increase difficulty. As models improve, raise the default grid size and player count. Report which configuration you used so results remain comparable.

**Held-out evaluation set** — Maintain a private set of "reference algorithms" that are never used as competitors during training iterations but are used to benchmark final performance. This gives you a stable yardstick even as the public leaderboard inflates.

---

### 5.2 — The living benchmark model

Stanford's HELM was explicitly designed as a "living benchmark" — continuously updated with new scenarios, metrics, and models. The principle: **benchmarks should have version numbers, changelogs, and deprecation policies just like software.**

For Arena War:
- Version every eval run (`arena-war-eval v0.1`, `v0.2`, etc.)
- Document what changed between versions (new baseline algorithms added, grid size changed, prompt template updated)
- Maintain backwards compatibility by keeping old baseline algorithms in the pool
- Publish a changelog with each version — what did this version change, and why?

---

## Part 6: Presentation and Credibility

### 6.1 — Transparency is a trust signal

The BetterBench study found that transparency scores were the weakest dimension across all evaluated benchmarks. The highest-credibility benchmarks share:

- All raw model prompts and completions (HELM does this)
- Full code for replication (SWE-Bench, LiveCodeBench)
- Detailed methodology writeups (not just results)
- Confidence intervals and statistical significance on all comparisons
- Explicit documentation of limitations and what the benchmark does NOT measure

For Arena War: publish the full `eval-results.json` with every run, including raw algorithm code returned by each model. This is a major credibility signal.

---

### 6.2 — Visual design for impact

A technically rigorous benchmark with bad visualization won't get adopted. The benchmarks that shaped the field — HELM's radar charts, Chatbot Arena's Elo leaderboard, SWE-Bench's waterfall charts — all had strong visual design.

**Key visuals to build for Arena War:**

1. **Learning curve chart** — X axis: iteration, Y axis: territory %, one line per model. This is the signature visual for the benchmark. Add shaded confidence bands.

2. **Elo trajectory** — X axis: cumulative games played, Y axis: Elo rating. Shows how each model's competitive strength evolves.

3. **Head-to-head matrix** — N×N grid showing win rate of model A against model B across all matchups. Immediately reveals which algorithms counter which.

4. **Live arena visualization** — (Already built.) This is the visual hook that makes the benchmark shareable. No other coding benchmark has this. Lean into it.

5. **Iteration replay viewer** — Show the algorithm code generated at each iteration alongside its arena replay. This tells the story of how the model "learned" — visually compelling for papers and demos.

6. **Failure taxonomy treemap** — Categorize and visualize where each model's algorithms failed (syntax error, runtime crash, strategic regression, loophole exploit). Shows depth of analysis.

---

### 6.3 — The credibility checklist

Before publishing, every serious benchmark should pass this checklist (adapted from BetterBench, Stanford HAI, and NIST AI 800-3):

**Design**
- [ ] Construct is clearly defined and distinguished from proxies
- [ ] Metrics are multi-dimensional (not single accuracy score)
- [ ] Difficulty is calibrated to avoid floor and ceiling effects
- [ ] Baseline algorithms represent the full range of strategies, not just easy ones

**Statistical rigor**
- [ ] N ≥ 5 games per model per configuration
- [ ] Confidence intervals reported on all key metrics
- [ ] Statistical significance test for any claimed improvement
- [ ] Variance decomposition (which sources of variance are controlled)

**Anti-gaming**
- [ ] Contamination is structurally prevented (for Arena War: inherently true)
- [ ] Multiple metrics used (harder to simultaneously optimize all)
- [ ] Held-out evaluation set that isn't used during training iterations
- [ ] Version-controlled with reproducible seeds

**Transparency**
- [ ] Raw results published (not just summaries)
- [ ] Methodology documented in enough detail to replicate
- [ ] Limitations section explicitly states what the benchmark does NOT measure
- [ ] Changelog maintained across versions

**Longevity**
- [ ] Difficulty can be increased as models improve (grid size, player count)
- [ ] New baseline algorithms can be added without invalidating old results
- [ ] Versioning system in place

---

## Part 7: Key References

### Must-read papers

| Paper | Why it matters |
|---|---|
| **Holistic Evaluation of Language Models (HELM)** — Liang et al., Stanford CRFM, 2022 | The canonical multi-metric benchmark framework. Multi-scenario, 7-metric approach. arXiv:2211.09110 |
| **BetterBench: Assessing AI Benchmarks, Uncovering Issues** — Stanford, 2024 | The most systematic audit of benchmark quality. 24 benchmarks scored on 46 criteria. arXiv:2411.12990 |
| **Measuring What Matters: Construct Validity in LLM Benchmarks** — 445-benchmark review, 2025 | 8 key recommendations for construct validity. openreview.net/forum?id=mdA5lVvNcU |
| **Measurement to Meaning: A Validity-Centered Framework** — Salaudeen et al., 2025 | Best framework for linking benchmark scores to real-world capability claims. arXiv:2505.10573 |
| **What Does Your Benchmark Really Measure?** — 2025 | Framework for robust inference. Proposes evaluation-as-inference; confidence intervals as mandatory. arXiv:2509.19590 |
| **SWE-Bench Pro** — Scale AI, 2025 | Gold standard for contamination prevention (3-tier held-out strategy). arXiv:2509.16941 |
| **Benchmarking LLMs Under Data Contamination** — survey, 2025 | Full survey of contamination types and mitigations. arXiv:2502.17521 |
| **Can We Trust AI Benchmarks?** — interdisciplinary review, 2025 | Best overview of Goodhart's Law in AI benchmarking. arXiv:2502.06559 |
| **RE-Bench** — METR, 2024 | Design principles for saturation-resistant benchmarks. metr.org/AI_R_D_Evaluation_Report.pdf |
| **Is Elo Rating Reliable?** — 2025 | Rigorous analysis of Elo for AI evaluation settings. arXiv:2502.10985 |
| **NIST AI 800-3** — 2026 | Government standard for statistical validity in AI evaluations. nist.gov |
| **CodeElo** — 2025 | Elo applied to competitive programming evaluation. Direct human comparison. emergentmind.com/topics/codeelo |

### Key frameworks to explore

- **Stanford HELM** — crfm.stanford.edu/helm — live benchmark, open source, good architecture to study
- **METR TaskDev / RE-Bench** — metr.org — how to build long-horizon agentic evaluations
- **BetterBench** — betterbench.stanford.edu — use their 46-criteria rubric to self-audit your benchmark
- **Chatbot Arena / LMSYS** — lmarena.ai — study their Elo implementation and pairwise comparison design
- **LiveCodeBench** — live.github.io/livecodebench — best example of contamination-resistant dynamic benchmark
- **SWE-Bench** — swebench.com — gold standard for coding agent evaluation methodology

---

## Part 8: How This Applies to Arena War

### What Arena War does right (structural advantages)

1. **Contamination-immune by design** — Generative benchmark; nothing to memorize
2. **Adversarial moving target** — The baseline rises each iteration; hard to game
3. **Multi-dimensional outputs** — Territory %, ticks, learning curve, variance all emerge naturally
4. **Executable ground truth** — Code either wins or it doesn't. No subjective scoring
5. **Visual hook** — Live arena replay makes it shareable and compelling

### What to add to make it rigorous

1. **Confidence intervals on all reported numbers** — Run ≥5 games, report mean ± std
2. **Learning curve as primary output** — The improvement rate per iteration, not just peak score, is the real finding
3. **Elo rating system** — Replace raw % with Elo across iterations and matchups
4. **Held-out reference algorithm set** — Algorithms never used as competitors but used to normalize results across runs
5. **Failure taxonomy** — Categorize and report what went wrong, not just what scored well
6. **Versioned eval runs with changelogs** — Treat the benchmark like software
7. **Statistical significance tests** — For any claimed improvement between models or iterations
8. **Explicit limitations section** — Arena War measures spatial reasoning and iterative code improvement under competition. It does not measure: general code quality, reasoning about non-spatial domains, multi-turn dialogue capability

### The claim Arena War can validly make

> *"This benchmark measures a model's ability to iteratively improve a spatial territory algorithm through adversarial competition feedback, as measured by territory capture rate and improvement rate across N iterations. A model that scores high on this benchmark can read existing code, identify strategic weaknesses, and write improved implementations that demonstrably outperform the code they analyzed."*

That's a clean, defensible, construct-valid claim. Don't overclaim — don't say it measures "general coding ability" or "reasoning." Say exactly what it measures, and it becomes a credible and cited benchmark.

---

## Part 9: Arena War Game Rules and Outcome Modes

The preceding sections are the abstract methodology framework we commit to. This section is the concrete specification of the game itself — the rules LLMs are asked to reason about, the exact scoring loop, and every way a game can end. Any claim made from Arena War scores has to be interpretable against this spec.

### 9.1 — The game in one paragraph

Arena War is a multi-player territorial expansion game played on a circular `N × N` grid. The eval-runner default and the `arena.html` default are both `N = 60` (2724 in-play cells out of 3600); the arena sandbox additionally offers `N = 40` (1184 in-play cells) and `N = 80` (4872 in-play cells). Each player controls a starting 3×3 "seed" patch placed evenly around an inner ring. On every tick, each player's algorithm is called with its player id, the current grid, and the grid size, and returns a *frontier* — a list of `[row, col]` candidate cells it wants to claim this tick. The engine enforces a per-tick **claim budget** of `max(1, floor(N/8))` cells per player — 7 cells/tick at the `N = 60` default (5 at `N = 40`, 10 at `N = 80`). Unclaimed cells inside the circular play mask are `EMPTY (-1)`; cells outside the mask are `null` and not playable. Cells that two or more players request on the same tick enter a **conflict state** and stay unclaimed. Territory is scored as `score[i] = count(grid[r][c] === i)`, and territory percentage is `score[i] / totalCells`, where `totalCells` counts all in-circle cells (owned + still EMPTY). The winner is the player with the highest territory percentage when the game ends.

### 9.2 — Outcome modes: how a game ends

Arena War has **three** distinct termination modes. Every reported game carries a `terminationReason` field (`schemaVersion >= 7`) so downstream consumers can distinguish them without inferring from tick count or score sum.

#### Mode 1 — `board_full` (the "clean win" case)

Every reachable in-circle cell has been claimed. `score[0] + score[1] + ... + score[n] === totalCells`. Territory percentages sum to ~100%. Typical of well-formed algorithms against each other on short-to-medium `tick` counts. Interpretation: the game reached its geometric ceiling; the winner filled more of the board than the other players before them. This is the ideal outcome for "how strong is the algorithm?" readings.

#### Mode 2 — `stalemate` (the "no-progress" case)

No player claimed any cell on the current tick. Every algorithm either returned an empty frontier, proposed only already-owned cells, or every proposed cell conflicted with another player and was discarded. The board ends with **visible unclaimed territory remaining** — often substantial (sometimes >50% of the board), and percentages summing to less than 100%. **This is not a bug or a display glitch.** It is a legitimate outcome of the game rules, and in adversarial play it is *the informative case* — stalemates signal that the strategies in play have reached a mutually-blocking configuration where no one can expand without conflicting with someone else. Interpretation: the winner is the player with the largest territory when progress stopped, even if that's 21% of the full board. Reading a stalemate as "bad result" is the wrong frame — it is a real competitive outcome, just a less decisive one than `board_full`.

Stalemates are most commonly caused by:

- **Algorithm exhaustion**: the algorithm's internal rules can't identify any more legal cells to claim (e.g. a BFS that only expands along already-discovered frontiers, after all adjacent EMPTY cells have been blocked off by opponents).
- **Mutual-block equilibrium**: all remaining EMPTY cells are equidistant from multiple players, so every claim attempt triggers a conflict and gets discarded.
- **Partitioned territory**: one player is completely walled off from any remaining EMPTY cells (no adjacency path), so its frontier is empty; the other players can still progress but may themselves get blocked later.

Stalemate frequency is an *informative metric per model*. A model whose algorithm reliably fills the board to `board_full` demonstrates geometric completion. A model whose algorithm stalemates at 20% territory might have a good opening but poor late-game. The dashboard surfaces this via the per-iteration "Termination mix" field (results.js).

#### Mode 3 — `max_ticks` (safety cap — should never fire)

The node eval harness (`eval-runner.js` `runGame()`) enforces `MAX_TICKS = size * size` as a runaway-protection bound. Under normal play, games terminate via `board_full` or `stalemate` well before this bound (a `60 × 60` game bounded at 3600 ticks will almost always finish within ~150–400). Observing `max_ticks` in production data is a signal that an algorithm is livelocking — e.g. it's proposing and re-proposing cells without ever making progress in a way that doesn't count as "no change" to the engine. Treat it as a bug to investigate, not a game outcome. The browser engine (`engine.js`) does *not* enforce a max-tick cap; in the sandbox, livelocking algorithms will simply run until the user stops them.

### 9.3 — Why a 21% winner at tick 145 with unclaimed territory is a legitimate result

Under Mode 2 (`stalemate`), the game ended because all four players' algorithms collectively stopped making progress. The winner (say Diagonal Spiral at 21%) controls the most territory at the moment of arrest. The remaining ~79% of the circle is split between (a) the other players' own territories, (b) conflict-induced permanent EMPTY cells, and (c) cells that no algorithm's frontier ever reached. All three are legitimate engine states. The UI should communicate this explicitly — the arena winner banner now reads `winner: X — 21% (stalemate at tick 145 — no player could make progress)` to distinguish it from a 21% win in a `board_full` game (which would be a decisive win in a very tight 4-way split) or a 21% lead at `max_ticks` (which would be a livelock bug).

This is downstream of the benchmark's construct claim from §1.1: we measure *iterative algorithmic reasoning under adversarial pressure*, not "maximum territory captured under idealized conditions." In adversarial play, stalemates are strong evidence that the environment is actually adversarial — if every game terminated at `board_full`, the arena would be too easy.

### 9.4 — Claim resolution rules, in full

The exact algorithm every tick, in order:

1. Each player's algorithm is called with `(playerId, gridCopy, size)` and returns a frontier array.
2. Engine walks the frontier for each player, accepting up to `claimsPerTick` candidates subject to: valid `[row, col]` with integers, inside the grid, `grid[r][c] === EMPTY`. Invalid candidates are silently discarded. Attempts to claim `null` cells (outside the circle) trigger the `EXPLOIT_DETECTED` failure flag.
3. If two or more players request the same cell on the same tick, the cell is flagged as a conflict and stays EMPTY for this tick and every future tick — *unless a single player eventually wins it uncontested on a later tick*.
4. All non-conflicted claims are applied atomically at the end of the tick.
5. `tick++`, check termination (Mode 1 first, then Mode 2).

The claims-per-tick budget is what makes the game iterative rather than one-shot. At `N = 60`, players can claim 7 cells/tick. A 2724-cell circle therefore needs at least `2724 / (7 × 4) ≈ 98` ticks to fill even with zero conflicts.

### 9.5 — What this means for LLM evaluation

Under §9.2, a model's score on Arena War is a composite of:

- *How efficiently its algorithm expands territory* (board_full rate, mean territory at board_full)
- *How robustly it handles adversarial opponents* (avoids livelock, recovers from partial blocks)
- *How well it performs under stalemate conditions* (largest share of territory at arrest-time)

A model whose algorithm has perfect opening but no endgame will score moderate territory at `stalemate` games and never hit `board_full`. A model with strong late-game but weak opening might hit `board_full` against weak opponents but stalemate at low percentages against strong ones. **The territory % alone cannot distinguish these profiles.** Only the joint distribution of `(terminationReason, pct, ticks)` can. The dashboard surfaces this joint distribution in the "Representative game" / "Termination mix" meta rows per iteration.

---

*Document version: 1.1 | Research period: 2022–April 2026 | Primary sources: 96 papers and frameworks*
*Changelog: v1.1 added Part 9 (Arena War Game Rules and Outcome Modes) to document the stalemate outcome mode explicitly and align with eval-runner schemaVersion 7 terminationReason field.*
