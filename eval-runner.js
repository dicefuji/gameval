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
 *   ANTHROPIC_API_KEY must be set for anthropic provider
 *   OPENAI_API_KEY must be set for openai provider
 */

const fs = require('fs');
const path = require('path');
const { ALGOS, ALGO_NAMES } = require('./algorithms');
const { REFERENCE: HELD_OUT_REFERENCE, REFERENCE_NAME: HELD_OUT_REFERENCE_NAME } = require('./reference-algorithms');
const { BASELINE_PROMPT, buildIterativePrompt, buildAdversarialPrompt } = require('./prompts');
const { callModel, validateProvider } = require('./providers');

// ─── Headless engine (copy of engine.js logic for Node) ──────────────────────
const EMPTY = -1;
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_PROVIDER = 'anthropic';
const DEFAULT_MAX_ITERATIONS = 6;
const DEFAULT_GAMES_PER_ITER = 5;
const DEFAULT_GRID_SIZE = 60;
const DEFAULT_N_PLAYERS = 4;
const DEFAULT_PLATEAU_PATIENCE = 2;
const DEFAULT_PLATEAU_MIN_IMPROVEMENT = 1;
const DEFAULT_PLATEAU_MODE = 'ci_overlap';
const DEFAULT_MODE = 'self-play';
const DEFAULT_GAME = 'arena-war';

const EVAL_VERSION = 'arena-war-eval-v0.3.0';
const CHANGELOG = [
  'v0.3.0: Reproducible run seed + per-game seeds in output, bootstrap pairwise comparison, CI-overlap plateau, Bradley-Terry ratings, real head-to-head matrix, held-out reference',
  'v0.2.0: Added failure taxonomy, OpenAI provider support, adversarial mode, statistical rigor',
  'v0.1.0: Initial eval harness with Anthropic-only, self-play mode',
];

// Mix three small integers into a single deterministic 31-bit seed. Keeps
// game-level seeds well-separated even when the inputs share digits.
function deriveGameSeed(runSeed, modelIndex, iter, gameIndex) {
  const a = (runSeed ^ 0x9e3779b1) >>> 0;
  const b = ((modelIndex + 1) * 2654435761) >>> 0;
  const c = ((iter + 1) * 40503) >>> 0;
  const d = ((gameIndex + 1) * 2246822519) >>> 0;
  const mixed = (a ^ b ^ c ^ d) >>> 0;
  // LCG needs a non-zero seed; clamp to the 1..2147483646 range.
  return (mixed % 2147483646) + 1;
}

function seededRandom(seed) {
  // Simple LCG: returns a function that generates [0,1) floats deterministically
  let s = seed || 1;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

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

function createGrid(size, nPlayers, mask, rng) {
  const grid = [];
  for (let r = 0; r < size; r++) {
    grid.push([]);
    for (let c = 0; c < size; c++)
      grid[r].push(mask[r][c] ? EMPTY : null);
  }
  const cx = Math.floor(size / 2), cy = Math.floor(size / 2);
  const baseRadius = Math.floor(size / 2);
  // Wider radius band + stronger angle jitter so different seeds actually
  // produce distinct starting configurations after rounding to grid cells.
  const seedRadius = rng
    ? baseRadius * (0.45 + rng() * 0.30)
    : baseRadius * 0.55;
  const angleStep = (2 * Math.PI) / nPlayers;
  const angleJitterMax = angleStep * 0.35;

  // Permute which player index occupies which seat so the same baseline
  // algorithm can start from different positions across seeded runs.
  const seatOrder = Array.from({ length: nPlayers }, (_, i) => i);
  if (rng) {
    for (let i = seatOrder.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [seatOrder[i], seatOrder[j]] = [seatOrder[j], seatOrder[i]];
    }
  }

  for (let seat = 0; seat < nPlayers; seat++) {
    const playerId = seatOrder[seat];
    const angle = rng
      ? angleStep * seat - Math.PI / 2 + (rng() - 0.5) * 2 * angleJitterMax
      : angleStep * seat - Math.PI / 2;
    const sr = Math.max(0, Math.min(size-1, Math.round(cx + seedRadius * Math.sin(angle))));
    const sc = Math.max(0, Math.min(size-1, Math.round(cy + seedRadius * Math.cos(angle))));
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1],[0,0],[-1,-1],[-1,1],[1,-1],[1,1]]) {
      const nr = sr + dr, nc = sc + dc;
      if (nr >= 0 && nr < size && nc >= 0 && nc < size && mask[nr][nc])
        grid[nr][nc] = playerId;
    }
  }
  return grid;
}

