/**
 * reference-algorithms.js
 *
 * Held-out reference algorithms for the Arena War benchmark.
 *
 * PROTOCOL RULE: These functions MUST NOT be referenced in `prompts.js`,
 * `algorithms.js`, `arena.html`, `engine.js`, or any other surface that a
 * model can read. Their source is never included in `eval-results.json` and
 * never fed into any prompt. Only the reference NAME appears in output, and
 * only for the purpose of reporting the model-vs-reference comparison.
 *
 * The intent is to create an absolute cross-version anchor: if a future eval
 * refresh swaps out the baselines, we can still ask "did best-of-fleet beat
 * the reference at this territory percentage?" and have that answer be
 * directly comparable across eval versions.
 */

const EMPTY = -1;

const REFERENCE_NAME = 'HeldOutReference-v1';

// Density-aware frontier expansion with enemy-edge penalty.
// Prefers claims that (a) sit next to many of our own cells already (thick
// territory) and (b) are not adjacent to enemy cells (avoid contested edges).
function heldOutReferenceV1(id, grid, size) {
  const cands = new Map();
  const neighbors4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const neighbors8 = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1],
  ];

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] !== id) continue;
      for (const [dr, dc] of neighbors4) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        if (grid[nr][nc] !== EMPTY) continue;

        let ownCount = 0;
        let enemyCount = 0;
        for (const [ddr, ddc] of neighbors8) {
          const nnr = nr + ddr, nnc = nc + ddc;
          if (nnr < 0 || nnr >= size || nnc < 0 || nnc >= size) continue;
          const cell = grid[nnr][nnc];
          if (cell === id) ownCount++;
          else if (cell !== EMPTY && cell !== null) enemyCount++;
        }

        // Score favors own-density, penalizes enemy-adjacency, small bonus
        // for cells that would seal off an isolated empty pocket.
        const score = ownCount * 2 - enemyCount * 1.5;
        const key = nr * (size + 1) + nc;
        const prev = cands.get(key);
        if (!prev || prev[2] < score) cands.set(key, [nr, nc, score]);
      }
    }
  }

  return [...cands.values()]
    .sort((a, b) => b[2] - a[2])
    .map(x => [x[0], x[1]]);
}

const REFERENCES = [
  { name: REFERENCE_NAME, fn: heldOutReferenceV1 },
];

module.exports = {
  REFERENCES,
  REFERENCE_NAME,
  REFERENCE: heldOutReferenceV1,
};
