/**
 * games/game-interface.js
 * Base interface for all benchmark games.
 * Future games must implement this interface to plug into the eval harness and arena.
 */

class GameEngine {
  constructor(config = {}) {
    this.config = config;
  }

  /** Run one step/tick of the game. Return { done: boolean, state: any } */
  step() { throw new Error('step() must be implemented'); }

  /** Get current scores and metrics. Return { scores: number[], metrics: object } */
  getResult() { throw new Error('getResult() must be implemented'); }

  /** Get full game rules as a markdown string for LLM prompts */
  getRulesDescription() { throw new Error('getRulesDescription() must be implemented'); }

  /** Get the prompt template for first iteration (no prior history) */
  getBaselinePrompt() { throw new Error('getBaselinePrompt() must be implemented'); }

  /** Get the prompt template for iterative rounds (with history/leaderboard) */
  getIterativePrompt(context) { throw new Error('getIterativePrompt() must be implemented'); }

  /** Validate that an algorithm function is acceptable for this game */
  validateAlgorithm(fn) { return typeof fn === 'function'; }

  /** Get default configuration for this game */
  getDefaultConfig() { return {}; }

  /** Get game name / identifier */
  getName() { return 'unnamed-game'; }
}

module.exports = { GameEngine };
