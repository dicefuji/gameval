/**
 * providers.js
 *
 * Unified provider interface for Arena War eval runner.
 * Supports Anthropic and OpenAI with a single callModel function.
 *
 * Interface:
 *   callModel(provider, model, prompt, maxTokens) -> { text, usage, latency }
 *
 * Usage:
 *   const { callModel } = require('./providers');
 *   const result = await callModel('anthropic', 'claude-sonnet-4-20250514', prompt, 2048);
 */

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

async function callOpenAI(client, model, prompt, maxTokens) {
  const start = Date.now();
  const response = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
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

async function callModel(provider, model, prompt, maxTokens) {
  const client = getProviderClient(provider);

  switch (provider) {
    case 'anthropic':
      return callAnthropic(client, model, prompt, maxTokens);
    case 'openai':
      return callOpenAI(client, model, prompt, maxTokens);
    default:
      throw new Error(`Unknown provider: ${provider}`);
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
  PROVIDERS,
};
