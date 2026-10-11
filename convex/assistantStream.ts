import type { ModelMessage, ToolSet } from 'ai';
import type { ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { runAssistantTurn, streamAssistantTurn } from './providers/aiSdk';

const DELTA_FLUSH_MS = 150;
const DELTA_FLUSH_CHARS = 40;

type StreamArgs<T extends ToolSet> = {
  threadId: Id<'assistantThreads'>;
  system: string;
  conversation: ModelMessage[];
  tools: T;
  maxSteps?: number;
  titleIfEmpty?: string;
  modelId?: string | null;
};

function uniq<T extends string>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

function tryParseJsonObject(s: string): unknown | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Detect a tool call the model accidentally wrote as text instead of using
 * the native function-calling channel. Handles common shapes:
 *   {"type":"function","name":"X","parameters":{...}}
 *   {"name":"X","arguments":{...}}
 *   {"tool":"X","input":{...}}
 *   <function_call>{"name":"X","arguments":{...}}</function_call>
 */
function detectJsonToolCall(text: string): {
  name: string;
  args: Record<string, unknown>;
} | null {
  if (!text) return null;
  let candidate = text.trim();

  // Strip wrapping markers like <function_call>…</function_call> or
  // <|python_tag|>…<|eom_id|>.
  const tagMatch = candidate.match(
    /<(?:function_call|tool_call|\|python_tag\|)\s*>?([\s\S]*?)(?:<\/(?:function_call|tool_call)>|<\|eom_id\|>|$)/i,
  );
  if (tagMatch) candidate = tagMatch[1].trim();

  // Try to find the first {...} block.
  const firstBrace = candidate.indexOf('{');
  if (firstBrace < 0) return null;

  // Find matching closing brace by depth counting.
  let depth = 0;
  let endIdx = -1;
  let inString = false;
  let escape = false;
  for (let i = firstBrace; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx < 0) return null;

  const jsonStr = candidate.slice(firstBrace, endIdx + 1);
  const parsed = tryParseJsonObject(jsonStr);
  if (!parsed || typeof parsed !== 'object') return null;

  const rec = parsed as Record<string, unknown>;

  const name =
    typeof rec.name === 'string'
      ? rec.name
      : typeof rec.tool === 'string'
        ? rec.tool
        : typeof rec.function === 'object' && rec.function !== null
          ? ((rec.function as { name?: string }).name ?? null)
          : null;
  if (!name) return null;

  const argsCandidate =
    rec.parameters ??
    rec.arguments ??
    rec.input ??
    rec.args ??
    (typeof rec.function === 'object' && rec.function !== null
      ? ((rec.function as { parameters?: unknown; arguments?: unknown }).parameters ??
        (rec.function as { arguments?: unknown }).arguments)
      : undefined) ??
    {};

  const argsObj =
    argsCandidate && typeof argsCandidate === 'object'
      ? (argsCandidate as Record<string, unknown>)
      : {};

  return { name, args: argsObj };
}

async function manuallyRunTool(
  tools: ToolSet,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tool = (tools as Record<string, unknown>)[name] as
    | {
        execute?: (input: unknown, opts: unknown) => Promise<unknown> | unknown;
      }
    | undefined;
  if (!tool || typeof tool.execute !== 'function') {
    throw new Error(`Tool '${name}' not found in registry`);
  }
  return await tool.execute(args, {
    toolCallId: `manual-${Date.now()}`,
    messages: [],
  });
}

export async function streamAssistantIntoThread<T extends ToolSet>(
  ctx: ActionCtx,
  args: StreamArgs<T>,
): Promise<{ assistantMessageId: Id<'assistantMessages'> }> {
  console.log('[assistantStream] start', {
    threadId: args.threadId,
    conversationLength: args.conversation.length,
    toolCount: Object.keys(args.tools as Record<string, unknown>).length,
    systemPreview: args.system.slice(0, 120),
    lastUser: (() => {
      const last = args.conversation[args.conversation.length - 1];
      if (!last) return null;
      const content =
        typeof last.content === 'string' ? last.content : safeJsonStringify(last.content);
      return content.slice(0, 200);
    })(),
  });

  // 1. Insert empty assistant row up front so the UI immediately shows
  // "running" state.
  const assistantMessageId = (await ctx.runMutation(
    internal.assistant.appendStreamingAssistantInternal,
    { threadId: args.threadId },
  )) as Id<'assistantMessages'>;

  const toolRowByCallId = new Map<string, Id<'assistantMessages'>>();
  const citedMessageIds: string[] = [];
  const citedContactIds: string[] = [];

  let buffer = '';
  let lastFlushAt = Date.now();
  let pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingFlush: Promise<unknown> | null = null;

  // Counters for the post-run diagnostic log.
  const eventTypeCounts: Record<string, number> = {};
  let totalCharsBuffered = 0;
  let totalFlushes = 0;
  let firstTextDeltaShape: string | null = null;
  let unknownDeltaFieldLogged = false;

  const flushDelta = async () => {
    if (buffer.length === 0) return;
    const delta = buffer;
    buffer = '';
    lastFlushAt = Date.now();
    totalFlushes++;
    pendingFlush = ctx
      .runMutation(internal.assistant.appendDeltaToAssistantInternal, {
        messageId: assistantMessageId,
        delta,
      })
      .catch((err) => {
        console.warn('[assistantStream] appendDelta failed', { err: String(err) });
      });
    await pendingFlush;
    pendingFlush = null;
  };

  const scheduleFlush = () => {
    if (pendingFlushTimer) return;
    pendingFlushTimer = setTimeout(() => {
      pendingFlushTimer = null;
      void flushDelta();
    }, DELTA_FLUSH_MS);
  };

  const harvestCited = (out: unknown) => {
    if (Array.isArray(out)) {
      for (const row of out) {
        if (row && typeof row === 'object') {
          const rec = row as { messageId?: unknown; contactId?: unknown };
          if (typeof rec.messageId === 'string') citedMessageIds.push(rec.messageId);
          if (typeof rec.contactId === 'string') citedContactIds.push(rec.contactId);
        }
      }
    } else if (out && typeof out === 'object') {
      const rec = out as {
        recent?: unknown;
        messageId?: unknown;
        contactId?: unknown;
      };
      if (Array.isArray(rec.recent)) harvestCited(rec.recent);
      if (typeof rec.messageId === 'string') citedMessageIds.push(rec.messageId);
      if (typeof rec.contactId === 'string') citedContactIds.push(rec.contactId);
    }
  };

  let streamErrored = false;
  let cancelled = false;

  // Throttled cancel check — at most once every 400ms.
  const CANCEL_POLL_MS = 400;
  let lastCancelCheckAt = 0;
  const checkCancel = async (): Promise<boolean> => {
    const now = Date.now();
    if (now - lastCancelCheckAt < CANCEL_POLL_MS) return false;
    lastCancelCheckAt = now;
    try {
      return (await ctx.runQuery(internal.assistant.isCancelRequestedInternal, {
        messageId: assistantMessageId,
      })) as boolean;
    } catch {
      return false;
    }
  };

  // Reasoning buffer (separate from main text buffer).
  let reasoningBuffer = '';
  let lastReasoningFlushAt = Date.now();
  const flushReasoning = async () => {
    if (reasoningBuffer.length === 0) return;
    const delta = reasoningBuffer;
    reasoningBuffer = '';
    lastReasoningFlushAt = Date.now();
    try {
      await ctx.runMutation(internal.assistant.appendReasoningDeltaInternal, {
        messageId: assistantMessageId,
        delta,
      });
    } catch (err) {
      console.warn('[assistantStream] appendReasoningDelta failed', {
        err: String(err),
      });
    }
  };

  try {
    const stream = streamAssistantTurn({
      system: args.system,
      messages: args.conversation,
      tools: args.tools,
      maxSteps: args.maxSteps ?? 6,
      modelId: args.modelId ?? null,
    });

    for await (const part of stream.fullStream) {
      if (await checkCancel()) {
        cancelled = true;
        console.log('[assistantStream] cancel requested — breaking loop');
        break;
      }
      const type = (part as { type?: string }).type ?? 'unknown';
      eventTypeCounts[type] = (eventTypeCounts[type] ?? 0) + 1;

      if (type === 'reasoning' || type === 'reasoning-delta') {
        const p = part as {
          text?: string;
          textDelta?: string;
          delta?: string;
        };
        const delta = p.text ?? p.textDelta ?? p.delta ?? '';
        if (delta.length === 0) continue;
        reasoningBuffer += delta;
        if (
          reasoningBuffer.length >= DELTA_FLUSH_CHARS ||
          Date.now() - lastReasoningFlushAt >= DELTA_FLUSH_MS
        ) {
          await flushReasoning();
        }
        continue;
      }

      if (type === 'text-delta') {
        // AI SDK versions disagree on the field name. Try them all.
        const p = part as {
          text?: string;
          textDelta?: string;
          delta?: string;
        };
        const delta = p.text ?? p.textDelta ?? p.delta ?? '';

        if (firstTextDeltaShape === null) {
          firstTextDeltaShape = safeJsonStringify(part).slice(0, 300);
          console.log('[assistantStream] first text-delta shape', {
            shape: firstTextDeltaShape,
            extractedLen: delta.length,
          });
        }

        if (delta.length === 0) {
          if (!unknownDeltaFieldLogged) {
            console.warn('[assistantStream] text-delta with empty extracted delta', {
              keys: Object.keys(part as object),
              raw: safeJsonStringify(part).slice(0, 200),
            });
            unknownDeltaFieldLogged = true;
          }
          continue;
        }
        totalCharsBuffered += delta.length;
        buffer += delta;
        if (buffer.length >= DELTA_FLUSH_CHARS || Date.now() - lastFlushAt >= DELTA_FLUSH_MS) {
          if (pendingFlushTimer) {
            clearTimeout(pendingFlushTimer);
            pendingFlushTimer = null;
          }
          await flushDelta();
        } else {
          scheduleFlush();
        }
      } else if (type === 'tool-call') {
        const p = part as {
          toolCallId?: string;
          toolName?: string;
          input?: unknown;
          args?: unknown;
        };
        console.log('[assistantStream] tool-call', {
          toolName: p.toolName,
          toolCallId: p.toolCallId,
          argsPreview: safeJsonStringify(p.input ?? p.args).slice(0, 200),
        });
        if (!p.toolCallId || !p.toolName) continue;
        const id = (await ctx.runMutation(internal.assistant.appendToolRunningInternal, {
          threadId: args.threadId,
          toolName: p.toolName,
          toolArgs: p.input ?? p.args,
          toolCallId: p.toolCallId,
        })) as Id<'assistantMessages'>;
        toolRowByCallId.set(p.toolCallId, id);
      } else if (type === 'tool-result') {
        const p = part as {
          toolCallId?: string;
          output?: unknown;
          result?: unknown;
        };
        const output = p.output ?? p.result;
        console.log('[assistantStream] tool-result', {
          toolCallId: p.toolCallId,
          outputKind: Array.isArray(output) ? `array(${output.length})` : typeof output,
          outputPreview: safeJsonStringify(output).slice(0, 200),
        });
        if (!p.toolCallId) continue;
        const rowId = toolRowByCallId.get(p.toolCallId);
        if (!rowId) {
          console.warn('[assistantStream] tool-result without matching call', {
            toolCallId: p.toolCallId,
          });
          continue;
        }
        harvestCited(output);
        await ctx.runMutation(internal.assistant.completeToolInternal, {
          messageId: rowId,
          toolResult: output,
          status: 'done',
        });
      } else if (type === 'error') {
        streamErrored = true;
        const errMsg = safeJsonStringify((part as { error?: unknown }).error);
        console.warn('[assistantStream] stream emitted error event', { err: errMsg });
      } else if (
        type !== 'text-start' &&
        type !== 'text-end' &&
        type !== 'step-start' &&
        type !== 'step-finish' &&
        type !== 'finish' &&
        type !== 'start' &&
        type !== 'tool-input-start' &&
        type !== 'tool-input-delta' &&
        type !== 'tool-input-end'
      ) {
        // Unknown event — surface its shape once.
        console.log('[assistantStream] unknown event type', {
          type,
          preview: safeJsonStringify(part).slice(0, 200),
        });
      }
    }
  } catch (err) {
    streamErrored = true;
    const errorMessage = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.warn('[assistantStream] iteration failed', {
      err: errorMessage,
      stack: stack?.slice(0, 600),
    });
  }

  if (pendingFlushTimer) {
    clearTimeout(pendingFlushTimer);
    pendingFlushTimer = null;
  }
  if (pendingFlush) await pendingFlush;
  if (buffer.length > 0) await flushDelta();
  if (reasoningBuffer.length > 0) await flushReasoning();

  // Mark any tool rows still in "running" state as errored.
  for (const [, rowId] of toolRowByCallId) {
    try {
      const row = await ctx.runQuery(internal.assistant.getMessageByIdInternal, {
        messageId: rowId,
      });
      if (row && row.status === 'running') {
        await ctx.runMutation(internal.assistant.completeToolInternal, {
          messageId: rowId,
          toolResult: null,
          status: 'error',
        });
      }
    } catch (err) {
      console.warn('tool row finalize check failed', { err: String(err) });
    }
  }

  // Fallback: if the model emitted a tool call as JSON text instead of using
  // the native function-calling protocol, detect it, execute it ourselves,
  // and re-prompt for a natural-language answer.
  if (toolRowByCallId.size === 0) {
    const finalRow = await ctx.runQuery(internal.assistant.getMessageByIdInternal, {
      messageId: assistantMessageId,
    });
    const finalText = finalRow?.content ?? '';
    const detected = detectJsonToolCall(finalText);
    if (detected) {
      console.log('[assistantStream] JSON-as-text tool call detected', {
        toolName: detected.name,
        argsPreview: safeJsonStringify(detected.args).slice(0, 200),
      });
      try {
        const fallbackCallId = `manual-${Date.now()}`;
        const toolRowId = (await ctx.runMutation(internal.assistant.appendToolRunningInternal, {
          threadId: args.threadId,
          toolName: detected.name,
          toolArgs: detected.args,
          toolCallId: fallbackCallId,
        })) as Id<'assistantMessages'>;

        let toolResult: unknown = null;
        let toolStatus: 'done' | 'error' = 'done';
        try {
          toolResult = await manuallyRunTool(args.tools, detected.name, detected.args);
          harvestCited(toolResult);
        } catch (err) {
          toolResult = {
            error: err instanceof Error ? err.message : String(err),
          };
          toolStatus = 'error';
        }

        await ctx.runMutation(internal.assistant.completeToolInternal, {
          messageId: toolRowId,
          toolResult,
          status: toolStatus,
        });

        // Re-prompt the model with the tool result so it writes a natural
        // answer (no tools this round — just plain text).
        await ctx.runMutation(internal.assistant.clearAssistantContentInternal, {
          messageId: assistantMessageId,
        });

        try {
          const naturalAnswer = await runAssistantTurn({
            system:
              args.system +
              "\n\nThe user's question has just been answered by a tool. Use the tool result below to write a concise, conversational natural-language answer. Plain text only — no JSON, no code blocks, no tool-call syntax.",
            messages: [
              ...args.conversation,
              {
                role: 'assistant',
                content: `(I'll look that up via ${detected.name}.)`,
              },
              {
                role: 'user',
                content: `Here is the data the ${detected.name} tool returned:\n${JSON.stringify(
                  toolResult,
                  null,
                  2,
                ).slice(
                  0,
                  4000,
                )}\n\nWrite a concise, conversational answer to my original question using this data. Plain text only.`,
              },
            ],
            tools: {} as ToolSet,
            maxSteps: 1,
            modelId: args.modelId ?? null,
          });
          const text = (naturalAnswer.text ?? '').trim();
          if (text.length > 0) {
            await ctx.runMutation(internal.assistant.appendDeltaToAssistantInternal, {
              messageId: assistantMessageId,
              delta: text,
            });
          } else {
            await ctx.runMutation(internal.assistant.appendDeltaToAssistantInternal, {
              messageId: assistantMessageId,
              delta: "Here's what I found.",
            });
          }
        } catch (err) {
          console.warn('[assistantStream] natural-answer pass failed', {
            err: err instanceof Error ? err.message : String(err),
          });
          await ctx.runMutation(internal.assistant.appendDeltaToAssistantInternal, {
            messageId: assistantMessageId,
            delta: "Here's what I found.",
          });
        }
      } catch (err) {
        console.warn('[assistantStream] JSON fallback failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const finalStatus: 'done' | 'error' = cancelled || streamErrored ? 'error' : 'done';
  const finalSuffix = cancelled
    ? '\n\n_(stopped)_'
    : streamErrored
      ? '\n\n(Run ended with an error.)'
      : undefined;

  await ctx.runMutation(internal.assistant.completeAssistantInternal, {
    messageId: assistantMessageId,
    citedMessageIds: uniq(citedMessageIds).slice(0, 20) as Id<'messages'>[],
    citedContactIds: uniq(citedContactIds).slice(0, 20) as Id<'contacts'>[],
    titleIfEmpty: args.titleIfEmpty,
    status: finalStatus,
    contentSuffix: finalSuffix,
  });

  // Schedule follow-up suggestions (non-blocking, only on clean completions).
  if (finalStatus === 'done') {
    try {
      await ctx.scheduler.runAfter(0, internal.assistantFollowUps.generateFollowUpsInternal, {
        assistantMessageId,
        threadId: args.threadId,
      });
    } catch (err) {
      console.warn('[assistantStream] scheduling follow-ups failed', {
        err: String(err),
      });
    }
  }

  // Read back the final content so we can see what the model actually
  // produced — critical when it streams XML-format tool calls as text.
  let finalPreview = '';
  try {
    const finalRow = await ctx.runQuery(internal.assistant.getMessageByIdInternal, {
      messageId: assistantMessageId,
    });
    finalPreview = (finalRow?.content ?? '').slice(0, 400);
  } catch {
    // ignore
  }

  console.log('[assistantStream] done', {
    threadId: args.threadId,
    status: streamErrored ? 'error' : 'done',
    totalCharsBuffered,
    totalFlushes,
    toolCalls: toolRowByCallId.size,
    citedMessageCount: citedMessageIds.length,
    eventTypeCounts,
    finalPreview,
  });

  return { assistantMessageId };
}
