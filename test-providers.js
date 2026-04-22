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
  const { parseCliArgs, DEFAULT_PROVIDER } = require('./eval-runner');

  // Default provider
  const defaults = parseCliArgs(['node', 'eval-runner.js']);
  assert.strictEqual(defaults.provider, DEFAULT_PROVIDER,
    'Default provider should be anthropic');

  // Explicit provider flag
  const openaiArgs = parseCliArgs(['node', 'eval-runner.js', '--provider', 'openai']);
  assert.strictEqual(openaiArgs.provider, 'openai',
    'Should parse --provider openai');

  const anthropicArgs = parseCliArgs(['node', 'eval-runner.js', '--provider', 'anthropic']);
  assert.strictEqual(anthropicArgs.provider, 'anthropic',
    'Should parse --provider anthropic');

  // Multiple models with provider
  const multiArgs = parseCliArgs([
    'node', 'eval-runner.js',
    '--provider', 'openai',
    '--model', 'gpt-4o',
    '--model', 'gpt-4-turbo',
  ]);
  assert.strictEqual(multiArgs.provider, 'openai');
  assert.deepStrictEqual(multiArgs.models, ['gpt-4o', 'gpt-4-turbo']);

  console.log('  ✓ CLI flag parsing tests passed');
}

// ─── Run all tests ───────────────────────────────────────────────────────────

function runTests() {
  console.log('\n=== Provider Smoke Tests ===');
  try {
    testProviderInstantiation();
    testCliParsing();
    console.log('\nAll tests passed.\n');
  } catch (error) {
    console.error('\nTest failed:', error.message);
    process.exit(1);
  }
}

runTests();
