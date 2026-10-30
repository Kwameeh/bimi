import { ASSISTANT_MODELS, DEFAULT_ASSISTANT_MODEL_ID, JSON_EXTRACTION_MODEL_ID } from './models';

export type AiProvider =
  | 'cloudflare'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'groq'
  | 'deepseek'
  | 'dahl'
  | 'openai-compatible';
export type Environment = Record<string, string | undefined>;
export type ModelSelection = { provider: AiProvider; model: string };
export type ConfiguredModel = ModelSelection & {
  id: string;
  label: string;
  blurb: string;
};

export const PROVIDERS: Record<
  AiProvider,
  { label: string; key: string; prefix: string; baseURL?: string }
> = {
  cloudflare: {
    label: 'Cloudflare',
    key: 'CLOUDFLARE_API_TOKEN',
    prefix: 'CLOUDFLARE_WORKERS_AI_ASSISTANT',
  },
  openai: { label: 'OpenAI', key: 'OPENAI_API_KEY', prefix: 'OPENAI' },
  anthropic: {
    label: 'Anthropic',
    key: 'ANTHROPIC_API_KEY',
    prefix: 'ANTHROPIC',
  },
  google: {
    label: 'Google',
    key: 'GOOGLE_GENERATIVE_AI_API_KEY',
    prefix: 'GOOGLE',
  },
  groq: {
    label: 'Groq',
    key: 'GROQ_API_KEY',
    prefix: 'GROQ',
    baseURL: 'https://api.groq.com/openai/v1',
  },
  deepseek: {
    label: 'DeepSeek',
    key: 'DEEPSEEK_API_KEY',
    prefix: 'DEEPSEEK',
    baseURL: 'https://api.deepseek.com/v1',
  },
  dahl: {
    label: 'Dahl',
    key: 'DAHL_API_KEY',
    prefix: 'DAHL',
    baseURL: 'https://inference.dahl.global/v1',
  },
  'openai-compatible': {
    label: 'OpenAI compatible',
    key: 'OPENAI_COMPATIBLE_API_KEY',
    prefix: 'OPENAI_COMPATIBLE',
  },
};

export const DAHL_DEFAULT_MODELS = [
  'deepseek-ai/DeepSeek-V4-Flash-0731',
  'zai-org/GLM-5.3-Flash',
  'MiniMaxAI/MiniMax-M2.7',
] as const;

export const KNOWN_MODEL_METADATA: Record<string, { label: string; blurb: string }> = {
  'deepseek-ai/DeepSeek-V4-Flash-0731': {
    label: 'DeepSeek V4 Flash',
    blurb: 'Fast reasoning and code intelligence via Dahl.',
  },
  'zai-org/GLM-5.3-Flash': {
    label: 'GLM 5.3 Flash',
    blurb: 'Bilingual multimodal reasoning model by Zhipu via Dahl.',
  },
  'MiniMaxAI/MiniMax-M2.7': {
    label: 'MiniMax M2.7',
    blurb: 'Advanced general-purpose reasoning model by MiniMax via Dahl.',
  },
};

export function envValue(name: string, env: Environment = process.env): string | null {
  return env[name]?.trim() || null;
}

export function providerApiKey(provider: AiProvider, env: Environment = process.env): string | null {
  if (provider === 'dahl') {
    return envValue('DAHL_API_KEY', env) ?? envValue('DAHL_INFERENCE_API_KEY', env);
  }
  return envValue(PROVIDERS[provider].key, env);
}

export function requireProviderApiKey(
  provider: AiProvider,
  env: Environment = process.env,
): string {
  const key = providerApiKey(provider, env);
  if (!key) throw new Error(`AI provider not configured: set ${PROVIDERS[provider].key}`);
  return key;
}

export function readProvider(value: string | null, fallback: AiProvider): AiProvider {
  if (!value) return fallback;
  if (!Object.hasOwn(PROVIDERS, value)) throw new Error(`Unknown AI provider: ${value}`);
  return value as AiProvider;
}

export function requireEnv(name: string, env: Environment = process.env): string {
  const value = envValue(name, env);
  if (!value) throw new Error(`AI provider not configured: set ${name}`);
  return value;
}

export function providerConfigured(provider: AiProvider, env: Environment = process.env): boolean {
  return (
    Boolean(providerApiKey(provider, env)) &&
    (provider !== 'cloudflare' || Boolean(envValue('CLOUDFLARE_ACCOUNT_ID', env))) &&
    (provider !== 'openai-compatible' || Boolean(envValue('OPENAI_COMPATIBLE_BASE_URL', env)))
  );
}

