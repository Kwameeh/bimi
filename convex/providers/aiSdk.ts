import {
  generateObject,
  generateText,
  jsonSchema,
  stepCountIs,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import { assistantSelection, modelSelection } from './config';
import { languageModel } from './language';

export function getAssistantModel(modelId?: string | null): LanguageModel {
  return languageModel(assistantSelection(modelId));
}

export type AssistantTurnArgs<T extends ToolSet> = {
  system: string;
  messages: ModelMessage[];
  tools: T;
  maxSteps?: number;
  temperature?: number;
  modelId?: string | null;
};

export async function runAssistantTurn<T extends ToolSet>(args: AssistantTurnArgs<T>) {
  const result = await generateText({
    model: getAssistantModel(args.modelId),
    system: args.system,
    messages: args.messages,
    tools: args.tools,
    stopWhen: stepCountIs(args.maxSteps ?? 5),
    temperature: args.temperature ?? 0.3,
  });
  return result;
}

/**
 * JSON extraction through the configured provider. Structured output falls back
 * to text for models without schema support; callers validate the JSON.
 * Always returns a raw JSON string for the caller's existing parser to
 * validate.
 */
export async function runJsonExtraction(args: {
  system: string;
  messages: ModelMessage[];
  schema: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const selection = modelSelection('json');
  const model = languageModel(selection);
  const maxOutputTokens =
    selection.provider === 'dahl' ? Math.max(args.maxTokens ?? 1024, 600) : args.maxTokens;

  try {
    const result = await generateObject({
      model,
      system: args.system,
      messages: args.messages,
      schema: jsonSchema(args.schema),
      temperature: args.temperature ?? 0.2,
      maxOutputTokens,
    });
    return JSON.stringify(result.object);
  } catch (err) {
    // Expected on providers that lack native json_schema support (like Dahl with DeepSeek)
  }
  const result = await generateText({
    model,
    system: `${args.system}\nReturn only JSON matching this schema: ${JSON.stringify(args.schema)}`,
    messages: args.messages,
    temperature: args.temperature ?? 0.2,
    maxOutputTokens,
  });
  // Some reasoning models put output in reasoningText instead of text.
  let text =
    (result.text && result.text.length > 0
      ? result.text
      : (result as unknown as { reasoningText?: string }).reasoningText) ?? '';
  // Strip any <think>...</think> if present
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  return text;
}

export function streamAssistantTurn<T extends ToolSet>(args: AssistantTurnArgs<T>) {
  return streamText({
    model: getAssistantModel(args.modelId),
    system: args.system,
    messages: args.messages,
    tools: args.tools,
    toolChoice: 'auto',
    stopWhen: stepCountIs(args.maxSteps ?? 8),
    // Temperature 0 for deterministic tool calling, per AI SDK best practices.
    temperature: args.temperature ?? 0,
  });
}
