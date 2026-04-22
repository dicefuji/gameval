const { ArenaWarEngine } = require('./engine');
const { ALGOS, ALGO_NAMES } = require('./algorithms');
const { BASELINE_PROMPT, buildIterativePrompt, getRulesDescription, getBaselinePrompt, getIterativePrompt } = require('./prompts');

module.exports = {
  name: 'arena-war',
  GameEngine: ArenaWarEngine,
  ALGOS,
  ALGO_NAMES,
  prompts: { BASELINE_PROMPT, buildIterativePrompt, getRulesDescription, getBaselinePrompt, getIterativePrompt },
};
