import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { runJsonExtraction } from "./providers/aiSdk";

// JSON schema for structured output, matching parseFollowUps' expected shape.
const FOLLOW_UPS_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: { type: "string" },
    },
  },
  required: ["questions"],
} as const;

export function parseFollowUps(raw: string): string[] {
  if (!raw) return [];
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as {
      questions?: unknown;
    };
    if (!Array.isArray(obj.questions)) return [];
    return obj.questions
      .filter((q): q is string => typeof q === "string")
      .map((q) => q.trim())
      .filter((q) => q.length > 0 && q.length <= 80)
      .slice(0, 3);
  } catch {
    return [];
  }
}

export const generateFollowUpsInternal = internalAction({
  args: {
    assistantMessageId: v.id("assistantMessages"),
    threadId: v.id("assistantThreads"),
  },
  handler: async (ctx, args): Promise<{ count: number }> => {
    const thread = await ctx.runQuery(
      internal.assistant.getThreadInternal,
      { threadId: args.threadId },
    );
    if (!thread) return { count: 0 };

    const history = await ctx.runQuery(
      internal.assistant.listMessagesInternal,
      { threadId: args.threadId },
    );

    const conversation = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-6)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: (m.content ?? "").slice(0, 600),
      }));

    if (conversation.length === 0) return { count: 0 };

    try {
      const raw = await runJsonExtraction({
        system: `You suggest follow-up questions for a WhatsApp assistant. Given the conversation, propose exactly 3 short follow-up questions the user might naturally ask next. Use the same tone as the user. Respond with ONLY this JSON:
{"questions":["...","...","..."]}

Rules:
- Each question max 8 words.
- Mix: 1 about going deeper on the same topic, 1 about an adjacent action, 1 about a different topic from their WhatsApp life.
- Never repeat what the user already asked.
- No preamble, no explanation, just the JSON.`,
        messages: conversation,
        schema: FOLLOW_UPS_SCHEMA,
        temperature: 0.4,
      });

      const followUps = parseFollowUps(raw);
      if (followUps.length === 0) {
        console.log("[assistantFollowUps] empty/unparseable result", {
          text: raw.slice(0, 200),
        });
        return { count: 0 };
      }

      await ctx.runMutation(
        internal.assistant.setSuggestedFollowUpsInternal,
        { messageId: args.assistantMessageId, followUps },
      );
      return { count: followUps.length };
    } catch (err) {
      console.warn("[assistantFollowUps] generation failed", {
        err: String(err),
      });
      return { count: 0 };
    }
  },
});
