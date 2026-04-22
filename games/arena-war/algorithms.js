/**
 * games/arena-war/algorithms.js
 *
 * Built-in baseline algorithms for the Arena War eval.
 * Each algorithm is a function with signature:
 *
 *   function(id, grid, size) -> Array<[row, col]>
 *
 * Parameters:
 *   id    {number}   — the player index this algorithm controls (0-based)
 *   grid  {number[][]} — 2D array of size×size. Values:
 *                        -1  = EMPTY (claimable)
 *                        null = outside the circular arena (unclaimed, unreachable)
 *                        0..N = owned by player N
 *   size  {number}   — grid dimension (e.g. 60 for a 60×60 grid)
 *
 * Return value:
 *   A prioritized array of [row, col] pairs representing cells the algorithm
 *   wants to claim this tick. The engine will process them in order, up to
 *   the per-tick claim limit (claimsPerTick = floor(size/8)).
 *   Cells that are not EMPTY or are outside the circle are ignored.
 *   If two algorithms claim the same cell in the same tick, it stays EMPTY.
 *
 * Constraint:
 *   Algorithms CANNOT claim through enemy territory. They can only expand
 *   to cells adjacent (4-directional) to cells they already own.
 *   If fully enclosed, they can only work within that boundary.
 */

const EMPTY = -1;

const ALGO_NAMES = [
  'Greedy BFS',
  'Diagonal Spiral',
  'Density Wave',
  'Corner Seeker',
  'Flood Aggressive',
  'Ring Expander',
  'Random Walk+',
  'Centroid Push',
];

const ALGOS = [

  // 0: Greedy BFS
  // Simple BFS — expand to all adjacent empty cells, no prioritization.
  // Baseline "naive" algorithm. Good reference point for model improvement.
  function greedyBFS(id, grid, size) {
    const frontier = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === id) {
          for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] === EMPTY)
              frontier.push([nr, nc]);
          }
        }
      }
    }
    return frontier;
  },

  // 1: Diagonal Spiral
  // Extends BFS to also claim diagonal neighbors, giving faster area coverage
  // at the cost of potentially "thin" territory that's easy to encircle.
  function diagonalSpiral(id, grid, size) {
    const frontier = [];
    const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === id) {
          for (const [dr, dc] of dirs) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] === EMPTY)
              frontier.push([nr, nc]);
          }
        }
      }
    }
    return frontier;
  },

  // 2: Density Wave
  // Scores each candidate cell by how many of its own neighbors surround it.
  // Prioritizes "thick" expansion over thin tendrils, making territory harder to cut off.
  function densityWave(id, grid, size) {
    const cands = new Map();
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === id) {
          for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] === EMPTY) {
              const k = nr * 1000 + nc;
              let score = 0;
              for (const [ddr, ddc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
                const nnr = nr + ddr, nnc = nc + ddc;
                if (nnr >= 0 && nnr < size && nnc >= 0 && nnc < size && grid[nnr][nnc] === id)
                  score++;
              }
              if (!cands.has(k) || cands.get(k)[2] < score)
                cands.set(k, [nr, nc, score]);
            }
          }
        }
      }
    }
    return [...cands.values()].sort((a, b) => b[2] - a[2]).map(x => [x[0], x[1]]);
  },

  // 3: Corner Seeker
  // Biases expansion toward the corners of the bounding box.
  // Effective on square grids; less effective in circle arenas where corners are out of bounds.
  function cornerSeeker(id, grid, size) {
    const corners = [[0,0],[0,size-1],[size-1,0],[size-1,size-1]];
    const frontier = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === id) {
          for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] === EMPTY) {
              const dist = Math.min(...corners.map(([cr,cc]) => Math.abs(nr-cr) + Math.abs(nc-cc)));
              frontier.push([nr, nc, dist]);
            }
          }
        }
      }
    }
    return frontier.sort((a, b) => a[2] - b[2]).map(x => [x[0], x[1]]);
  },

  // 4: Flood Aggressive
  // Maximum expansion — claims all 8-directional neighbors per tick.
  // Very fast early-game, but produces thin fragile edges.
  function floodAggressive(id, grid, size) {
    const frontier = new Set();
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === id) {
          for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] === EMPTY)
              frontier.add(nr * 1000 + nc);
          }
        }
      }
    }
    return [...frontier].map(k => [Math.floor(k / 1000), k % 1000]);
  },

  // 5: Ring Expander
  // Expands outward from the centroid of owned territory in rings.
  // Produces clean circular territory shapes. Effective mid-game.
  function ringExpander(id, grid, size) {
    let cr = 0, cc = 0, cnt = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++)
      if (grid[r][c] === id) { cr += r; cc += c; cnt++; }
    if (!cnt) return [];
    cr = Math.round(cr / cnt); cc = Math.round(cc / cnt);
    const frontier = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === EMPTY) {
          for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] === id) {
              const dist = Math.abs(r - cr) + Math.abs(c - cc);
              frontier.push([r, c, dist]);
              break;
            }
          }
        }
      }
    }
    return frontier.sort((a, b) => a[2] - b[2]).map(x => [x[0], x[1]]);
  },

  // 6: Random Walk+
  // Randomizes the frontier order each tick, introducing stochastic diversity.
  // Useful as a noise baseline — hard to predict, hard to counter directly.
  function randomWalkPlus(id, grid, size) {
    const frontier = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === id) {
          for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] === EMPTY)
              frontier.push([nr, nc, Math.random()]);
          }
        }
      }
    }
    return frontier.sort((a, b) => a[2] - b[2]).map(x => [x[0], x[1]]);
  },

  // 7: Centroid Push
  // Expands toward cells furthest from the current centroid — anti-clustering.
  // Spreads territory aggressively outward, sacrificing density for reach.
  function centroidPush(id, grid, size) {
    let cr = 0, cc = 0, cnt = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++)
      if (grid[r][c] === id) { cr += r; cc += c; cnt++; }
    if (!cnt) return [];
    cr = cr / cnt; cc = cc / cnt;
    const frontier = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === EMPTY) {
          for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] === id) {
              const dist = Math.sqrt((r - cr) ** 2 + (c - cc) ** 2);
              frontier.push([r, c, dist]);
              break;
            }
          }
        }
      }
    }
    return frontier.sort((a, b) => b[2] - a[2]).map(x => [x[0], x[1]]);
  },

];

module.exports = { ALGOS, ALGO_NAMES, EMPTY };