export function defaultProvider(env: Environment = process.env): AiProvider {
  const explicit = envValue('BIMI_AI_PROVIDER', env);
  if (explicit) return readProvider(explicit, 'cloudflare');
  if (providerConfigured('cloudflare', env)) return 'cloudflare';
  for (const provider of Object.keys(PROVIDERS) as AiProvider[]) {
    if (providerConfigured(provider, env)) return provider;
  }
  return 'cloudflare';
}

export function modelSelection(
  purpose: 'assistant' | 'text' | 'json' | 'reply' | 'summary' = 'assistant',
  env: Environment = process.env,
): ModelSelection {
  const provider = defaultProvider(env);
  const overrides = {
    assistant: 'BIMI_AI_MODEL',
    text: 'BIMI_AI_TEXT_MODEL',
    json: 'BIMI_AI_JSON_MODEL',
    reply: 'BIMI_AI_REPLY_MODEL',
    summary: 'BIMI_AI_SUMMARY_MODEL',
  };
  const override = envValue(overrides[purpose], env);
  const shared = envValue('BIMI_AI_MODEL', env);
  let model = override ?? shared ?? envValue(`${PROVIDERS[provider].prefix}_MODEL`, env);
  if (provider === 'cloudflare' && !override && !shared) {
    model =
      purpose === 'assistant'
        ? (model ?? DEFAULT_ASSISTANT_MODEL_ID)
        : purpose === 'json'
          ? JSON_EXTRACTION_MODEL_ID
          : purpose === 'summary'
            ? (envValue('CLOUDFLARE_WORKERS_AI_SUMMARY_MODEL', env) ??
              envValue('CLOUDFLARE_WORKERS_AI_CHAT_MODEL', env) ??
              '@cf/meta/llama-3.1-8b-instruct')
            : (envValue('CLOUDFLARE_WORKERS_AI_CHAT_MODEL', env) ??
              '@cf/meta/llama-3.1-8b-instruct');
  } else if (provider === 'dahl' && !override && !shared && !model) {
    model = 'deepseek-ai/DeepSeek-V4-Flash-0731';
  }
  if (!model)
    throw new Error(
      `AI model not configured: set ${PROVIDERS[provider].prefix}_MODEL or BIMI_AI_MODEL`,
    );
  return { provider, model };
}

export function selectionId(selection: ModelSelection): string {
  return selection.provider === 'cloudflare'
    ? selection.model
    : `${selection.provider}/${selection.model}`;
}

/** Safe to return to clients: only model metadata, never keys or endpoint URLs. */
export function configuredModels(env: Environment = process.env): ConfiguredModel[] {
  const result: ConfiguredModel[] = [];
  const activeProvider = defaultProvider(env);
  for (const provider of Object.keys(PROVIDERS) as AiProvider[]) {
    if (!providerConfigured(provider, env)) continue;
    const definition = PROVIDERS[provider];
    const rawModels = envValue(`${definition.prefix}_MODELS`, env);
    const models = new Set(
      (rawModels ?? '')
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
    );
    const preferred = envValue(`${definition.prefix}_MODEL`, env);
    if (preferred) models.add(preferred);
    if (provider === 'cloudflare') ASSISTANT_MODELS.forEach((m) => models.add(m.id));
    if (provider === 'dahl' && !rawModels) {
      DAHL_DEFAULT_MODELS.forEach((m) => models.add(m));
    }
    if (activeProvider === provider) {
      const shared = envValue('BIMI_AI_MODEL', env);
      if (shared) models.add(shared);
    }
    for (const model of models) {
      const knownCf =
        provider === 'cloudflare' ? ASSISTANT_MODELS.find((m) => m.id === model) : undefined;
      const knownMetadata = KNOWN_MODEL_METADATA[model];
      const label = knownCf?.label ?? knownMetadata?.label ?? model;
      const blurb =
        knownCf?.blurb ?? knownMetadata?.blurb ?? 'Configured for this Bimi deployment.';
      result.push({
        provider,
        model,
        id: selectionId({ provider, model }),
        label: `${definition.label} · ${label}`,
        blurb,
      });
    }
  }
  return result;
}

export function assistantSelection(
  id?: string | null,
  env: Environment = process.env,
): ModelSelection {
  if (!id) return modelSelection('assistant', env);
  const selected = configuredModels(env).find((m) => m.id === id);
  if (!selected)
    throw new Error("This conversation's model is unavailable. Select a configured model.");
  return { provider: selected.provider, model: selected.model };
}
