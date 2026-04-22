/**
 * eval-runner.js  (Node.js)
 *
 * Headless eval loop for Arena War.
 * This is the core evaluation harness for the benchmark-first workflow:
 *   1. Prompts one or more models with the same Arena War task
 *   2. Extracts the returned JS function
 *   3. Runs several headless games against shared baseline opponents
 *   4. Records learning curves, reward signals, and representative board states
 *   5. Feeds the best-so-far result back into later iterations
 *   6. Stops when the target iteration cap is reached or improvement plateaus
 *   7. Writes comparison-friendly output to eval-results.json
 *
 * Usage:
 *   node eval-runner.js --model claude-sonnet-4-20250514 --model gpt-4o --iterations 6 --games-per-iter 5
 *
 * Environment:
 *   ANTHROPIC_API_KEY must be set
 */

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { ALGOS, ALGO_NAMES } = require('./algorithms');
const { BASELINE_PROMPT, buildIterativePrompt } = require('./prompts');

// ─── Headless engine (copy of engine.js logic for Node) ──────────────────────
const EMPTY = -1;
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_ITERATIONS = 6;
const DEFAULT_GAMES_PER_ITER = 5;
const DEFAULT_GRID_SIZE = 60;
const DEFAULT_N_PLAYERS = 4;
const DEFAULT_PLATEAU_PATIENCE = 2;
const DEFAULT_PLATEAU_MIN_IMPROVEMENT = 1;

function buildMask(size) {
  const mask = [];
  const cx = size / 2, cy = size / 2, r = size / 2 - 0.5;
  for (let row = 0; row < size; row++) {
    mask.push([]);
    for (let col = 0; col < size; col++) {
      const dx = col + 0.5 - cx, dy = row + 0.5 - cy;
      mask[row].push(dx * dx + dy * dy <= r * r);
    }
  }
  return mask;
}

function createGrid(size, nPlayers, mask) {
  const grid = [];
  for (let r = 0; r < size; r++) {
    grid.push([]);
    for (let c = 0; c < size; c++)
      grid[r].push(mask[r][c] ? EMPTY : null);
  }
  const cx = Math.floor(size / 2), cy = Math.floor(size / 2);
  const seedRadius = Math.floor(size / 2) * 0.55;
  const angleStep = (2 * Math.PI) / nPlayers;
  for (let i = 0; i < nPlayers; i++) {
    const angle = angleStep * i - Math.PI / 2;
    const sr = Math.max(0, Math.min(size-1, Math.round(cx + seedRadius * Math.sin(angle))));
    const sc = Math.max(0, Math.min(size-1, Math.round(cy + seedRadius * Math.cos(angle))));
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1],[0,0],[-1,-1],[-1,1],[1,-1],[1,1]]) {
      const nr = sr + dr, nc = sc + dc;
      if (nr >= 0 && nr < size && nc >= 0 && nc < size && mask[nr][nc])
        grid[nr][nc] = i;
    }
  }
  return grid;
}

function runGame(size, algos, opts = {}) {
  const { captureFinalGrid = false } = opts;
  const nPlayers = algos.length;
  const mask = buildMask(size);
  const grid = createGrid(size, nPlayers, mask);
  const claimsPerTick = Math.max(1, Math.floor(size / 8));
  let tick = 0;
  const MAX_TICKS = size * size;

  while (tick < MAX_TICKS) {
    const claimMap = new Map();
    for (let i = 0; i < nPlayers; i++) {
      let frontier;
      try { frontier = algos[i](i, grid.map(r => [...r]), size); }
      catch { frontier = []; }
      if (!Array.isArray(frontier)) frontier = [];
      let claimed = 0;
      for (const cell of frontier) {
        if (claimed >= claimsPerTick) break;
        if (!Array.isArray(cell) || cell.length < 2) continue;
        const [r, c] = cell;
        if (r < 0 || r >= size || c < 0 || c >= size || grid[r][c] !== EMPTY) continue;
        const k = r * 10000 + c;
        if (!claimMap.has(k)) { claimMap.set(k, [r, c, i]); claimed++; }
        else if (claimMap.get(k)[2] !== i) claimMap.set(k, [r, c, -2]);
      }
    }
    let changed = 0;
    for (const [, [r, c, id]] of claimMap)
      if (id >= 0 && grid[r][c] === EMPTY) { grid[r][c] = id; changed++; }
    tick++;
    if (changed === 0) break;
    if (!grid.flat().includes(EMPTY)) break;
  }

  const scores = new Array(nPlayers).fill(0);
  let total = 0;
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++) {
      if (grid[r][c] === null) continue;
      total++;
      if (grid[r][c] >= 0) scores[grid[r][c]]++;
    }
  return {
    scores,
    totalCells: total,
    ticks: tick,
    finalGrid: captureFinalGrid ? grid.map(row => [...row]) : undefined,
  };
}

