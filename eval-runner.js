/**
 * eval-runner.js  (Node.js)
 *
 * Headless eval loop for Arena War.
 * This is the core evaluation harness — it:
 *   1. Sends the baseline prompt to a target model
 *   2. Extracts the returned JS function
 *   3. Runs N games headlessly against baseline algorithms
 *   4. Records scores and tick counts
 *   5. Feeds the winner back as context for the next iteration
 *   6. Repeats for MAX_ITERATIONS rounds
 *   7. Writes results to eval-results.json
 *
 * Usage:
 *   node eval-runner.js --model claude-sonnet-4-20250514 --iterations 10 --games-per-iter 5
 *
 * Environment:
 *   ANTHROPIC_API_KEY must be set
 */

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { ALGOS } = require('./algorithms');
const { BASELINE_PROMPT, buildIterativePrompt } = require('./prompts');

// ─── Headless engine (copy of engine.js logic for Node) ──────────────────────
const EMPTY = -1;

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

function runGame(size, algos) {
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
  return { scores, total, ticks: tick };
}

// ─── Algorithm loading ────────────────────────────────────────────────────────
function loadBaselineAlgos() {
  return ALGOS;
}

function extractFunction(rawCode) {
  // Strip markdown fences if the model wrapped its output
  let code = rawCode.replace(/```[a-z]*/g, '').replace(/```/g, '').trim();
  // Evaluate and return the function
  // eslint-disable-next-line no-new-func
  const fn = new Function(`
    const EMPTY = -1;
    ${code}
    const match = \`${code}\`.match(/function\\s+(\\w+)/);
    return match ? eval(match[1]) : undefined;
  `)();
  if (typeof fn !== 'function') throw new Error('Could not extract function from model output');
  return fn;
}

// ─── Main eval loop ───────────────────────────────────────────────────────────
async function runEval(opts = {}) {
  const {
    model = 'claude-sonnet-4-20250514',
    maxIterations = 10,
    gamesPerIter = 5,
    gridSize = 60,
    nPlayers = 4,
  } = opts;

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required to run evals.');
  }

  const client = new Anthropic();
  const baselineAlgos = loadBaselineAlgos();
  const results = { model, gridSize, nPlayers, iterations: [] };
  const leaderboard = [];
  const gameHistory = [];

  let currentWinner = null;
  let currentWinnerCode = null;
  let currentWinnerName = 'Greedy BFS (baseline)';

  for (let iter = 1; iter <= maxIterations; iter++) {
    console.log(`\n=== Iteration ${iter}/${maxIterations} ===`);

    // Build prompt
    const prompt = iter === 1
      ? BASELINE_PROMPT
      : buildIterativePrompt({
          iteration: iter,
          leaderboard,
          winnerName: currentWinnerName,
          winnerCode: currentWinnerCode,
          winnerPct: currentWinner?.avgPct ?? 0,
          gameHistory,
        });

    // Call model
    console.log(`Calling ${model}...`);
    const message = await client.messages.create({
      model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });
    const rawCode = message.content.find(b => b.type === 'text')?.text ?? '';

    // Extract function
    let modelFn;
    try {
      modelFn = extractFunction(rawCode);
      console.log(`Extracted function: ${modelFn.name || '(anonymous)'}`);
    } catch (e) {
      console.error(`Failed to extract function: ${e.message}`);
      results.iterations.push({ iter, error: e.message, rawCode });
      continue;
    }

    // Run games: model algo as player 0, baselines fill remaining slots
    const gameScores = [];
    for (let g = 0; g < gamesPerIter; g++) {
      const algos = [modelFn, ...baselineAlgos.slice(0, nPlayers - 1)];
      const result = runGame(gridSize, algos);
      const pct = Math.round((result.scores[0] / result.total) * 100);
      gameScores.push({ pct, ticks: result.ticks, scores: result.scores });
      console.log(`  Game ${g + 1}: ${pct}% in ${result.ticks} ticks`);
    }

    const avgPct = Math.round(gameScores.reduce((s, g) => s + g.pct, 0) / gameScores.length);
    const algoName = modelFn.name || `model_iter_${iter}`;

    const iterResult = {
      iter,
      algoName,
      rawCode,
      avgPct,
      games: gameScores,
    };
    results.iterations.push(iterResult);
    gameHistory.push({ iter, winnerName: algoName, winnerPct: avgPct, ticks: gameScores[0]?.ticks });

    // Update leaderboard
    leaderboard.push({ name: algoName, avgPct, runs: gamesPerIter });
    leaderboard.sort((a, b) => b.avgPct - a.avgPct);
    console.log(`  → Avg: ${avgPct}%`);

    // Track best for next iteration
    if (!currentWinner || avgPct > currentWinner.avgPct) {
      currentWinner = { avgPct };
      currentWinnerCode = rawCode;
      currentWinnerName = algoName;
      console.log(`  ★ New best!`);
    }
  }

  // Write results
  const outPath = path.join(__dirname, 'eval-results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nResults written to ${outPath}`);
  return results;
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : def;
  };
  runEval({
    model: get('--model', 'claude-sonnet-4-20250514'),
    maxIterations: parseInt(get('--iterations', '10')),
    gamesPerIter: parseInt(get('--games-per-iter', '5')),
    gridSize: parseInt(get('--grid-size', '60')),
    nPlayers: parseInt(get('--players', '4')),
  }).catch(console.error);
}

module.exports = { runEval, runGame };
