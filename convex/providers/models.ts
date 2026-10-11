/**
 * Legacy Cloudflare model catalog. Runtime availability and cross-provider
 * selection live in config.ts; this module is safe to import from the client.
 *
 * Only models with reliable native function-calling support belong here.
 * The AI SDK's `streamText` needs the provider to emit structured tool-call
 * events; models that emit XML/JSON tool calls as text break that pipeline
 * (we have a fallback parser in `assistantStream.ts`, but it's a backstop).
 */

export type AssistantModelId =
  | "@cf/openai/gpt-oss-120b"
  | "@cf/openai/gpt-oss-20b"
  | "@cf/meta/llama-4-scout-17b-16e-instruct"
  | "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
  | "@cf/mistralai/mistral-small-3.1-24b-instruct"
  | "@cf/qwen/qwen2.5-coder-32b-instruct";

export type AssistantModelInfo = {
  id: AssistantModelId;
  label: string;
  blurb: string;
};

export const ASSISTANT_MODELS: readonly AssistantModelInfo[] = [
  {
    id: "@cf/openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    blurb: "Large model for assistant conversations and tools.",
  },
  {
    id: "@cf/openai/gpt-oss-20b",
    label: "GPT-OSS 20B",
    blurb: "Smaller model for assistant conversations and tools.",
  },
  {
    id: "@cf/meta/llama-4-scout-17b-16e-instruct",
    label: "Llama 4 Scout",
    blurb: "Multilingual Llama model.",
  },
  {
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    label: "Llama 3.3 70B",
    blurb: "Previous default. Tool calling can drift.",
  },
  {
    id: "@cf/mistralai/mistral-small-3.1-24b-instruct",
    label: "Mistral Small 3.1",
    blurb: "Compact, fast, decent tool calling.",
  },
  {
    id: "@cf/qwen/qwen2.5-coder-32b-instruct",
    label: "Qwen 2.5 32B",
    blurb: "Stronger on structured output.",
  },
] as const;

export const DEFAULT_ASSISTANT_MODEL_ID: AssistantModelId =
  "@cf/openai/gpt-oss-120b";

/**
 * Model used for one-shot JSON extraction tasks (memory extraction, follow-up
 * suggestions, action plan synthesis). MUST be a non-reasoning model — the
 * gpt-oss family routes its output into a separate reasoning stream that
 * `generateText().text` does NOT expose, so they return empty text. Llama 3.3
 * 70B is reliable here.
 */
export const JSON_EXTRACTION_MODEL_ID: AssistantModelId =
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
