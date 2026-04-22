/**
 * games/arena-war/engine.js
 *
 * Arena War game engine.
 * Adapted from root engine.js to implement the GameEngine interface.
 */

const { GameEngine } = require('../game-interface');

const EMPTY = -1;

class ArenaWarEngine extends GameEngine {
  constructor(config = {}) {
    super(config);
    const { size = 60, nPlayers = 4, algos = [] } = config;
    this.size = size;
    this.nPlayers = nPlayers;
    this.algos = algos;
    this.tick = 0;
    this.done = false;
    this.grid = [];
    this.mask = [];
    this._buildMask();
    this._initGrid();
  }

  /** Build circular boolean mask */
  _buildMask() {
    const { size } = this;
    const cx = size / 2, cy = size / 2, r = size / 2 - 0.5;
    this.mask = [];
    for (let row = 0; row < size; row++) {
      this.mask.push([]);
      for (let col = 0; col < size; col++) {
        const dx = col + 0.5 - cx, dy = row + 0.5 - cy;
        this.mask[row].push(dx * dx + dy * dy <= r * r);
      }
    }
  }

  /** Place starting seeds evenly around a ring inside the circle */
  _initGrid() {
    const { size, nPlayers, mask } = this;
    this.grid = [];
    for (let r = 0; r < size; r++) {
      this.grid.push([]);
      for (let c = 0; c < size; c++)
        this.grid[r].push(mask[r][c] ? EMPTY : null);
    }

    const cx = Math.floor(size / 2), cy = Math.floor(size / 2);
    const seedRadius = Math.floor(size / 2) * 0.55;
    const angleStep = (2 * Math.PI) / nPlayers;

    for (let i = 0; i < nPlayers; i++) {
      const angle = angleStep * i - Math.PI / 2;
      const sr = Math.round(cx + seedRadius * Math.sin(angle));
      const sc = Math.round(cy + seedRadius * Math.cos(angle));
      const clampr = Math.max(0, Math.min(size - 1, sr));
      const clampc = Math.max(0, Math.min(size - 1, sc));

      // Seed a small 3x3 patch per player
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1],[0,0],[-1,-1],[-1,1],[1,-1],[1,1]]) {
        const nr = clampr + dr, nc = clampc + dc;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size && mask[nr][nc])
          this.grid[nr][nc] = i;
      }
    }

    this.tick = 0;
    this.done = false;
  }

  /**
   * Advance game by one tick.
   * Returns { changed: boolean, scores: number[], totalCells: number }
   */
  step() {
    if (this.done) return this._getResult(false);

    const { size, nPlayers, grid, algos } = this;
    const claimsPerTick = Math.max(1, Math.floor(size / 8));

    // Collect claim candidates from each algorithm
    // Map: encoded_key -> [row, col, playerId]
    // Conflicts (two players want same cell) → stays EMPTY
    const claimMap = new Map();

    for (let i = 0; i < nPlayers; i++) {
      let frontier;
      try {
        frontier = algos[i](i, grid.map(r => [...r]), size);
      } catch (e) {
        console.warn(`Algorithm ${i} threw:`, e);
        frontier = [];
      }

      if (!Array.isArray(frontier)) frontier = [];

      let claimed = 0;
      for (const cell of frontier) {
        if (claimed >= claimsPerTick) break;
        if (!Array.isArray(cell) || cell.length < 2) continue;
        const [r, c] = cell;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        if (grid[r][c] !== EMPTY) continue;

        const k = r * 10000 + c;
        if (!claimMap.has(k)) {
          claimMap.set(k, [r, c, i]);
          claimed++;
        } else {
          const existing = claimMap.get(k);
          if (existing[2] !== i) claimMap.set(k, [r, c, -2]); // conflict
        }
      }
    }

    // Apply non-conflicting claims
    let changed = 0;
    for (const [, [r, c, id]] of claimMap) {
      if (id >= 0 && grid[r][c] === EMPTY) {
        grid[r][c] = id;
        changed++;
      }
    }

    this.tick++;

    // Check termination: no empty cells remain or no progress
    const emptyCells = this._countEmpty();
    if (changed === 0 || emptyCells === 0) this.done = true;

    return this._getResult(changed > 0);
  }

  _countEmpty() {
    let n = 0;
    for (let r = 0; r < this.size; r++)
      for (let c = 0; c < this.size; c++)
        if (this.grid[r][c] === EMPTY) n++;
    return n;
  }

  _getResult(changed) {
    const scores = new Array(this.nPlayers).fill(0);
    let total = 0;
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const v = this.grid[r][c];
        if (v === null) continue;
        total++;
        if (v >= 0) scores[v]++;
      }
    }
    return { changed, scores, totalCells: total, tick: this.tick, done: this.done };
  }

  /** Full game state snapshot — used for result logging and replay */
  snapshot() {
    return {
      tick: this.tick,
      size: this.size,
      nPlayers: this.nPlayers,
      done: this.done,
      grid: this.grid.map(r => [...r]),
      ...this._getResult(false),
    };
  }

  /** Replace one algorithm slot (for model injection mid-session) */
  replaceAlgorithm(slot, fn) {
    if (slot < 0 || slot >= this.nPlayers) throw new Error('Invalid slot');
    if (typeof fn !== 'function') throw new Error('Must be a function');
    this.algos[slot] = fn;
  }

  // -- GameEngine interface implementations --

  getResult() {
    const result = this._getResult(false);
    return {
      scores: result.scores,
      metrics: {
        tick: result.tick,
        totalCells: result.totalCells,
        done: result.done,
      },
    };
  }

  getName() {
    return 'arena-war';
  }

  getDefaultConfig() {
    return { size: 60, nPlayers: 4, algos: [] };
  }
}

module.exports = { ArenaWarEngine, EMPTY };
