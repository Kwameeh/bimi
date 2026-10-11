import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { envValue, PROVIDERS, requireEnv, type ModelSelection } from "./config";

/** Provider construction is the only place that knows each SDK's API. */
export function languageModel({
  provider,
  model,
}: ModelSelection): LanguageModel {
  const apiKey = requireEnv(PROVIDERS[provider].key);
  switch (provider) {
    case "cloudflare": {
      const workers = createWorkersAI({
        accountId: requireEnv("CLOUDFLARE_ACCOUNT_ID"),
        apiKey,
      });
      return workers(model as Parameters<typeof workers>[0]);
    }
    case "openai":
      return createOpenAI({ apiKey }).chat(model);
    case "anthropic":
      return createAnthropic({ apiKey })(model);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(model);
    default: {
      const baseURL =
        provider === "openai-compatible"
          ? requireEnv("OPENAI_COMPATIBLE_BASE_URL")
          : PROVIDERS[provider].baseURL!;
      return createOpenAICompatible({
        name: provider,
        apiKey,
        baseURL,
        supportsStructuredOutputs:
          envValue("OPENAI_COMPATIBLE_STRUCTURED_OUTPUTS") === "true",
      })(model);
    }
  }
}
