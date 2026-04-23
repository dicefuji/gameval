/**
 * scripts/generate-fixture.js
 *
 * Generates a v0.3.0 eval-results.json fixture without calling any LLM.
 * Treats selected baseline algorithms as stand-ins for "model output" and
 * runs the full analysis pipeline (seeded games, stats, bootstrap pairwise,
 * Bradley-Terry ratings, head-to-head matrix, held-out reference benchmark).
 *
 * Intended for dashboard development and local visual verification.
 */

const fs = require('fs');
const path = require('path');

const {
  runGame,
  deriveGameSeed,
  computePairwiseComparisons,
  runHeadToHeadMatrix,
  runHeldOutReferenceBenchmark,
  computeBradleyTerryRatings,
} = require('../eval-runner');
const { ALGOS, ALGO_NAMES } = require('../algorithms');

const EVAL_VERSION = 'arena-war-eval-v0.3.1';
const RUN_SEED = 424242;
const GRID_SIZE = 40;
const N_PLAYERS = 4;
const GAMES_PER_ITER = 5;
const MAX_ITERATIONS = 5;

const BASELINE_NAMES = ALGO_NAMES.slice(0, N_PLAYERS - 1);
const BASELINE_POOL = ALGOS.slice(0, N_PLAYERS - 1).map((fn, i) => ({ name: ALGO_NAMES[i], fn }));

// Each "model" is really a sequence of built-in algorithms across iterations;
// the fixture pretends these are LLM-authored attempts.
const MODEL_FIXTURES = {
  'claude-sonnet-4-20250514': [ALGOS[1], ALGOS[2], ALGOS[4], ALGOS[4], ALGOS[5]],
  'gpt-4o':                   [ALGOS[0], ALGOS[6], ALGOS[2], ALGOS[4], ALGOS[2]],
  'o3-mini':                  [ALGOS[3], ALGOS[1], ALGOS[5], ALGOS[2], ALGOS[4]],
};

// Provider each fixture model would have been routed through in a real run.
// Kept in lockstep with MODEL_FIXTURES so the generated fixture matches the
// v0.3.1 schema (per-model provider field).
const MODEL_PROVIDERS = {
  'claude-sonnet-4-20250514': 'anthropic',
  'gpt-4o':                   'openai',
  'o3-mini':                  'openai',
};

