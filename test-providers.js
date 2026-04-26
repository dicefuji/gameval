/**
 * test-providers.js
 *
 * Smoke tests for the multi-provider backend.
 * Confirms both Anthropic and OpenAI providers can be instantiated
 * and that eval-runner.js accepts the --provider flag correctly.
 *
 * No API calls are made — these tests do not require real API keys.
 */

const assert = require('assert');

// ─── Provider instantiation tests ────────────────────────────────────────────

function testProviderInstantiation() {
  // Temporarily set fake API keys so constructor paths execute
  const origAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const origOpenAIKey = process.env.OPENAI_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'fake-anthropic-key';
  process.env.OPENAI_API_KEY = 'fake-openai-key';

  try {
    const { getProviderClient, validateProvider, PROVIDERS } = require('./providers');

    // Validate supported providers list
    assert.deepStrictEqual(PROVIDERS, ['anthropic', 'openai'],
      'PROVIDERS should list anthropic and openai');

    // Validate each provider name
    validateProvider('anthropic');
    validateProvider('openai');

    // Confirm instantiation succeeds for both
    const anthropicClient = getProviderClient('anthropic');
    assert(anthropicClient !== undefined && anthropicClient !== null,
      'Anthropic client should be instantiated');

    const openaiClient = getProviderClient('openai');
    assert(openaiClient !== undefined && openaiClient !== null,
      'OpenAI client should be instantiated');

    // Confirm unknown provider throws
    assert.throws(() => validateProvider('unknown-provider'),
      /Unknown provider/);
    assert.throws(() => getProviderClient('unknown-provider'),
      /Unknown provider/);

    console.log('  ✓ Provider instantiation tests passed');
  } finally {
    process.env.ANTHROPIC_API_KEY = origAnthropicKey;
    process.env.OPENAI_API_KEY = origOpenAIKey;
  }
}

// ─── CLI flag parsing tests ──────────────────────────────────────────────────

function testCliParsing() {
  const { parseCliArgs, DEFAULT_PROVIDER, DEFAULT_MODE } = require('./eval-runner');

  // Default provider and mode
  const defaults = parseCliArgs(['node', 'eval-runner.js']);
  assert.strictEqual(defaults.provider, DEFAULT_PROVIDER,
    'Default provider should be anthropic');
  assert.strictEqual(defaults.mode, undefined,
    'Default mode should be undefined (falls back to DEFAULT_MODE)');

  // Explicit provider flag
  const openaiArgs = parseCliArgs(['node', 'eval-runner.js', '--provider', 'openai']);
  assert.strictEqual(openaiArgs.provider, 'openai',
    'Should parse --provider openai');

  const anthropicArgs = parseCliArgs(['node', 'eval-runner.js', '--provider', 'anthropic']);
  assert.strictEqual(anthropicArgs.provider, 'anthropic',
    'Should parse --provider anthropic');

  // Mode flag parsing
  const selfPlayArgs = parseCliArgs(['node', 'eval-runner.js', '--mode', 'self-play']);
  assert.strictEqual(selfPlayArgs.mode, 'self-play',
    'Should parse --mode self-play');

  const adversarialArgs = parseCliArgs(['node', 'eval-runner.js', '--mode', 'adversarial']);
  assert.strictEqual(adversarialArgs.mode, 'adversarial',
    'Should parse --mode adversarial');

  // Multiple models with provider and mode
  const multiArgs = parseCliArgs([
    'node', 'eval-runner.js',
    '--provider', 'openai',
    '--mode', 'adversarial',
    '--model', 'gpt-4o',
    '--model', 'gpt-4-turbo',
  ]);
  assert.strictEqual(multiArgs.provider, 'openai');
  assert.strictEqual(multiArgs.mode, 'adversarial');
  assert.deepStrictEqual(multiArgs.models, ['gpt-4o', 'gpt-4-turbo']);

  const reproducibleArgs = parseCliArgs([
    'node', 'eval-runner.js',
    '--seed', '424242',
    '--iterations', '6',
    '--games-per-iter', '25',
    '--output', 'custom-results.json',
    '--reasoning-effort', 'high',
  ]);
  assert.strictEqual(reproducibleArgs.seed, 424242,
    'Should parse reproducible run seed');
  assert.strictEqual(reproducibleArgs.maxIterations, 6,
    'Should parse iteration count');
  assert.strictEqual(reproducibleArgs.gamesPerIter, 25,
    'Should parse games per iteration');
  assert.strictEqual(reproducibleArgs.reasoningEffort, 'high',
    'Should parse reasoning effort');
  assert(reproducibleArgs.outputPath.endsWith('custom-results.json'),
    'Should parse custom output path');

  console.log('  ✓ CLI flag parsing tests passed');
}

function testReasoningEffortValidation() {
  const { validateReasoningEffort, REASONING_EFFORT_LEVELS } = require('./providers');

  for (const effort of REASONING_EFFORT_LEVELS) {
    validateReasoningEffort(effort);
  }
  validateReasoningEffort(undefined);
  assert.throws(() => validateReasoningEffort('maximum'),
    /Unknown reasoning effort/);

  console.log('  ✓ Reasoning-effort validation tests passed');
}

// ─── Run all tests ───────────────────────────────────────────────────────────

function runTests() {
  console.log('\n=== Provider Smoke Tests ===');
  try {
    testProviderInstantiation();
    testCliParsing();
    testReasoningEffortValidation();
    console.log('\nAll tests passed.\n');
  } catch (error) {
    console.error('\nTest failed:', error.message);
    process.exit(1);
  }
}

runTests();
