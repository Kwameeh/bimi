import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assistantSelection,
  configuredModels,
  modelSelection,
  readProvider,
  type Environment,
} from './config';
import { getAssistantModel } from './aiSdk';

afterEach(() => vi.unstubAllEnvs());

describe('AI provider selection', () => {
  it('preserves existing Cloudflare defaults and purpose overrides', () => {
    expect(modelSelection('assistant', {})).toEqual({
      provider: 'cloudflare',
      model: '@cf/openai/gpt-oss-120b',
    });
    expect(
      modelSelection('text', {
        CLOUDFLARE_WORKERS_AI_CHAT_MODEL: 'custom-chat',
      }).model,
    ).toBe('custom-chat');
    expect(modelSelection('json', {}).model).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    expect(
      modelSelection('summary', {
        CLOUDFLARE_WORKERS_AI_SUMMARY_MODEL: 'custom-summary',
      }).model,
    ).toBe('custom-summary');
  });

  it('routes background tasks to the deployment provider with task overrides', () => {
    const env = {
      BIMI_AI_PROVIDER: 'anthropic',
      ANTHROPIC_MODEL: 'test-model',
      BIMI_AI_JSON_MODEL: 'json-model',
      BIMI_AI_SUMMARY_MODEL: 'summary-model',
    };
    expect(modelSelection('text', env)).toEqual({
      provider: 'anthropic',
      model: 'test-model',
    });
    expect(modelSelection('json', env).model).toBe('json-model');
    expect(modelSelection('summary', env).model).toBe('summary-model');
  });

  it('exposes only configured providers, with deduplicated models and no secrets', () => {
    const env: Environment = {
      OPENAI_API_KEY: 'private-test-key',
      OPENAI_MODEL: 'model-a',
      OPENAI_MODELS: 'model-a, model-b, ',
      DEEPSEEK_MODEL: 'unconfigured',
      OPENAI_COMPATIBLE_API_KEY: 'other-private-key',
      OPENAI_COMPATIBLE_MODEL: 'local-model',
    };
    const models = configuredModels(env);
    expect(models.map((m) => m.id)).toEqual(['openai/model-a', 'openai/model-b']);
    expect(JSON.stringify(models)).not.toContain('private');
    env.OPENAI_COMPATIBLE_BASE_URL = 'http://localhost:8000/v1';
    expect(configuredModels(env).at(-1)?.id).toBe('openai-compatible/local-model');
  });

  it('keeps saved Cloudflare IDs usable and supports per-thread provider switches', () => {
    const env = {
      CLOUDFLARE_API_TOKEN: 'test',
      CLOUDFLARE_ACCOUNT_ID: 'account',
      DEEPSEEK_API_KEY: 'test',
      DEEPSEEK_MODEL: 'test-model',
    };
    expect(assistantSelection('@cf/openai/gpt-oss-20b', env).provider).toBe('cloudflare');
    expect(assistantSelection('deepseek/test-model', env)).toEqual({
      provider: 'deepseek',
      model: 'test-model',
    });
    expect(() => assistantSelection('openai/arbitrary-model', env)).toThrow('unavailable');
  });

  it('allows custom Cloudflare models without silently reverting to a default', () => {
    const env = {
      CLOUDFLARE_API_TOKEN: 'test',
      CLOUDFLARE_ACCOUNT_ID: 'account',
      CLOUDFLARE_WORKERS_AI_ASSISTANT_MODEL: '@cf/custom/model',
    };
    expect(assistantSelection('@cf/custom/model', env).model).toBe('@cf/custom/model');
  });

  it('fails clearly on unknown providers, missing models and missing credentials', () => {
    expect(() => readProvider('typo', 'cloudflare')).toThrow('Unknown AI provider');
    expect(() => modelSelection('assistant', { BIMI_AI_PROVIDER: 'openai' })).toThrow(
      'OPENAI_MODEL',
    );
    vi.stubEnv('BIMI_AI_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_MODEL', 'test-model');
    vi.stubEnv('OPENAI_API_KEY', '');
    expect(() => getAssistantModel()).toThrow('OPENAI_API_KEY');
  });

  it.each([
    ['openai', 'OPENAI_API_KEY', 'OPENAI_MODEL'],
    ['anthropic', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'],
    ['google', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_MODEL'],
    ['groq', 'GROQ_API_KEY', 'GROQ_MODEL'],
    ['deepseek', 'DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL'],
    ['openai-compatible', 'OPENAI_COMPATIBLE_API_KEY', 'OPENAI_COMPATIBLE_MODEL'],
  ])('constructs the %s adapter with the exact configured model', (provider, key, modelEnv) => {
    vi.stubEnv('BIMI_AI_PROVIDER', provider);
    vi.stubEnv('BIMI_AI_MODEL', '');
    vi.stubEnv(key, 'test-key');
    vi.stubEnv(modelEnv, 'test-model');
    vi.stubEnv('OPENAI_COMPATIBLE_BASE_URL', 'http://localhost:8000/v1');
    const model = getAssistantModel();
    expect(typeof model).toBe('object');
    if (typeof model !== 'string') expect(model.modelId).toBe('test-model');
  });
});