// ─── Algorithm loading ────────────────────────────────────────────────────────
function loadBaselineAlgos() {
  return ALGOS.map((fn, index) => ({
    name: ALGO_NAMES[index] || `Baseline ${index + 1}`,
    fn,
  }));
}

function extractFunction(rawCode) {
  // Strip markdown fences if the model wrapped its output
  const code = rawCode.replace(/```[a-z]*/gi, '').replace(/```/g, '').trim();
  const functionNameMatch = code.match(/function\s+([A-Za-z_$][\w$]*)\s*\(/);
  if (!functionNameMatch) {
    throw new Error('Could not find a named function in model output');
  }

  const functionName = functionNameMatch[1];

  // Evaluate and return the function without re-embedding the source in a
  // template literal, since model code often uses `${...}` internally.
  // eslint-disable-next-line no-new-func
  const fn = new Function('EMPTY', `
    "use strict";
    ${code}
    return typeof ${functionName} === 'function' ? ${functionName} : undefined;
  `)(EMPTY);
  if (typeof fn !== 'function') throw new Error('Could not extract function from model output');
  return fn;
}

function buildPromptFeedback({ iter, leaderboard, currentWinner, currentWinnerCode, currentWinnerName, gameHistory }) {
  if (iter === 1) {
    return {
      promptMode: 'baseline',
      rewardSignals: [],
      leaderboard: [],
      currentLeader: null,
      currentLeaderCode: null,
      recentHistory: [],
    };
  }

  return {
    promptMode: 'iterative',
    rewardSignals: ['leaderboard', 'winning_algorithm_source', 'recent_game_history'],
    leaderboard: leaderboard.slice(0, 5).map(entry => ({ ...entry })),
    currentLeader: {
      name: currentWinnerName,
      avgPct: currentWinner?.avgPct ?? 0,
      iter: currentWinner?.iter ?? null,
    },
    currentLeaderCode: currentWinnerCode,
    recentHistory: gameHistory.slice(-5).map(entry => ({ ...entry })),
  };
}

function pickRepresentativeGame(games, avgPct) {
  if (!games.length) return null;
  return games.reduce((best, game) => {
    const gameDelta = Math.abs(game.pct - avgPct);
    const bestDelta = Math.abs(best.pct - avgPct);
    return gameDelta < bestDelta ? game : best;
  });
}

function summarizeModelRun({ model, iterations, stopReason, maxIterations, plateauPatience, plateauMinImprovement, baselineOpponents }) {
  const successfulIterations = iterations.filter(iter => !iter.error);
  const learningCurve = successfulIterations.map(iter => ({
    iter: iter.iter,
    avgPct: iter.avgPct,
    avgTicks: iter.avgTicks,
  }));
  const bestIteration = successfulIterations.reduce((best, iter) => {
    if (!best || iter.avgPct > best.avgPct) return iter;
    return best;
  }, null);
  const lastIteration = successfulIterations[successfulIterations.length - 1] || null;

  return {
    model,
    iterationsCompleted: iterations.length,
    successfulIterations: successfulIterations.length,
    targetIterations: maxIterations,
    stoppedEarly: stopReason !== 'max_iterations_reached',
    stopReason,
    plateauPolicy: {
      patience: plateauPatience,
      minImprovementPct: plateauMinImprovement,
    },
    baselineOpponents,
    bestIteration: bestIteration ? {
      iter: bestIteration.iter,
      algoName: bestIteration.algoName,
      avgPct: bestIteration.avgPct,
      avgTicks: bestIteration.avgTicks,
      rawCode: bestIteration.rawCode,
    } : null,
    latestIteration: lastIteration ? {
      iter: lastIteration.iter,
      algoName: lastIteration.algoName,
      avgPct: lastIteration.avgPct,
      avgTicks: lastIteration.avgTicks,
    } : null,
    learningCurve,
    suggestedFollowOn: bestIteration ? {
      type: 'best_vs_best_replay',
      model,
      iter: bestIteration.iter,
      algoName: bestIteration.algoName,
    } : null,
  };
}

async function runModelEval({
  client,
  model,
  maxIterations,
  gamesPerIter,
  gridSize,
  nPlayers,
  plateauPatience,
  plateauMinImprovement,
  baselinePool,
}) {
  const baselineOpponents = baselinePool.slice(0, nPlayers - 1);
  const iterations = [];
  const leaderboard = [];
  const gameHistory = [];
  const baselineCode = baselineOpponents[0]?.fn?.toString() || '';

  let currentWinner = null;
  let currentWinnerCode = baselineCode;
  let currentWinnerName = baselineOpponents[0]?.name || 'Baseline';
  let plateauStreak = 0;
  let stopReason = 'max_iterations_reached';
  let lastSuccessfulAvgPct = null;

  console.log(`\n=== Benchmarking ${model} ===`);

  for (let iter = 1; iter <= maxIterations; iter++) {
    console.log(`\n--- ${model}: iteration ${iter}/${maxIterations} ---`);

    const promptFeedback = buildPromptFeedback({
      iter,
      leaderboard,
      currentWinner,
      currentWinnerCode,
      currentWinnerName,
      gameHistory,
    });

    const prompt = iter === 1
      ? BASELINE_PROMPT
      : buildIterativePrompt({
          iteration: iter,
          totalIterations: maxIterations,
          leaderboard,
          winnerName: currentWinnerName,
          winnerCode: currentWinnerCode,
          winnerPct: currentWinner?.avgPct ?? 0,
          gameHistory,
        });

    console.log(`Calling ${model}...`);
    const message = await client.messages.create({
      model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });
    const rawCode = message.content.find(block => block.type === 'text')?.text ?? '';

    let modelFn;
    try {
      modelFn = extractFunction(rawCode);
      console.log(`Extracted function: ${modelFn.name || '(anonymous)'}`);
    } catch (error) {
      console.error(`Failed to extract function: ${error.message}`);
      iterations.push({
        iter,
        promptMode: promptFeedback.promptMode,
        promptFeedback,
        error: error.message,
        rawCode,
      });
      plateauStreak++;
      if (plateauStreak >= plateauPatience) {
        stopReason = 'plateau_after_failed_iterations';
        break;
      }
      continue;
    }

    const gameRuns = [];
    for (let gameIndex = 0; gameIndex < gamesPerIter; gameIndex++) {
      const algos = [modelFn, ...baselineOpponents.map(entry => entry.fn)];
      const result = runGame(gridSize, algos, { captureFinalGrid: true });
      const pct = Math.round((result.scores[0] / result.totalCells) * 100);
      const winnerIndex = result.scores.indexOf(Math.max(...result.scores));
      gameRuns.push({
        gameNumber: gameIndex + 1,
        pct,
        ticks: result.ticks,
        scores: result.scores,
        totalCells: result.totalCells,
        winnerIndex,
        finalGrid: result.finalGrid,
      });
      console.log(`  Game ${gameIndex + 1}: ${pct}% in ${result.ticks} ticks`);
    }

    const avgPct = Math.round(gameRuns.reduce((sum, game) => sum + game.pct, 0) / gameRuns.length);
    const avgTicks = Math.round(gameRuns.reduce((sum, game) => sum + game.ticks, 0) / gameRuns.length);
    const algoName = modelFn.name || `${model.replace(/[^a-z0-9]+/gi, '_')}_iter_${iter}`;
    const representativeGame = pickRepresentativeGame(gameRuns, avgPct);
    const improvementFromLastIter = lastSuccessfulAvgPct === null ? null : avgPct - lastSuccessfulAvgPct;
    const improvementFromBestBeforeIter = currentWinner ? avgPct - currentWinner.avgPct : null;

    iterations.push({
      iter,
      promptMode: promptFeedback.promptMode,
      promptFeedback,
      algoName,
      rawCode,
      avgPct,
      avgTicks,
      improvementFromLastIter,
      improvementFromBestBeforeIter,
      baselineOpponents: baselineOpponents.map(entry => entry.name),
      games: gameRuns.map(({ finalGrid, ...rest }) => rest),
      representativeGame,
    });

    gameHistory.push({
      iter,
      algoName,
      avgPct,
      ticks: representativeGame?.ticks ?? avgTicks,
    });

    leaderboard.push({ name: algoName, avgPct, runs: gamesPerIter, iter });
    leaderboard.sort((a, b) => b.avgPct - a.avgPct);

    let meaningfulImprovement = false;
    if (!currentWinner || avgPct > currentWinner.avgPct) {
      const bestGain = currentWinner ? avgPct - currentWinner.avgPct : avgPct;
      meaningfulImprovement = bestGain >= plateauMinImprovement;
      currentWinner = { iter, avgPct, avgTicks, algoName };
      currentWinnerCode = rawCode;
      currentWinnerName = algoName;
      console.log(`  ★ New best so far: ${avgPct}%`);
    }

    plateauStreak = meaningfulImprovement ? 0 : plateauStreak + 1;
    lastSuccessfulAvgPct = avgPct;
    console.log(`  → Avg: ${avgPct}%`);

    if (plateauStreak >= plateauPatience && iter < maxIterations) {
      stopReason = 'plateau_reached';
      console.log(`  ↳ stopping early: no >= ${plateauMinImprovement}% best-score gain in ${plateauPatience} consecutive rounds`);
      break;
    }
  }

  return {
    model,
    baselineOpponents: baselineOpponents.map(entry => entry.name),
    summary: summarizeModelRun({
      model,
      iterations,
      stopReason,
      maxIterations,
      plateauPatience,
      plateauMinImprovement,
      baselineOpponents: baselineOpponents.map(entry => entry.name),
    }),
    iterations,
  };
}

// ─── Main eval loop ───────────────────────────────────────────────────────────
async function runEval(opts = {}) {
  const {
    model = DEFAULT_MODEL,
    models = [],
    maxIterations = DEFAULT_MAX_ITERATIONS,
    gamesPerIter = DEFAULT_GAMES_PER_ITER,
    gridSize = DEFAULT_GRID_SIZE,
    nPlayers = DEFAULT_N_PLAYERS,
    plateauPatience = DEFAULT_PLATEAU_PATIENCE,
    plateauMinImprovement = DEFAULT_PLATEAU_MIN_IMPROVEMENT,
    outputPath = path.join(__dirname, 'eval-results.json'),
  } = opts;

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required to run evals.');
  }

  const client = new Anthropic();
  const baselinePool = loadBaselineAlgos();
  const requestedModels = [...new Set(
    ((Array.isArray(models) && models.length) ? models : [model]).filter(Boolean)
  )];
  const benchmarkResults = {
    generatedAt: new Date().toISOString(),
    schemaVersion: 2,
    protocol: {
      comparisonMode: 'shared_protocol_benchmark',
      frontendPrimarySurface: 'results.html',
      gamesPerIter,
      maxIterations,
      gridSize,
      nPlayers,
      plateauPatience,
      plateauMinImprovement,
      rewardSignals: [
        'avg_territory_pct',
        'leaderboard_position',
        'winning_algorithm_source',
        'recent_game_history',
      ],
      baselineOpponents: baselinePool.slice(0, nPlayers - 1).map(entry => entry.name),
    },
    models: {},
    rankings: [],
  };

  for (const modelName of requestedModels) {
    benchmarkResults.models[modelName] = await runModelEval({
      client,
      model: modelName,
      maxIterations,
      gamesPerIter,
      gridSize,
      nPlayers,
      plateauPatience,
      plateauMinImprovement,
      baselinePool,
    });
  }

  benchmarkResults.rankings = Object.values(benchmarkResults.models)
    .map(result => ({
      model: result.model,
      bestAvgPct: result.summary.bestIteration?.avgPct ?? 0,
      bestIteration: result.summary.bestIteration?.iter ?? null,
      latestAvgPct: result.summary.latestIteration?.avgPct ?? 0,
      completedIterations: result.summary.successfulIterations,
      stopReason: result.summary.stopReason,
    }))
    .sort((a, b) => {
      if (b.bestAvgPct !== a.bestAvgPct) return b.bestAvgPct - a.bestAvgPct;
      return (a.bestIteration ?? Number.MAX_SAFE_INTEGER) - (b.bestIteration ?? Number.MAX_SAFE_INTEGER);
    });

  fs.writeFileSync(outputPath, JSON.stringify(benchmarkResults, null, 2));
  console.log(`\nResults written to ${outputPath}`);
  return benchmarkResults;
}

