import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

const PROMISE_PATTERN =
  /\b(i['']?ll|i will|i'?m gonna|gonna|let me|will get back|get back to you|follow ?up|circle back|check and|i'?ll send|i'?ll review|i'?ll confirm|i'?ll check)\b/i;

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

function parseFollowupExtraction(
  raw: string,
  nowMs: number,
): { title?: string; dueAt?: number } {
  try {
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd <= jsonStart) return {};
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
      title?: unknown;
      dueAt?: unknown;
    };
    const title =
      typeof parsed.title === "string" && parsed.title.trim().length > 0
        ? parsed.title.trim().slice(0, 80)
        : undefined;
    let dueAt: number | undefined;
    if (typeof parsed.dueAt === "string" && parsed.dueAt.trim().length > 0) {
      const d = new Date(parsed.dueAt);
      if (!Number.isNaN(d.getTime()) && d.getTime() > nowMs) dueAt = d.getTime();
    } else if (
      typeof parsed.dueAt === "number" &&
      Number.isFinite(parsed.dueAt) &&
      parsed.dueAt > nowMs
    ) {
      dueAt = parsed.dueAt;
    }
    return { title, dueAt };
  } catch {
    return {};
  }
}

export const existingFollowupForSourceInternal = internalQuery({
  args: { sourceMessageId: v.id("messages") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("reminders")
      .withIndex("by_sourceMessage", (q) =>
        q.eq("sourceMessageId", args.sourceMessageId),
      )
      .filter((q) => q.eq(q.field("kind"), "ai_followup"))
      .first();
    return existing !== null;
  },
});

export const detectFollowupInternal = internalAction({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args): Promise<{ reminderId: string | null }> => {
    const context = await ctx.runQuery(internal.messages.getReplyContext, {
      messageId: args.messageId,
      historyLimit: 4,
    });
    if (!context) return { reminderId: null };
    const m = context.message;
    if (!m.fromMe) return { reminderId: null };
    if (m.sentByAi === true) return { reminderId: null };

    const text = (m.text ?? "").trim();
    if (text.length < 6) return { reminderId: null };
    if (!PROMISE_PATTERN.test(text)) return { reminderId: null };

    const alreadyExists = await ctx.runQuery(
      internal.followups.existingFollowupForSourceInternal,
      { sourceMessageId: args.messageId },
    );
    if (alreadyExists) return { reminderId: null };

    const pref = await ctx.runQuery(internal.userPreferences.getInternal, {
      instance: m.instance,
    });
    const { formatDateContext, ISO_OFFSET_NOTE } = await import("./dateContext");
    const nowMs = Date.now();
    const system = [
      `The user (writing this message themselves) promised a follow-up. Now is ${formatDateContext(pref?.quietHoursTimezone)}. ${ISO_OFFSET_NOTE}`,
      'Return JSON ONLY: { "title": short imperative starting with a verb (e.g. "Send the report"), "dueAt": ISO datetime|null }.',
      "Pick dueAt from time cues:",
      '- "tomorrow" → tomorrow 9am local',
      '- "later" / "by EOD" / "end of day" → today 6pm',
      '- "this weekend" → next Saturday 10am',
      '- "next week" → next Monday 9am',
      "- unspecified → null",
      'If the message is not actually a follow-up promise, return { "title": "", "dueAt": null }.',
    ].join("\n");

    const userBlock = [
      context.contactName ? `Chat with: ${context.contactName}` : "",
      `Outgoing message: ${text}`,
    ]
      .filter(Boolean)
      .join("\n");

    let raw: string;
    try {
      const { generateText } = await import("./providers/processing");
      raw = await generateText({
        system,
        user: userBlock,
        maxTokens: 200,
        temperature: 0.2,
      });
    } catch (err) {
      console.warn("detectFollowupInternal: LLM failed (non-fatal)", {
        messageId: args.messageId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { reminderId: null };
    }

    const parsed = parseFollowupExtraction(raw, nowMs);
    if (!parsed.title) return { reminderId: null };

    const remindAt = parsed.dueAt ?? nowMs + FOUR_HOURS_MS;

    const reminderId = await ctx.runMutation(internal.reminders.createInternal, {
      instance: m.instance,
      contactId: m.contactId,
      sourceMessageId: args.messageId,
      text: parsed.title,
      remindAt,
      status: "suggested",
      kind: "ai_followup",
    });
    return { reminderId: reminderId as unknown as string };
  },
});
