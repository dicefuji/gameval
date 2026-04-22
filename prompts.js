/**
 * prompts.js
 *
 * Prompt templates for the Arena War eval loop.
 * These are the exact prompts sent to LLMs to generate new algorithms.
 *
 * Two prompt modes:
 *   1. BASELINE — first iteration, no prior algorithms shown
 *   2. ITERATIVE — subsequent iterations, shown the current leaderboard + winning code
 *
 * The model's output is expected to be a single JS function matching the signature:
 *   function myAlgorithm(id, grid, size) -> Array<[row, col]>
 */

const ARENA_SYSTEM_PROMPT = `
You are competing in a spatial territory-capture game called Arena War.
Your goal is to write a JavaScript algorithm that captures as much of a circular pixel grid as possible.

== GAME RULES ==
- The arena is a circle, broken into a SIZE×SIZE grid of pixels
- Each tick, your algorithm runs and returns a prioritized list of [row, col] cells to claim
- You can only claim cells that are EMPTY (-1) and adjacent (4-directional) to cells you already own
- You CANNOT claim through enemy territory — if you are surrounded, you are confined to your boundary
- If two players claim the same cell in the same tick, the cell stays EMPTY
- Each tick you may claim up to floor(SIZE / 8) cells
- The game ends when no empty cells remain or no progress is possible

== FUNCTION SIGNATURE ==
Your algorithm must be a named JavaScript function with this exact signature:

  function myAlgorithm(id, grid, size) {
    const EMPTY = -1;
    // your logic here
    return [[row1, col1], [row2, col2], ...]; // prioritized list of cells to claim
  }

Parameters:
  id    {number}     — your player index (0-based)
  grid  {number[][}} — 2D array [row][col]. Values: -1=EMPTY, null=outside circle, 0..N=owned by player N
  size  {number}     — grid dimension (e.g. 60)

Return:
  Array of [row, col] pairs, ordered by priority. First entries are claimed first.
  Return as many as you want — only the top floor(SIZE/8) will be used per tick.

== CONSTRAINTS ==
- Pure JavaScript only (no imports, no fetch, no DOM)
- Must run in under 50ms per tick
- Must return an Array (empty array is valid but loses)
- You may read the full grid but cannot modify it (a copy is passed in)
`.trim();

const BASELINE_PROMPT = `
${ARENA_SYSTEM_PROMPT}

This is your FIRST attempt. There are no prior algorithms to compare against.
Write the best algorithm you can from first principles.

Think about:
- How to expand territory quickly early-game
- How to avoid being cut off by opponents
- Whether to prioritize dense expansion vs. reaching key areas first
- How the circular shape affects optimal strategy

Return ONLY the JavaScript function — no markdown, no explanation, just code.
`.trim();

function buildIterativePrompt({ iteration, leaderboard, winnerName, winnerCode, winnerPct, gameHistory }) {
  return `
${ARENA_SYSTEM_PROMPT}

== ITERATION ${iteration} ==
You are trying to beat the current best algorithm.

== LEADERBOARD ==
${leaderboard.map((entry, i) => `  ${i + 1}. ${entry.name} — avg ${entry.avgPct}% territory over ${entry.runs} runs`).join('\n')}

== CURRENT WINNER: ${winnerName} (${winnerPct}% territory) ==
Here is the winning algorithm's source code:

\`\`\`javascript
${winnerCode}
\`\`\`

== GAME HISTORY (last 5 runs) ==
${gameHistory.slice(-5).map(g => `  Iter ${g.iter}: ${g.winnerName} won with ${g.winnerPct}% in ${g.ticks} ticks`).join('\n')}

== YOUR TASK ==
Analyze the winning algorithm's weaknesses and write a better one.
Consider:
- What does the current winner do well? What are its blind spots?
- Can you encircle it early, denying it space?
- Can you reach high-value areas faster?
- Can you adapt dynamically to opponent positions?

Return ONLY the JavaScript function — no markdown, no explanation, just code.
`.trim();
}

// Export for Node / eval runner
if (typeof module !== 'undefined') {
  module.exports = { ARENA_SYSTEM_PROMPT, BASELINE_PROMPT, buildIterativePrompt };
}