// CLI entry point
function parseCliArgs(argv) {
  const args = argv.slice(2);
  const values = {
    models: [],
    outputPath: path.join(__dirname, 'eval-results.json'),
  };

  const readValue = (index, flag) => {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--help':
        values.help = true;
        break;
      case '--model':
        values.models.push(readValue(i, arg));
        i++;
        break;
      case '--iterations':
        values.maxIterations = parseInt(readValue(i, arg), 10);
        i++;
        break;
      case '--games-per-iter':
        values.gamesPerIter = parseInt(readValue(i, arg), 10);
        i++;
        break;
      case '--grid-size':
        values.gridSize = parseInt(readValue(i, arg), 10);
        i++;
        break;
      case '--players':
        values.nPlayers = parseInt(readValue(i, arg), 10);
        i++;
        break;
      case '--plateau-patience':
        values.plateauPatience = parseInt(readValue(i, arg), 10);
        i++;
        break;
      case '--plateau-min-improvement':
        values.plateauMinImprovement = parseFloat(readValue(i, arg));
        i++;
        break;
      case '--output':
        values.outputPath = path.resolve(readValue(i, arg));
        i++;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!values.models.length) {
    values.models = [DEFAULT_MODEL];
  }

  return values;
}

function printHelp() {
  console.log(`
Arena War eval runner

Usage:
  node eval-runner.js --model claude-sonnet-4-20250514 --model gpt-4o

Options:
  --model <name>                    Repeat to benchmark multiple models
  --iterations <n>                 Target iterations per model (default: ${DEFAULT_MAX_ITERATIONS})
  --games-per-iter <n>             Headless games per iteration (default: ${DEFAULT_GAMES_PER_ITER})
  --grid-size <n>                  Arena grid size (default: ${DEFAULT_GRID_SIZE})
  --players <n>                    Players per game including the model (default: ${DEFAULT_N_PLAYERS})
  --plateau-patience <n>           Early-stop after this many flat rounds (default: ${DEFAULT_PLATEAU_PATIENCE})
  --plateau-min-improvement <pct>  Minimum best-score gain to reset plateau logic (default: ${DEFAULT_PLATEAU_MIN_IMPROVEMENT})
  --output <path>                  Output JSON path (default: eval-results.json)
  --help                           Show this help
`.trim());
}

if (require.main === module) {
  let cliOptions;
  try {
    cliOptions = parseCliArgs(process.argv);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  if (cliOptions.help) {
    printHelp();
    process.exit(0);
  }

  runEval({
    model: cliOptions.models[0],
    models: cliOptions.models,
    maxIterations: cliOptions.maxIterations,
    gamesPerIter: cliOptions.gamesPerIter,
    gridSize: cliOptions.gridSize,
    nPlayers: cliOptions.nPlayers,
    plateauPatience: cliOptions.plateauPatience,
    plateauMinImprovement: cliOptions.plateauMinImprovement,
    outputPath: cliOptions.outputPath,
  }).catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  runEval,
  runGame,
  runModelEval,
  parseCliArgs,
  extractFunction,
};