function computeStats(pcts) {
  const n = pcts.length;
  const mean = pcts.reduce((a, b) => a + b, 0) / n;
  const variance = pcts.reduce((s, p) => s + (p - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const t = 2.0;
  return {
    meanPct: mean,
    stdPct: std,
    minPct: Math.min(...pcts),
    maxPct: Math.max(...pcts),
    ci95Low: mean - t * std / Math.sqrt(n),
    ci95High: mean + t * std / Math.sqrt(n),
    n,
  };
}

function pickRepresentative(games, avgPct) {
  if (!games.length) return null;
  return games.reduce((best, g) => (Math.abs(g.pct - avgPct) < Math.abs(best.pct - avgPct) ? g : best));
}

function simulateModel(modelKey, modelIdx) {
  const fixtures = MODEL_FIXTURES[modelKey];
  const iterations = [];
  let lastSuccessfulAvgPct = null;
  let currentWinner = null;
  let confirmedBest = null;

  for (let it = 0; it < fixtures.length; it++) {
    const iter = it + 1;
    // Synthetic syntax error partway through one model's run.
    if (modelKey === 'gpt-4o' && iter === 2) {
      iterations.push({
        iter,
        promptMode: 'iterative',
        error: 'Could not find a named function in model output',
        rawCode: '// mocked missing function',
        failureFlags: ['SYNTAX_ERROR'],
        plateauSignal: null,
      });
      continue;
    }
    const algo = fixtures[it];
    const algoName = algo.name || `${modelKey.replace(/[^a-z0-9]+/gi, '_')}_iter_${iter}`;
    const flags = new Set();
    const gameRuns = [];
    for (let g = 0; g < GAMES_PER_ITER; g++) {
      const seed = deriveGameSeed(RUN_SEED, modelIdx, iter, g);
      const algos = [algo, ...BASELINE_POOL.map(b => b.fn)];
      const out = runGame(GRID_SIZE, algos, { captureFinalGrid: g === 0, seed });
      (out.perPlayerFlags[0] || []).forEach(f => flags.add(f));
      const total = out.totalCells || 1;
      const pct = Math.round((out.scores[0] / total) * 100);
      const winnerIndex = out.scores.indexOf(Math.max(...out.scores));
      gameRuns.push({
        gameNumber: g + 1,
        seed,
        pct,
        ticks: out.ticks,
        scores: out.scores,
        totalCells: out.totalCells,
        winnerIndex,
        finalGrid: out.finalGrid,
      });
    }
    const pcts = gameRuns.map(g => g.pct);
    const stats = computeStats(pcts);
    const avgPct = Math.round(stats.meanPct);
    const avgTicks = Math.round(gameRuns.reduce((s, g) => s + g.ticks, 0) / gameRuns.length);
    const representative = pickRepresentative(gameRuns, avgPct);
    const improvementFromLastIter = lastSuccessfulAvgPct === null ? null : avgPct - lastSuccessfulAvgPct;
    const improvementFromBestBeforeIter = currentWinner ? avgPct - currentWinner.avgPct : null;
    if (lastSuccessfulAvgPct !== null && avgPct < lastSuccessfulAvgPct) flags.add('REGRESSION_VS_PRIOR');
    if (currentWinner && avgPct < currentWinner.avgPct) flags.add('REGRESSION_VS_BEST');

    // Plateau reasoning and prompt-context tracking are split into two gates
    // so that iterations scoring between confirmedBest and currentWinner still
    // get CI-evaluated. Gating plateau evaluation on currentWinner would
    // silently skip those iterations. This mirrors eval-runner.js.
    let plateauSignal = null;

    // Gate 1: plateau evaluation against confirmedBest.
    if (!confirmedBest) {
      plateauSignal = { rule: 'first_iteration', passed: true };
      confirmedBest = { iter, avgPct, avgTicks, algoName, stats };
    } else if (avgPct > confirmedBest.avgPct) {
      const ciOverlap = stats.ci95Low > confirmedBest.stats.ci95High;
      plateauSignal = {
        rule: 'ci_overlap',
        passed: ciOverlap,
        currentCi95Low: stats.ci95Low,
        bestCi95High: confirmedBest.stats.ci95High,
      };
      if (ciOverlap) confirmedBest = { iter, avgPct, avgTicks, algoName, stats };
    }

    // Gate 2: currentWinner tracks raw-pct best for prompt context.
    if (!currentWinner || avgPct > currentWinner.avgPct) {
      currentWinner = { iter, avgPct, avgTicks, algoName, stats };
    }

    iterations.push({
      iter,
      promptMode: iter === 1 ? 'baseline' : 'iterative',
      algoName,
      rawCode: algo.toString(),
      avgPct,
      avgTicks,
      stats,
      improvementFromLastIter,
      improvementFromBestBeforeIter,
      baselineOpponents: BASELINE_NAMES,
      games: gameRuns.map(({ finalGrid, ...rest }) => rest),
      representativeGame: representative,
      failureFlags: [...flags],
      plateauSignal,
    });
    lastSuccessfulAvgPct = avgPct;
  }

  const successful = iterations.filter(it => !it.error);
  const best = successful.reduce((b, it) => (!b || it.avgPct > b.avgPct ? it : b), null);
  const latest = successful[successful.length - 1];
  const learningCurve = successful.map(it => ({ iter: it.iter, avgPct: it.avgPct, avgTicks: it.avgTicks }));

  return {
    model: modelKey,
    provider: MODEL_PROVIDERS[modelKey],
    baselineOpponents: BASELINE_NAMES,
    summary: {
      model: modelKey,
      iterationsCompleted: iterations.length,
      successfulIterations: successful.length,
      targetIterations: MAX_ITERATIONS,
      stoppedEarly: false,
      stopReason: 'max_iterations_reached',
      plateauPolicy: { patience: 2, minImprovementPct: 1 },
      baselineOpponents: BASELINE_NAMES,
      bestIteration: best ? {
        iter: best.iter, algoName: best.algoName, avgPct: best.avgPct, avgTicks: best.avgTicks,
        stats: best.stats, rawCode: best.rawCode,
      } : null,
      latestIteration: latest ? {
        iter: latest.iter, algoName: latest.algoName, avgPct: latest.avgPct, avgTicks: latest.avgTicks,
        stats: latest.stats,
      } : null,
      learningCurve,
      suggestedFollowOn: best ? {
        type: 'best_vs_best_replay', model: modelKey, iter: best.iter, algoName: best.algoName,
      } : null,
    },
    iterations,
  };
}

function main() {
  const modelKeys = Object.keys(MODEL_FIXTURES);
  const modelsObj = {};
  modelKeys.forEach((mk, i) => { modelsObj[mk] = simulateModel(mk, i); });

  const benchmarkResults = {
    generatedAt: new Date().toISOString(),
    schemaVersion: 5,
    evalVersion: EVAL_VERSION,
    changelog: [
      'v0.3.1: Per-model provider pinning via --model name@provider; models[*].provider written to output (schemaVersion 5)',
      'v0.3.0: Reproducible run seed + per-game seeds in output, bootstrap pairwise comparison, CI-overlap plateau, Bradley-Terry ratings, real head-to-head matrix, held-out reference',
      'v0.2.0: Added failure taxonomy, OpenAI provider support, adversarial mode, statistical rigor',
      'v0.1.0: Initial eval harness with Anthropic-only, self-play mode',
    ],
    protocol: {
      comparisonMode: 'shared_protocol_benchmark',
      frontendPrimarySurface: 'results.html',
      evalVersion: EVAL_VERSION,
      mode: 'self-play',
      game: 'arena-war',
      gamesPerIter: GAMES_PER_ITER,
      maxIterations: MAX_ITERATIONS,
      gridSize: GRID_SIZE,
      nPlayers: N_PLAYERS,
      plateauPatience: 2,
      plateauMinImprovement: 1,
      plateauMode: 'ci_overlap',
      rewardSignals: ['avg_territory_pct', 'leaderboard_position', 'winning_algorithm_source', 'recent_game_history'],
      baselineOpponents: BASELINE_NAMES,
      seededRandomness: true,
      runSeed: RUN_SEED,
    },
    models: modelsObj,
    rankings: [],
  };

  benchmarkResults.pairwiseComparisons = computePairwiseComparisons(modelsObj, RUN_SEED);
  benchmarkResults.ratings = computeBradleyTerryRatings(modelsObj, RUN_SEED);
  benchmarkResults.headToHead = runHeadToHeadMatrix(modelsObj, BASELINE_POOL, {
    gridSize: GRID_SIZE,
    nPlayers: N_PLAYERS,
    gamesPerPair: GAMES_PER_ITER,
    runSeed: RUN_SEED,
    game: 'arena-war',
  });
  benchmarkResults.referenceBenchmark = runHeldOutReferenceBenchmark(modelsObj, BASELINE_POOL, {
    gridSize: GRID_SIZE,
    nPlayers: N_PLAYERS,
    gamesPerModel: GAMES_PER_ITER,
    runSeed: RUN_SEED,
  });
  benchmarkResults.rankings = Object.values(modelsObj)
    .map(result => ({
      model: result.model,
      bestAvgPct: result.summary.bestIteration?.avgPct ?? 0,
      bestIteration: result.summary.bestIteration?.iter ?? null,
      latestAvgPct: result.summary.latestIteration?.avgPct ?? 0,
      completedIterations: result.summary.successfulIterations,
      stopReason: result.summary.stopReason,
    }))
    .sort((a, b) => b.bestAvgPct - a.bestAvgPct);

  const outputPath = path.join(__dirname, '..', 'eval-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(benchmarkResults, null, 2));
  console.log(`Wrote ${outputPath}`);
  console.log(`Models: ${modelKeys.join(', ')}`);
  console.log(`Pairwise comparisons: ${benchmarkResults.pairwiseComparisons.length}`);
  console.log(`Head-to-head pairs: ${benchmarkResults.headToHead.pairs.length}`);
  console.log(`Reference benchmark entries: ${benchmarkResults.referenceBenchmark.entries.length}`);
  console.log(`Ratings entries: ${benchmarkResults.ratings.entries.length}`);
}

main();
