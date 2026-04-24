/**
 * providers.js
 *
 * Unified provider interface for Arena War eval runner.
 * Supports Anthropic and OpenAI with a single callModel function.
 *
 * Interface:
 *   callModel(provider, model, prompt, maxTokens, options?) -> { text, usage, latency }
 *
 * Options:
 *   reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh'
 *     Passed as reasoning.effort on OpenAI reasoning-family models
 *     (gpt-5, o1, o3, o4). Ignored for non-reasoning models and for
 *     Anthropic. Higher effort lets the model burn more tokens on
 *     internal reasoning before emitting visible output.
 *
 * Usage:
 *   const { callModel } = require('./providers');
 *   const result = await callModel('anthropic', 'claude-sonnet-4-20250514', prompt, 2048);
 *   const result = await callModel('openai', 'gpt-5.4-2026-03-05', prompt, 8192, { reasoningEffort: 'high' });
 */

const REASONING_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'];

const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

const PROVIDERS = ['anthropic', 'openai'];

function getProviderClient(provider) {
  switch (provider) {
    case 'anthropic': {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY is required for anthropic provider');
      }
      return new Anthropic();
    }
    case 'openai': {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is required for openai provider');
      }
      return new OpenAI();
    }
    default:
      throw new Error(`Unknown provider: ${provider}. Supported: ${PROVIDERS.join(', ')}`);
  }
}

async function callAnthropic(client, model, prompt, maxTokens) {
  const start = Date.now();
  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  const latency = Date.now() - start;

  const text = message.content.find(block => block.type === 'text')?.text ?? '';
  const usage = {
    prompt_tokens: message.usage?.input_tokens ?? 0,
    completion_tokens: message.usage?.output_tokens ?? 0,
    total_tokens: (message.usage?.input_tokens ?? 0) + (message.usage?.output_tokens ?? 0),
  };

  return { text, usage, latency };
}

// OpenAI's reasoning-model families (gpt-5, o1, o3, o4) require
// `max_completion_tokens` instead of `max_tokens`. Detect by model-id prefix.
function useCompletionTokensParam(model) {
  return /^(gpt-5|o1|o3|o4)/i.test(model);
}

// Token floor for reasoning models by effort level. Higher effort burns more
// tokens on internal reasoning before emitting visible output, so the budget
// has to cover both reasoning + code. Empirical floors chosen to avoid
// truncation in the smoke tests.
function reasoningTokenFloor(effort) {
  switch (effort) {
    case 'high': return 32768;
    case 'xhigh': return 65536;
    case 'medium':
    case 'low':
    default: return 16384;
  }
}

async function callOpenAI(client, model, prompt, maxTokens, options = {}) {
  const start = Date.now();
  const isReasoning = useCompletionTokensParam(model);
  const reasoningEffort = options.reasoningEffort;
  // Reasoning families burn tokens on internal reasoning before the visible
  // response, so the caller's budget has to cover both. Floor reasoning models
  // at a level sized to the requested effort.
  const floor = isReasoning ? reasoningTokenFloor(reasoningEffort) : 0;
  const effectiveMax = isReasoning ? Math.max(maxTokens, floor) : maxTokens;
  const tokenParam = isReasoning
    ? { max_completion_tokens: effectiveMax }
    : { max_tokens: effectiveMax };
  const reasoningParam = (isReasoning && reasoningEffort)
    ? { reasoning_effort: reasoningEffort }
    : {};
  const response = await client.chat.completions.create({
    model,
    ...tokenParam,
    ...reasoningParam,
    messages: [{ role: 'user', content: prompt }],
  });
  const latency = Date.now() - start;

  const text = response.choices?.[0]?.message?.content ?? '';
  const usage = {
    prompt_tokens: response.usage?.prompt_tokens ?? 0,
    completion_tokens: response.usage?.completion_tokens ?? 0,
    total_tokens: response.usage?.total_tokens ?? 0,
  };

  return { text, usage, latency };
}

async function callModel(provider, model, prompt, maxTokens, options = {}) {
  const client = getProviderClient(provider);

  switch (provider) {
    case 'anthropic':
      return callAnthropic(client, model, prompt, maxTokens);
    case 'openai':
      return callOpenAI(client, model, prompt, maxTokens, options);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

function validateReasoningEffort(effort) {
  if (effort == null) return;
  if (!REASONING_EFFORT_LEVELS.includes(effort)) {
    throw new Error(
      `Unknown reasoning effort: ${effort}. Supported: ${REASONING_EFFORT_LEVELS.join(', ')}`
    );
  }
}

function validateProvider(provider) {
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`Unknown provider: ${provider}. Supported: ${PROVIDERS.join(', ')}`);
  }
}

module.exports = {
  callModel,
  getProviderClient,
  validateProvider,
  validateReasoningEffort,
  PROVIDERS,
  REASONING_EFFORT_LEVELS,
};