function runGame(size, algos, opts = {}) {
  const { captureFinalGrid = false, seed } = opts;
  const nPlayers = algos.length;
  const mask = buildMask(size);
  const rng = seed !== undefined ? seededRandom(seed) : null;
  const grid = createGrid(size, nPlayers, mask, rng);
  const claimsPerTick = Math.max(1, Math.floor(size / 8));
  let tick = 0;
  const MAX_TICKS = size * size;
  const perPlayerFlags = Array.from({ length: nPlayers }, () => new Set());

  while (tick < MAX_TICKS) {
    const claimMap = new Map();
    for (let i = 0; i < nPlayers; i++) {
      let frontier;
      let tickCrashed = false;
      const t0 = Date.now();
      try { frontier = algos[i](i, grid.map(r => [...r]), size); }
      catch { frontier = []; tickCrashed = true; }
      if (tickCrashed) perPlayerFlags[i].add('RUNTIME_CRASH');
      if (Date.now() - t0 > 50) perPlayerFlags[i].add('TIMEOUT');
      if (!Array.isArray(frontier)) frontier = [];
      let claimed = 0;
      for (const cell of frontier) {
        if (claimed >= claimsPerTick) break;
        if (!Array.isArray(cell) || cell.length < 2) continue;
        const [r, c] = cell;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        // Cells outside the circular play mask are `null`; any attempt to claim
        // one is an out-of-bounds move the algorithm should never emit.
        if (grid[r][c] === null) {
          perPlayerFlags[i].add('EXPLOIT_DETECTED');
          continue;
        }
        if (grid[r][c] !== EMPTY) continue;
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
    perPlayerFlags: perPlayerFlags.map(set => [...set]),
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

function computeStats(pcts) {
  const n = pcts.length;
  const mean = pcts.reduce((a, b) => a + b, 0) / n;
  const variance = pcts.reduce((sum, p) => sum + (p - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  // Conservative t-multiplier for small samples (3-5 games)
  const tMultiplier = 2.0;
  const ci95Low = mean - tMultiplier * std / Math.sqrt(n);
  const ci95High = mean + tMultiplier * std / Math.sqrt(n);
  const minPct = Math.min(...pcts);
  const maxPct = Math.max(...pcts);
  return { meanPct: mean, stdPct: std, minPct, maxPct, ci95Low, ci95High, n };
}

// Bootstrap 95% CI on the difference of means between two pct samples.
// Uses a deterministic LCG so re-runs of the same eval produce the same CI.
function bootstrapDiffCI(pctsA, pctsB, { iterations = 4000, alpha = 0.05, seed = 1 } = {}) {
  if (!pctsA || !pctsB || pctsA.length === 0 || pctsB.length === 0) return null;
  const rng = seededRandom(seed);
  const nA = pctsA.length, nB = pctsB.length;
  const diffs = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    let sa = 0, sb = 0;
    for (let j = 0; j < nA; j++) sa += pctsA[Math.floor(rng() * nA)];
    for (let j = 0; j < nB; j++) sb += pctsB[Math.floor(rng() * nB)];
    diffs[i] = sa / nA - sb / nB;
  }
  diffs.sort((x, y) => x - y);
  const lowIdx = Math.max(0, Math.floor(alpha / 2 * iterations));
  const highIdx = Math.min(iterations - 1, Math.floor((1 - alpha / 2) * iterations));
  const meanA = pctsA.reduce((a, b) => a + b, 0) / nA;
  const meanB = pctsB.reduce((a, b) => a + b, 0) / nB;
  const meanDelta = meanA - meanB;
  const ciLow = diffs[lowIdx];
  const ciHigh = diffs[highIdx];
  const significant = ciLow > 0 || ciHigh < 0;
  return {
    meanDelta,
    ciLow,
    ciHigh,
    significant,
    method: 'bootstrap_mean_diff',
    bootstrapIterations: iterations,
    alpha,
    nA,
    nB,
  };
}

// Fit Bradley-Terry ratings via the Minorization-Maximization update:
//   r_i_new = W_i / sum_{j != i} (N_ij / (r_i + r_j))
// where W_i is i's total pairwise wins (draws count as 0.5) and N_ij is
// the number of pairings between i and j. Converts to an Elo-like scale
// (400 * log10) anchored so the mean rating equals 1000.
function fitBradleyTerry(wins, games, { maxIter = 500, tol = 1e-7 } = {}) {
  const players = Object.keys(wins);
  if (players.length < 2) return { ratings: {}, convergedIn: 0, converged: true };
  const W = Object.fromEntries(players.map(p => [p, Object.values(wins[p]).reduce((s, v) => s + v, 0)]));
  let r = Object.fromEntries(players.map(p => [p, 1]));

  let iter = 0;
  let converged = false;
  for (; iter < maxIter; iter++) {
    const rNew = {};
    for (const i of players) {
      let denom = 0;
      for (const j of players) {
        if (i === j) continue;
        const nij = (games[i]?.[j] || 0);
        if (nij === 0) continue;
        denom += nij / (r[i] + r[j]);
      }
      rNew[i] = denom > 0 ? (W[i] || 0) / denom : r[i];
      if (!Number.isFinite(rNew[i]) || rNew[i] <= 0) rNew[i] = 1e-6;
    }
    // Normalize so the geometric mean of ratings is 1.
    const logSum = players.reduce((s, p) => s + Math.log(rNew[p]), 0);
    const logGm = logSum / players.length;
    const scale = Math.exp(-logGm);
    for (const p of players) rNew[p] *= scale;

    let maxDelta = 0;
    for (const p of players) maxDelta = Math.max(maxDelta, Math.abs(rNew[p] - r[p]));
    r = rNew;
    if (maxDelta < tol) { converged = true; iter++; break; }
  }

  // Elo: 400 * log10(r) + 1000 anchor (r-geomean is already 1 → 1000 baseline).
  const elo = Object.fromEntries(players.map(p => [p, 1000 + 400 * Math.log10(r[p])]));
  return { ratings: r, elo, convergedIn: iter, converged };
}

// Extract pairwise win/loss records from every iteration's games.
// Slot 0 is the model (tracked by model key); slots 1..N-1 are baselines
// (tracked by their canonical names). Draws count as 0.5 wins to each side.
function computeBradleyTerryRatings(modelsObj, runSeed) {
  const wins = {};
  const games = {};

  const ensure = (name) => {
    if (!wins[name]) { wins[name] = {}; games[name] = {}; }
  };
  const addResult = (winner, loser, wVal = 1) => {
    ensure(winner); ensure(loser);
    wins[winner][loser] = (wins[winner][loser] || 0) + wVal;
    games[winner][loser] = (games[winner][loser] || 0) + 1;
    games[loser][winner] = (games[loser][winner] || 0) + 1;
    if (!wins[loser][winner]) wins[loser][winner] = 0;
  };

  for (const [modelKey, result] of Object.entries(modelsObj)) {
    const baselineNames = (result.baselineOpponents || []);
    const iterations = result.iterations || [];
    for (const iter of iterations) {
      if (!Array.isArray(iter.games)) continue;
      const participants = [modelKey, ...baselineNames];
      for (const g of iter.games) {
        if (!Array.isArray(g.scores) || g.scores.length !== participants.length) continue;
        for (let i = 0; i < participants.length; i++) {
          for (let j = i + 1; j < participants.length; j++) {
            const pi = participants[i], pj = participants[j];
            const si = g.scores[i], sj = g.scores[j];
            if (!Number.isFinite(si) || !Number.isFinite(sj)) continue;
            if (si > sj) addResult(pi, pj, 1);
            else if (sj > si) addResult(pj, pi, 1);
            else {
              addResult(pi, pj, 0.5);
              // Counter-side half-win; addResult above already records game.
              wins[pj][pi] = (wins[pj][pi] || 0) + 0.5;
            }
          }
        }
      }
    }
  }

  // Laplace smoothing: one phantom tie between every unordered pair of
  // players. Prevents degenerate zero-win cases from dragging Elo to -inf
  // and helps the MM iterations converge when sample sizes are tiny.
  const allPlayers = Object.keys(wins);
  for (let i = 0; i < allPlayers.length; i++) {
    for (let j = i + 1; j < allPlayers.length; j++) {
      const pi = allPlayers[i], pj = allPlayers[j];
      wins[pi][pj] = (wins[pi][pj] || 0) + 0.5;
      wins[pj][pi] = (wins[pj][pi] || 0) + 0.5;
      games[pi][pj] = (games[pi][pj] || 0) + 1;
      games[pj][pi] = (games[pj][pi] || 0) + 1;
    }
  }

  const fit = fitBradleyTerry(wins, games);
  const modelKeys = new Set(Object.keys(modelsObj));
  const entries = Object.keys(fit.ratings || {}).map(player => {
    const totalGames = Object.values(games[player] || {}).reduce((s, v) => s + v, 0);
    const totalWins = Object.values(wins[player] || {}).reduce((s, v) => s + v, 0);
    const elo = fit.elo?.[player];
    return {
      player,
      kind: modelKeys.has(player) ? 'model' : 'baseline',
      btScore: fit.ratings[player],
      elo: Number.isFinite(elo) ? Math.round(elo * 10) / 10 : null,
      games: totalGames,
      wins: totalWins,
      draws: Object.values(wins[player] || {}).filter(v => v !== Math.floor(v)).length,
    };
  }).sort((a, b) => (b.elo ?? -Infinity) - (a.elo ?? -Infinity));

  return {
    method: 'bradley_terry_mm',
    entries,
    convergedIn: fit.convergedIn,
    converged: fit.converged,
    runSeed,
  };
}

// Score each model's best algorithm against the held-out reference in a
// dedicated set of seeded games. The reference source is never exposed in
// prompts or the output JSON -- only its name and the per-model outcome are
// published. This provides a cross-version anchor that's independent of the
// shifting baseline pool or model fleet.
function runHeldOutReferenceBenchmark(modelsObj, baselinePool, { gridSize, nPlayers, gamesPerModel, runSeed }) {
  const entries = Object.entries(modelsObj)
    .map(([model, result]) => {
      const best = result?.summary?.bestIteration;
      if (!best?.rawCode) return null;
      try {
        const fn = extractFunction(best.rawCode);
        return { model, fn, iter: best.iter, algoName: best.algoName, bestAvgPct: best.avgPct };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (entries.length === 0) {
    return {
      referenceName: HELD_OUT_REFERENCE_NAME,
      note: 'Reference source held out of all prompts and outputs.',
      gamesPerModel,
      entries: [],
    };
  }

  const fillerBaselines = baselinePool.slice(0, Math.max(0, nPlayers - 2)).map(b => b.fn);
  const results = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const games = [];
    for (let g = 0; g < gamesPerModel; g++) {
      const seed = ((runSeed ^ ((i + 1) * 2246822519)) ^ ((g + 1) * 40503) ^ 0x13579bdf) >>> 0 || 1;
      const algos = [entry.fn, HELD_OUT_REFERENCE, ...fillerBaselines];
      let outcome;
      try {
        outcome = runGame(gridSize, algos, { captureFinalGrid: false, seed });
      } catch {
        continue;
      }
      const total = outcome.totalCells || 1;
      const pctModel = Math.round((outcome.scores[0] / total) * 100);
      const pctRef = Math.round((outcome.scores[1] / total) * 100);
      games.push({ seed, pctModel, pctReference: pctRef, scores: outcome.scores, ticks: outcome.ticks });
    }
    if (games.length === 0) continue;
    const modelPcts = games.map(g => g.pctModel);
    const refPcts = games.map(g => g.pctReference);
    const wins = modelPcts.filter((pm, idx) => pm > refPcts[idx]).length;
    const ciSeed = ((runSeed ^ ((i + 1) * 2971215073)) ^ 0xabcdef01) >>> 0 || 1;
    const ci = bootstrapDiffCI(modelPcts, refPcts, { seed: ciSeed });
    let verdict = 'tied';
    if (ci?.significant) verdict = ci.meanDelta > 0 ? 'model_better' : 'reference_better';
    results.push({
      model: entry.model,
      iter: entry.iter,
      algoName: entry.algoName,
      gamesPlayed: games.length,
      winsVsReference: wins,
      modelMeanPct: Math.round(modelPcts.reduce((a, b) => a + b, 0) / modelPcts.length * 10) / 10,
      referenceMeanPct: Math.round(refPcts.reduce((a, b) => a + b, 0) / refPcts.length * 10) / 10,
      meanDelta: ci?.meanDelta ?? null,
      ciLow: ci?.ciLow ?? null,
      ciHigh: ci?.ciHigh ?? null,
      significant: ci?.significant ?? false,
      verdict,
      games,
    });
  }

  return {
    referenceName: HELD_OUT_REFERENCE_NAME,
    note: 'Reference source is held out of all prompts and eval-results.json.',
    gamesPerModel,
    entries: results,
  };
}

// Run best-vs-best head-to-head games between every pair of models and
// summarize the matrix for the dashboard. Slots 0/1 are the two model
// algorithms; remaining slots are filled from the shared baseline pool so
// the opponent mix is identical across pairs.
function runHeadToHeadMatrix(modelsObj, baselinePool, { gridSize, nPlayers, gamesPerPair, runSeed, game }) {
  const entries = Object.entries(modelsObj)
    .map(([model, result]) => {
      const best = result?.summary?.bestIteration;
      if (!best?.rawCode) return null;
      try {
        const fn = extractFunction(best.rawCode);
        return { model, fn, iter: best.iter, bestAvgPct: best.avgPct, algoName: best.algoName };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (entries.length < 2) return { entries: entries.map(e => ({ model: e.model, iter: e.iter })), pairs: [] };

  const baselineFns = baselinePool.slice(0, Math.max(0, nPlayers - 2)).map(b => b.fn);
  const pairs = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      const gameRecords = [];
      for (let g = 0; g < gamesPerPair; g++) {
        // Deterministic seed per (pair, game).
        const pairSeed = ((runSeed ^ ((i + 1) * 374761393)) ^ ((j + 1) * 668265263) ^ ((g + 1) * 40503)) >>> 0 || 1;
        const algos = [a.fn, b.fn, ...baselineFns];
        let result;
        try {
          result = runGame(gridSize, algos, { captureFinalGrid: false, seed: pairSeed });
        } catch {
          continue;
        }
        const total = result.totalCells || 1;
        const pctA = Math.round((result.scores[0] / total) * 100);
        const pctB = Math.round((result.scores[1] / total) * 100);
        gameRecords.push({ seed: pairSeed, pctA, pctB, scores: result.scores, ticks: result.ticks });
      }
      if (gameRecords.length === 0) continue;
      const pctsA = gameRecords.map(r => r.pctA);
      const pctsB = gameRecords.map(r => r.pctB);
      const meanA = pctsA.reduce((x, y) => x + y, 0) / pctsA.length;
      const meanB = pctsB.reduce((x, y) => x + y, 0) / pctsB.length;
      const winsA = pctsA.filter((pa, idx) => pa > pctsB[idx]).length;
      const winsB = pctsB.filter((pb, idx) => pb > pctsA[idx]).length;
      const draws = gameRecords.length - winsA - winsB;
      const ciSeed = ((runSeed ^ ((i + 1) * 1013904223)) ^ ((j + 1) * 1664525)) >>> 0 || 1;
      const ci = bootstrapDiffCI(pctsA, pctsB, { seed: ciSeed });
      let verdict = 'tied';
      if (ci?.significant) verdict = ci.meanDelta > 0 ? 'a_better' : 'b_better';
      pairs.push({
        modelA: a.model,
        modelB: b.model,
        iterA: a.iter,
        iterB: b.iter,
        gamesPlayed: gameRecords.length,
        winsA, winsB, draws,
        meanPctA: Math.round(meanA * 10) / 10,
        meanPctB: Math.round(meanB * 10) / 10,
        meanDelta: ci?.meanDelta ?? (meanA - meanB),
        ciLow: ci?.ciLow ?? null,
        ciHigh: ci?.ciHigh ?? null,
        significant: ci?.significant ?? false,
        verdict,
        games: gameRecords,
      });
    }
  }

  return {
    entries: entries.map(e => ({ model: e.model, iter: e.iter, algoName: e.algoName, bestAvgPct: e.bestAvgPct })),
    pairs,
    config: { gridSize, nPlayers, gamesPerPair, game },
  };
}

// Collect best-iteration pct samples per model, then run bootstrap over every
// unordered pair. Produces stable "significantly better" verdicts the dashboard
// can show without redoing stats client-side.
function computePairwiseComparisons(modelsObj, runSeed) {
  const entries = Object.entries(modelsObj)
    .map(([model, result]) => {
      const best = result?.summary?.bestIteration;
      if (!best) return null;
      const iter = (result.iterations || []).find(it => it.iter === best.iter);
      const pcts = iter && Array.isArray(iter.games) ? iter.games.map(g => g.pct).filter(Number.isFinite) : [];
      if (pcts.length === 0) return null;
      return { model, pcts, meanPct: best.avgPct, iter: best.iter };
    })
    .filter(Boolean);

  const pairs = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      const pairSeed = ((runSeed ^ ((i + 1) * 1315423911)) ^ ((j + 1) * 2654435761)) >>> 0 || 1;
      const ci = bootstrapDiffCI(a.pcts, b.pcts, { seed: pairSeed });
      if (!ci) continue;
      let verdict;
      if (ci.significant) {
        verdict = ci.meanDelta > 0 ? 'a_better' : 'b_better';
      } else {
        verdict = 'tied';
      }
      pairs.push({
        modelA: a.model,
        modelB: b.model,
        iterA: a.iter,
        iterB: b.iter,
        meanA: a.meanPct,
        meanB: b.meanPct,
        ...ci,
        verdict,
      });
    }
  }
  return pairs;
}

function createInitialState(baselineOpponents) {
  const baselineCode = baselineOpponents[0]?.fn?.toString() || '';
  return {
    iterations: [],
    leaderboard: [],
    gameHistory: [],
    currentWinner: null,
    currentWinnerCode: baselineCode,
    currentWinnerName: baselineOpponents[0]?.name || 'Baseline',
    plateauStreak: 0,
    stopReason: 'max_iterations_reached',
    lastSuccessfulAvgPct: null,
    stopped: false,
  };
}

function collectTopOpponentAlgos(states, currentModel, maxOpponents = 2) {
  const opponentEntries = [];
  for (const [modelName, state] of Object.entries(states)) {
    if (modelName === currentModel) continue;
    const successfulIters = state.iterations.filter(it => !it.error);
    if (!successfulIters.length) continue;
    const bestIter = successfulIters.reduce((best, it) =>
      (!best || it.avgPct > best.avgPct) ? it : best, null);
    if (bestIter) {
      opponentEntries.push({
        name: `Opponent ${String.fromCharCode(65 + opponentEntries.length)}`,
        code: bestIter.rawCode,
        avgPct: bestIter.avgPct,
      });
      if (opponentEntries.length >= maxOpponents) break;
    }
  }
  return opponentEntries;
}

async function runSingleIteration({
  provider,
  model,
  iter,
  maxIterations,
  gamesPerIter,
  gridSize,
  nPlayers,
  baselineOpponents,
  mode,
  opponentAlgos,
  currentState,
  modelIndex,
  runSeed,
  plateauPatience = DEFAULT_PLATEAU_PATIENCE,
  plateauMinImprovement = DEFAULT_PLATEAU_MIN_IMPROVEMENT,
  plateauMode = DEFAULT_PLATEAU_MODE,
}) {
  const state = { ...currentState };
  const {
    leaderboard, gameHistory,
    currentWinner, currentWinnerCode, currentWinnerName,
    plateauStreak, lastSuccessfulAvgPct,
  } = state;

  const promptFeedback = buildPromptFeedback({
    iter,
    leaderboard,
    currentWinner,
    currentWinnerCode,
    currentWinnerName,
    gameHistory,
  });

  let prompt;
  if (iter === 1) {
    prompt = BASELINE_PROMPT;
  } else if (mode === 'adversarial' && opponentAlgos?.length > 0) {
    prompt = buildAdversarialPrompt({
      iteration: iter,
      totalIterations: maxIterations,
      leaderboard,
      winnerName: currentWinnerName,
      winnerCode: currentWinnerCode,
      winnerPct: currentWinner?.avgPct ?? 0,
      gameHistory,
      opponentAlgos,
    });
  } else {
    prompt = buildIterativePrompt({
      iteration: iter,
      totalIterations: maxIterations,
      leaderboard,
      winnerName: currentWinnerName,
      winnerCode: currentWinnerCode,
      winnerPct: currentWinner?.avgPct ?? 0,
      gameHistory,
    });
  }

  console.log(`Calling ${provider}/${model}...`);
  const { text: rawCode } = await callModel(provider, model, prompt, 2048);

  let modelFn;
  try {
    modelFn = extractFunction(rawCode);
    console.log(`Extracted function: ${modelFn.name || '(anonymous)'}`);
  } catch (error) {
    console.error(`Failed to extract function: ${error.message}`);
    const iterationResult = {
      iter,
      promptMode: promptFeedback.promptMode,
      promptFeedback,
      error: error.message,
      rawCode,
      failureFlags: ['SYNTAX_ERROR'],
    };
    console.log(`  \u26A0 Failure flags: SYNTAX_ERROR`);
    state.plateauStreak = plateauStreak + 1;
    if (state.plateauStreak >= plateauPatience) {
      state.stopped = true;
      state.stopReason = 'plateau_after_failed_iterations';
    }
    return { iterationResult, updatedState: state };
  }

  const flags = new Set();
  const gameRuns = [];
  for (let gameIndex = 0; gameIndex < gamesPerIter; gameIndex++) {
    const algos = [modelFn, ...baselineOpponents.map(entry => entry.fn)];
    const seed = deriveGameSeed(runSeed, modelIndex, iter, gameIndex);
    const result = runGame(gridSize, algos, { captureFinalGrid: true, seed });
    (result.perPlayerFlags[0] || []).forEach(f => flags.add(f));
    const pct = Math.round((result.scores[0] / result.totalCells) * 100);
    const winnerIndex = result.scores.indexOf(Math.max(...result.scores));
    gameRuns.push({
      gameNumber: gameIndex + 1,
      seed,
      pct,
      ticks: result.ticks,
      scores: result.scores,
      totalCells: result.totalCells,
      winnerIndex,
      finalGrid: result.finalGrid,
    });
    console.log(`  Game ${gameIndex + 1}: ${pct}% in ${result.ticks} ticks`);
  }

  const pcts = gameRuns.map(g => g.pct);
  const stats = computeStats(pcts);
  const avgPct = Math.round(stats.meanPct);
  const avgTicks = Math.round(gameRuns.reduce((sum, game) => sum + game.ticks, 0) / gameRuns.length);
  const algoName = modelFn.name || `${model.replace(/[^a-z0-9]+/gi, '_')}_iter_${iter}`;
  const representativeGame = pickRepresentativeGame(gameRuns, avgPct);
  const improvementFromLastIter = lastSuccessfulAvgPct === null ? null : avgPct - lastSuccessfulAvgPct;
  const improvementFromBestBeforeIter = currentWinner ? avgPct - currentWinner.avgPct : null;

  if (lastSuccessfulAvgPct !== null && avgPct < lastSuccessfulAvgPct) flags.add('REGRESSION_VS_PRIOR');
  if (currentWinner && avgPct < currentWinner.avgPct) flags.add('REGRESSION_VS_BEST');

  const iterationResult = {
    iter,
    promptMode: promptFeedback.promptMode,
    promptFeedback,
    algoName,
    rawCode,
    avgPct,
    avgTicks,
    stats,
    improvementFromLastIter,
    improvementFromBestBeforeIter,
    baselineOpponents: baselineOpponents.map(entry => entry.name),
    games: gameRuns.map(({ finalGrid, ...rest }) => rest),
    representativeGame,
    failureFlags: [...flags],
    plateauSignal: null,
  };

  state.iterations.push(iterationResult);
  state.gameHistory.push({
    iter,
    algoName,
    avgPct,
    ticks: representativeGame?.ticks ?? avgTicks,
  });
  state.leaderboard.push({ name: algoName, avgPct, runs: gamesPerIter, iter });
  state.leaderboard.sort((a, b) => b.avgPct - a.avgPct);

  let meaningfulImprovement = false;
  let plateauSignal = null;
  if (!state.currentWinner || avgPct > state.currentWinner.avgPct) {
    const bestGain = state.currentWinner ? avgPct - state.currentWinner.avgPct : avgPct;

    // Prefer CI-overlap reasoning: an iteration is only a meaningful gain
    // over the best-so-far if its CI95 lower bound clears the best's CI95
    // upper bound. Falls back to the fixed-threshold rule when stats are
    // missing (e.g. extraction failures) or plateauMode is pinned.
    const bestStats = state.currentWinner?.stats;
    const canUseCiOverlap = plateauMode === 'ci_overlap'
      && bestStats
      && Number.isFinite(stats.ci95Low)
      && Number.isFinite(bestStats.ci95High);

    if (canUseCiOverlap) {
      meaningfulImprovement = stats.ci95Low > bestStats.ci95High;
      plateauSignal = {
        rule: 'ci_overlap',
        passed: meaningfulImprovement,
        currentCi95Low: stats.ci95Low,
        bestCi95High: bestStats.ci95High,
      };
    } else if (state.currentWinner) {
      meaningfulImprovement = bestGain >= plateauMinImprovement;
      plateauSignal = {
        rule: 'fixed_threshold',
        passed: meaningfulImprovement,
        gain: bestGain,
        minImprovement: plateauMinImprovement,
      };
    } else {
      // First successful iteration always counts as improvement.
      meaningfulImprovement = true;
      plateauSignal = { rule: 'first_iteration', passed: true };
    }

    state.currentWinner = { iter, avgPct, avgTicks, algoName, stats };
    state.currentWinnerCode = rawCode;
    state.currentWinnerName = algoName;
    console.log(`  ★ New best so far: ${avgPct}%`);
  }

  iterationResult.plateauSignal = plateauSignal;
  state.plateauStreak = meaningfulImprovement ? 0 : plateauStreak + 1;
  state.lastSuccessfulAvgPct = avgPct;

  if (state.plateauStreak >= plateauPatience) {
    if (!iterationResult.failureFlags.includes('STALE')) {
      iterationResult.failureFlags.push('STALE');
    }
  }

  console.log(`  → Avg: ${avgPct}% (std: ${stats.stdPct.toFixed(1)}%, CI95: [${stats.ci95Low.toFixed(1)}%, ${stats.ci95High.toFixed(1)}%])`);

  if (iterationResult.failureFlags.length > 0) {
    console.log(`  \u26A0 Failure flags: ${iterationResult.failureFlags.join(', ')}`);
  }

  if (state.plateauStreak >= plateauPatience && iter < maxIterations) {
    state.stopped = true;
    state.stopReason = 'plateau_reached';
    console.log(`  ↳ stopping early: no >= ${plateauMinImprovement}% best-score gain in ${plateauPatience} consecutive rounds`);
  }

  return { iterationResult, updatedState: state };
}

function buildModelResult(model, baselineOpponents, iterations, state, config) {
  const { maxIterations, plateauPatience, plateauMinImprovement } = config;
  return {
    model,
    baselineOpponents: baselineOpponents.map(entry => entry.name),
    summary: summarizeModelRun({
      model,
      iterations,
      stopReason: state.stopReason,
      maxIterations,
      plateauPatience,
      plateauMinImprovement,
      baselineOpponents: baselineOpponents.map(entry => entry.name),
    }),
    iterations,
  };
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
      stats: bestIteration.stats || null,
      rawCode: bestIteration.rawCode,
    } : null,
    latestIteration: lastIteration ? {
      iter: lastIteration.iter,
      algoName: lastIteration.algoName,
      avgPct: lastIteration.avgPct,
      avgTicks: lastIteration.avgTicks,
      stats: lastIteration.stats || null,
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
  provider,
  model,
  maxIterations,
  gamesPerIter,
  gridSize,
  nPlayers,
  plateauPatience,
  plateauMinImprovement,
  plateauMode,
  baselinePool,
  mode = 'self-play',
  modelIndex = 0,
  opponentAlgos = [],
  game = DEFAULT_GAME,
  runSeed,
}) {
  const baselineOpponents = baselinePool.slice(0, nPlayers - 1);
  let state = createInitialState(baselineOpponents);
  const iterations = [];

  console.log(`\n=== Benchmarking ${model} ===`);

  for (let iter = 1; iter <= maxIterations; iter++) {
    console.log(`\n--- ${model}: iteration ${iter}/${maxIterations} ---`);

    const { iterationResult, updatedState } = await runSingleIteration({
      provider,
      model,
      iter,
      maxIterations,
      gamesPerIter,
      gridSize,
      nPlayers,
      baselineOpponents,
      mode,
      opponentAlgos,
      currentState: state,
      modelIndex,
      runSeed,
      plateauPatience,
      plateauMinImprovement,
      plateauMode,
    });

    state = updatedState;
    iterations.push(iterationResult);

    if (state.stopped && iter < maxIterations) {
      break;
    }
  }

  return buildModelResult(model, baselineOpponents, iterations, state, {
    maxIterations,
    plateauPatience,
    plateauMinImprovement,
  });
}

function loadGame(gameName) {
  try {
    return require(`./games/${gameName}`);
  } catch (e) {
    throw new Error(`Game '${gameName}' not found in games/ directory`);
  }
}

// ─── Main eval loop ───────────────────────────────────────────────────────────
async function runEval(opts = {}) {
  const {
    model = DEFAULT_MODEL,
    models = [],
    provider = DEFAULT_PROVIDER,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    gamesPerIter = DEFAULT_GAMES_PER_ITER,
    gridSize = DEFAULT_GRID_SIZE,
    nPlayers = DEFAULT_N_PLAYERS,
    plateauPatience = DEFAULT_PLATEAU_PATIENCE,
    plateauMinImprovement = DEFAULT_PLATEAU_MIN_IMPROVEMENT,
    plateauMode = DEFAULT_PLATEAU_MODE,
    outputPath = path.join(__dirname, 'eval-results.json'),
    mode = DEFAULT_MODE,
    game = DEFAULT_GAME,
    seed,
  } = opts;

  // Top-level run seed: CLI `--seed` pins it for bit-for-bit reproducibility;
  // otherwise derive a time-based default that we record in the output so any
  // run can be replayed later by reading protocol.runSeed.
  const runSeed = Number.isFinite(seed) && seed > 0
    ? seed >>> 0
    : (((Date.now() & 0x7fffffff) ^ 0xa5a5a5a5) >>> 0) || 1;
  console.log(`Run seed: ${runSeed}`);

  const gameModule = loadGame(game);
  console.log(`Loaded game: ${gameModule.name}`);

  validateProvider(provider);
  const baselinePool = loadBaselineAlgos();
  const requestedModels = [...new Set(
    ((Array.isArray(models) && models.length) ? models : [model]).filter(Boolean)
  )];

  if (mode === 'adversarial' && requestedModels.length === 1) {
    console.warn('\n[WARNING] Adversarial mode requires at least 2 models. Degrading to self-play.\n');
  }
  const effectiveMode = (mode === 'adversarial' && requestedModels.length > 1) ? 'adversarial' : 'self-play';

  const benchmarkResults = {
    generatedAt: new Date().toISOString(),
    schemaVersion: 4,
    evalVersion: EVAL_VERSION,
    changelog: CHANGELOG,
    protocol: {
      comparisonMode: 'shared_protocol_benchmark',
      frontendPrimarySurface: 'results.html',
      evalVersion: EVAL_VERSION,
      mode: effectiveMode,
      game,
      gamesPerIter,
      maxIterations,
      gridSize,
      nPlayers,
      plateauPatience,
      plateauMinImprovement,
      plateauMode,
      rewardSignals: [
        'avg_territory_pct',
        'leaderboard_position',
        'winning_algorithm_source',
        'recent_game_history',
      ],
      baselineOpponents: baselinePool.slice(0, nPlayers - 1).map(entry => entry.name),
      seededRandomness: true,
      runSeed,
    },
    models: {},
    rankings: [],
  };

  if (effectiveMode === 'adversarial') {
    // Round-robin: all models iter 1, then all models iter 2, etc.
    const states = {};
    const allIterations = {};

    for (const modelName of requestedModels) {
      states[modelName] = createInitialState(baselinePool.slice(0, nPlayers - 1));
      allIterations[modelName] = [];
    }

    for (let iter = 1; iter <= maxIterations; iter++) {
      // Compute opponent algos for this iteration BEFORE running any model
      const iterOpponentAlgos = {};
      for (const modelName of requestedModels) {
        iterOpponentAlgos[modelName] = (iter > 1)
          ? collectTopOpponentAlgos(states, modelName)
          : [];
      }

      for (let modelIdx = 0; modelIdx < requestedModels.length; modelIdx++) {
        const modelName = requestedModels[modelIdx];
        if (states[modelName].stopped) continue;

        const { iterationResult, updatedState } = await runSingleIteration({
          provider,
          model: modelName,
          iter,
          maxIterations,
          gamesPerIter,
          gridSize,
          nPlayers,
          baselineOpponents: baselinePool.slice(0, nPlayers - 1),
          mode: iter === 1 ? 'self-play' : 'adversarial',
          opponentAlgos: iterOpponentAlgos[modelName],
          currentState: states[modelName],
          modelIndex: modelIdx,
          runSeed,
          plateauPatience,
          plateauMinImprovement,
          plateauMode,
          game,
        });

        states[modelName] = updatedState;
        allIterations[modelName].push(iterationResult);
      }
    }

    for (const modelName of requestedModels) {
      benchmarkResults.models[modelName] = buildModelResult(
        modelName,
        baselinePool.slice(0, nPlayers - 1),
        allIterations[modelName],
        states[modelName],
        { maxIterations, plateauPatience, plateauMinImprovement }
      );
    }
  } else {
    // Sequential self-play (original behavior)
    for (let modelIdx = 0; modelIdx < requestedModels.length; modelIdx++) {
      const modelName = requestedModels[modelIdx];
      benchmarkResults.models[modelName] = await runModelEval({
        provider,
        model: modelName,
        maxIterations,
        gamesPerIter,
        gridSize,
        nPlayers,
        plateauPatience,
        plateauMinImprovement,
        plateauMode,
        baselinePool,
        mode: 'self-play',
        modelIndex: modelIdx,
        game,
        runSeed,
      });
    }
  }

  benchmarkResults.pairwiseComparisons = computePairwiseComparisons(benchmarkResults.models, runSeed);
  benchmarkResults.ratings = computeBradleyTerryRatings(benchmarkResults.models, runSeed);

  if (Object.keys(benchmarkResults.models).length >= 2) {
    console.log('\n=== Running best-vs-best head-to-head matrix ===');
    benchmarkResults.headToHead = runHeadToHeadMatrix(benchmarkResults.models, baselinePool, {
      gridSize,
      nPlayers,
      gamesPerPair: gamesPerIter,
      runSeed,
      game,
    });
    console.log(`Head-to-head: ${benchmarkResults.headToHead.pairs.length} pairs, ${benchmarkResults.headToHead.pairs.reduce((n, p) => n + p.gamesPlayed, 0)} games played`);
  }

  console.log('\n=== Running held-out reference benchmark ===');
  benchmarkResults.referenceBenchmark = runHeldOutReferenceBenchmark(benchmarkResults.models, baselinePool, {
    gridSize,
    nPlayers,
    gamesPerModel: gamesPerIter,
    runSeed,
  });
  console.log(`Reference benchmark (${benchmarkResults.referenceBenchmark.referenceName}): ${benchmarkResults.referenceBenchmark.entries.length} models scored.`);

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
    provider: DEFAULT_PROVIDER,
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
      case '--provider':
        values.provider = readValue(i, arg);
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
      case '--plateau-mode':
        values.plateauMode = readValue(i, arg);
        if (values.plateauMode !== 'ci_overlap' && values.plateauMode !== 'fixed_threshold') {
          throw new Error(`--plateau-mode must be 'ci_overlap' or 'fixed_threshold'`);
        }
        i++;
        break;
      case '--mode':
        values.mode = readValue(i, arg);
        if (values.mode !== 'self-play' && values.mode !== 'adversarial') {
          throw new Error(`Invalid mode: ${values.mode}. Must be 'self-play' or 'adversarial'.`);
        }
        i++;
        break;
      case '--game':
        values.game = readValue(i, arg);
        i++;
        break;
      case '--output':
        values.outputPath = path.resolve(readValue(i, arg));
        i++;
        break;
      case '--seed':
        values.seed = parseInt(readValue(i, arg), 10);
        if (!Number.isFinite(values.seed) || values.seed <= 0) {
          throw new Error(`--seed must be a positive integer`);
        }
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
  --provider <anthropic|openai>    LLM provider (default: ${DEFAULT_PROVIDER})
  --mode <self-play|adversarial>   Learning mode: self-play (default) or adversarial (cross-model opponent exposure)
  --game <name>                      Game module to run (default: ${DEFAULT_GAME})
  --iterations <n>                 Target iterations per model (default: ${DEFAULT_MAX_ITERATIONS})
  --games-per-iter <n>             Headless games per iteration (default: ${DEFAULT_GAMES_PER_ITER})
  --grid-size <n>                  Arena grid size (default: ${DEFAULT_GRID_SIZE})
  --players <n>                    Players per game including the model (default: ${DEFAULT_N_PLAYERS})
  --plateau-patience <n>           Early-stop after this many flat rounds (default: ${DEFAULT_PLATEAU_PATIENCE})
  --plateau-min-improvement <pct>  Minimum best-score gain used when plateau-mode=fixed_threshold (default: ${DEFAULT_PLATEAU_MIN_IMPROVEMENT})
  --plateau-mode <ci_overlap|fixed_threshold>  Plateau rule (default: ${DEFAULT_PLATEAU_MODE}). ci_overlap requires an iteration's CI95 low to clear best-so-far's CI95 high.
  --output <path>                  Output JSON path (default: eval-results.json)
  --seed <n>                       Top-level run seed for bit-for-bit reproducibility (default: time-based)
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
    provider: cliOptions.provider,
    maxIterations: cliOptions.maxIterations,
    gamesPerIter: cliOptions.gamesPerIter,
    gridSize: cliOptions.gridSize,
    nPlayers: cliOptions.nPlayers,
    plateauPatience: cliOptions.plateauPatience,
    plateauMinImprovement: cliOptions.plateauMinImprovement,
    outputPath: cliOptions.outputPath,
    mode: cliOptions.mode,
    game: cliOptions.game,
    seed: cliOptions.seed,
    plateauMode: cliOptions.plateauMode,
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
  seededRandom,
  deriveGameSeed,
  bootstrapDiffCI,
  computePairwiseComparisons,
  runHeadToHeadMatrix,
  runHeldOutReferenceBenchmark,
  computeBradleyTerryRatings,
  fitBradleyTerry,
  loadGame,
  DEFAULT_PROVIDER,
  DEFAULT_MODE,
  DEFAULT_GAME,
};
