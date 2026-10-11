import { v } from "convex/values";
import {
  action,
  internalMutation,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { refreshChatState } from "./chatState";
import { prepareMediaForManualAi } from "./manualMediaProcessing";

/**
 * Badge flags on an unread message feed the chat-list row, so any change has to
 * be written through to the contact's denormalized state.
 */
async function refreshForMessage(
  ctx: MutationCtx,
  messageId: Id<"messages">,
): Promise<void> {
  const message = await ctx.db.get(messageId);
  if (message) await refreshChatState(ctx, message.contactId);
}

async function getManualAiContext(
  ctx: ActionCtx,
  messageId: Id<"messages">,
  historyLimit: number,
) {
  const message = await ctx.runQuery(internal.messages.getMessageForProcessing, {
    messageId,
  });
  if (!message) return null;

  if (message.processingModeAtIngest === "manual_only" && message.status !== "ready") {
    if (message.messageType === "documentMessage") {
      await ctx.runAction(internal.documents.prepareDocumentForManualAi, { messageId });
    } else if (
      message.messageType === "imageMessage" ||
      message.messageType === "audioMessage"
    ) {
      await prepareMediaForManualAi(ctx, messageId);
    }
  }

  return await ctx.runQuery(internal.messages.getReplyContext, {
    messageId,
    historyLimit,
    includeManualOnly: true,
  });
}

export const markImportant = mutation({
  args: {
    messageId: v.id("messages"),
    isImportant: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { isImportant: args.isImportant });
    return null;
  },
});

export const setNeedsReply = mutation({
  args: {
    messageId: v.id("messages"),
    needsReply: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { needsReply: args.needsReply });
    await refreshForMessage(ctx, args.messageId);
    return null;
  },
});

export const setUrgent = mutation({
  args: {
    messageId: v.id("messages"),
    isUrgent: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { isUrgent: args.isUrgent });
    await refreshForMessage(ctx, args.messageId);
    return null;
  },
});

export const setMeetingFlag = mutation({
  args: {
    messageId: v.id("messages"),
    isMeeting: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { isMeeting: args.isMeeting });
    await refreshForMessage(ctx, args.messageId);
    return null;
  },
});

export const setDeadlineFlag = mutation({
  args: {
    messageId: v.id("messages"),
    hasDeadline: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { hasDeadline: args.hasDeadline });
    await refreshForMessage(ctx, args.messageId);
    return null;
  },
});

export const setFlagsInternal = internalMutation({
  args: {
    messageId: v.id("messages"),
    needsReply: v.optional(v.boolean()),
    isUrgent: v.optional(v.boolean()),
    hasDeadline: v.optional(v.boolean()),
    isMeeting: v.optional(v.boolean()),
    mentionsUser: v.optional(v.boolean()),
    mentionReason: v.optional(v.string()),
    isNoise: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {};
    if (args.needsReply !== undefined) patch.needsReply = args.needsReply;
    if (args.isUrgent !== undefined) patch.isUrgent = args.isUrgent;
    if (args.hasDeadline !== undefined) patch.hasDeadline = args.hasDeadline;
    if (args.isMeeting !== undefined) patch.isMeeting = args.isMeeting;
    if (args.mentionsUser !== undefined) patch.mentionsUser = args.mentionsUser;
    if (args.mentionReason !== undefined) patch.mentionReason = args.mentionReason;
    if (args.isNoise !== undefined) patch.isNoise = args.isNoise;
    if (Object.keys(patch).length === 0) return null;
    await ctx.db.patch(args.messageId, patch);
    await refreshForMessage(ctx, args.messageId);
    return null;
  },
});

export const markAutoRepliedInternal = internalMutation({
  args: {
    messageId: v.id("messages"),
    contactId: v.id("contacts"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { autoReplied: true });
    await ctx.db.patch(args.contactId, {
      lastAutoReplyAt: Math.floor(Date.now() / 1000),
    });
    return null;
  },
});

export const storeAiSummaryInternal = internalMutation({
  args: {
    messageId: v.id("messages"),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { aiSummary: args.summary });
    return null;
  },
});

export const storeAiExplanationInternal = internalMutation({
  args: {
    messageId: v.id("messages"),
    explanation: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { aiExplanation: args.explanation });
    return null;
  },
});

const SUMMARIZE_PROMPT =
  "Summarize the message and the recent chat history in 2-3 short sentences. Focus on what the contact is asking or saying. Plain text, no bullets, no preamble.";

const EXPLAIN_PROMPT =
  "Explain what the latest message means in plain language. If there is jargon, slang, or context the reader might miss, clarify it. 2-3 short sentences max. No preamble.";

function renderHistory(args: {
  contactName?: string;
  history: Array<{ role: "incoming" | "outgoing"; text: string }>;
  latestIncoming: string;
}): string {
  const lines: string[] = [];
  if (args.contactName) lines.push(`Chat with: ${args.contactName}`);
  if (args.history.length > 0) {
    lines.push("Recent history:");
    for (const h of args.history.slice(-6)) {
      lines.push(`${h.role === "incoming" ? "Them" : "You"}: ${h.text}`);
    }
  }
  lines.push(`Latest message: ${args.latestIncoming}`);
  return lines.join("\n");
}

export const summarize = action({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args): Promise<{ summary: string }> => {
    const context = await getManualAiContext(ctx, args.messageId, 10);
    if (!context) throw new Error("Message not found");
    const { generateText } = await import("./providers/processing");
    const summary = await generateText({
      system: SUMMARIZE_PROMPT,
      user: renderHistory({
        contactName: context.contactName,
        history: context.history,
        latestIncoming: context.message.text,
      }),
      maxTokens: 200,
      temperature: 0.3,
    });
    await ctx.runMutation(internal.messageActions.storeAiSummaryInternal, {
      messageId: args.messageId,
      summary,
    });
    return { summary };
  },
});

export const explain = action({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args): Promise<{ explanation: string }> => {
    const context = await getManualAiContext(ctx, args.messageId, 6);
    if (!context) throw new Error("Message not found");
    const { generateText } = await import("./providers/processing");
    const explanation = await generateText({
      system: EXPLAIN_PROMPT,
      user: renderHistory({
        contactName: context.contactName,
        history: context.history,
        latestIncoming: context.message.text,
      }),
      maxTokens: 200,
      temperature: 0.3,
    });
    await ctx.runMutation(internal.messageActions.storeAiExplanationInternal, {
      messageId: args.messageId,
      explanation,
    });
    return { explanation };
  },
});

export const askBimi = action({
  args: {
    messageId: v.id("messages"),
    question: v.string(),
  },
  handler: async (ctx, args): Promise<{ answer: string }> => {
    const context = await getManualAiContext(ctx, args.messageId, 12);
    if (!context) throw new Error("Message not found");
    const { generateText } = await import("./providers/processing");
    const isDocument = context.message.messageType === "documentMessage";
    const system = isDocument
      ? "You are Bimi. Answer the user's question about this document. Cite specific details (deadlines, names, amounts) when available. 1-5 sentences."
      : "You are Bimi, a friendly chat assistant. Answer the user's question about a specific WhatsApp message and the surrounding chat. Be concise and concrete. 1-4 sentences.";

    const userParts: string[] = [
      renderHistory({
        contactName: context.contactName,
        history: context.history,
        latestIncoming: context.message.text,
      }),
    ];
    if (isDocument && context.message.extractedFields) {
      userParts.push("");
      userParts.push("Extracted from document:");
      userParts.push(JSON.stringify(context.message.extractedFields, null, 2));
    }
    userParts.push("");
    userParts.push(`User question: ${args.question}`);

    const answer = await generateText({
      system,
      user: userParts.join("\n"),
      maxTokens: 400,
      temperature: 0.4,
    });
    return { answer };
  },
});

export const askBimiAboutChat = action({
  args: {
    contactId: v.id("contacts"),
    question: v.string(),
    historyLimit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ answer: string }> => {
    const context = await ctx.runQuery(internal.messages.getChatContext, {
      contactId: args.contactId,
      limit: args.historyLimit ?? 30,
    });
    if (!context) throw new Error("Contact not found");

    const { generateText } = await import("./providers/processing");
    const system =
      "You are Bimi, a friendly chat assistant. Answer the user's question about the entire WhatsApp conversation below. Be concise, concrete, and reference specific messages when relevant. 1-5 sentences. No preamble.";

    const lines: string[] = [];
    if (context.contactName) {
      lines.push(
        context.isGroup
          ? `Group chat: ${context.contactName}`
          : `Chat with: ${context.contactName}`,
      );
    }
    if (context.history.length > 0) {
      lines.push("Conversation:");
      for (const h of context.history) {
        lines.push(`${h.role === "incoming" ? "Them" : "You"}: ${h.text}`);
      }
    } else {
      lines.push("(No messages yet.)");
    }
    lines.push("");
    lines.push(`User question: ${args.question}`);

    const answer = await generateText({
      system,
      user: lines.join("\n"),
      maxTokens: 350,
      temperature: 0.4,
    });
    return { answer };
  },
});

export const draftReplyForMessage = action({
  args: { messageId: v.id("messages") },
  handler: async (
    ctx,
    args,
  ): Promise<{ draftId: Id<"drafts">; text: string }> => {
    const context = await getManualAiContext(ctx, args.messageId, 10);
    if (!context) throw new Error("Message not found");
    if (context.message.fromMe) {
      throw new Error("Cannot draft a reply for an outgoing message");
    }

    const pref = await ctx.runQuery(internal.userPreferences.getInternal, {
      instance: context.message.instance,
    });
    const learnedStyle = await ctx.runQuery(
      internal.replyStyle.getForCallInternal,
      {
        instance: context.message.instance,
        contactId: context.message.contactId,
      },
    );
    let style: "casual" | "professional" | "friendly" | "concise" = "casual";
    let customTonePrompt: string | undefined;
    if (pref) {
      if (pref.defaultTone === "professional") style = "professional";
      else if (pref.defaultTone === "friendly") style = "friendly";
      else if (pref.defaultTone === "concise") style = "concise";
      else if (pref.defaultTone === "custom") {
        style = "casual";
        customTonePrompt = pref.customTone;
      }
    }

    const { generateReply } = await import("./providers/processing");
    const text = await generateReply({
      contactName: context.contactName,
      history: context.history,
      latestIncoming: context.message.text,
      style,
      customTonePrompt,
      styleGuidance: learnedStyle.guidance,
    });
    const draftId: Id<"drafts"> = await ctx.runMutation(
      internal.drafts.insertDraftInternal,
      {
        instance: context.message.instance,
        contactId: context.message.contactId,
        sourceMessageId: args.messageId,
        text,
        style,
        reason: "manual_request",
        priority: context.message.priority,
        confidence: context.message.classificationConfidence,
        category: context.message.category,
        sourceMode: "manual_request",
      },
    );
    return { draftId, text };
  },
});

export const regenerateDraft = action({
  args: {
    draftId: v.id("drafts"),
    variant: v.union(
      v.literal("regenerate"),
      v.literal("shorter"),
      v.literal("professional"),
      v.literal("friendly"),
      v.literal("custom"),
    ),
    customTone: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ text: string }> => {
    const draft: Doc<"drafts"> | null = await ctx.runQuery(
      internal.drafts.getDraftInternal,
      { draftId: args.draftId },
    );
    if (!draft) throw new Error("Draft not found");
    if (draft.status !== "pending") {
      throw new Error(`Cannot regenerate a ${draft.status} draft`);
    }
    if (!draft.sourceMessageId) {
      throw new Error("Draft has no source message");
    }

    const context = await getManualAiContext(ctx, draft.sourceMessageId, 10);
    if (!context) throw new Error("Source message not found");
    const learnedStyle = await ctx.runQuery(
      internal.replyStyle.getForCallInternal,
      {
        instance: context.message.instance,
        contactId: context.message.contactId,
      },
    );

    const { generateReply } = await import("./providers/processing");

    let style: "casual" | "professional" | "friendly" | "concise" = "casual";
    let customTonePrompt: string | undefined;
    let maxTokens: number | undefined;

    switch (args.variant) {
      case "regenerate":
        style = "casual";
        break;
      case "shorter":
        style = "concise";
        maxTokens = 40;
        break;
      case "professional":
        style = "professional";
        break;
      case "friendly":
        style = "friendly";
        break;
      case "custom":
        style = "casual";
        customTonePrompt = args.customTone;
        break;
    }

    const text = await generateReply({
      contactName: context.contactName,
      history: context.history,
      latestIncoming: context.message.text,
      style,
      customTonePrompt,
      styleGuidance: learnedStyle.guidance,
      maxTokens,
    });

    await ctx.runMutation(internal.drafts.updateDraftTextInternal, {
      draftId: args.draftId,
      text,
      style: args.variant === "custom"
        ? `custom:${(args.customTone ?? "").slice(0, 40)}`
        : args.variant,
      feedbackVariant: args.variant,
    });

    return { text };
  },
});

const TASK_EXTRACT_PROMPT =
  "Extract a single actionable task from the message. Reply with JSON only: {\"title\": string, \"description\": string|null}. Title is a short imperative (5-10 words). Description is optional 1-sentence context. If no task, return {\"title\": \"\", \"description\": null}.";

export const createTaskFromMessage = action({
  args: { messageId: v.id("messages") },
  handler: async (
    ctx,
    args,
  ): Promise<{ taskId: Id<"tasks"> | null; title: string }> => {
    const context = await getManualAiContext(ctx, args.messageId, 4);
    if (!context) throw new Error("Message not found");

    const { generateText } = await import("./providers/processing");
    const raw = await generateText({
      system: TASK_EXTRACT_PROMPT,
      user: renderHistory({
        contactName: context.contactName,
        history: context.history,
        latestIncoming: context.message.text,
      }),
      maxTokens: 200,
      temperature: 0.2,
    });

    let title = "";
    let description: string | undefined;
    try {
      const jsonStart = raw.indexOf("{");
      const jsonEnd = raw.lastIndexOf("}");
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
          title?: string;
          description?: string | null;
        };
        title = (parsed.title ?? "").trim();
        description =
          typeof parsed.description === "string" && parsed.description.trim().length > 0
            ? parsed.description.trim()
            : undefined;
      }
    } catch {
      title = context.message.text.slice(0, 80);
    }
    if (title.length === 0) {
      return { taskId: null, title: "" };
    }

    const taskId: Id<"tasks"> = await ctx.runMutation(
      internal.tasks.createInternal,
      {
        instance: context.message.instance,
        contactId: context.message.contactId,
        sourceMessageId: args.messageId,
        title,
        description,
      },
    );
    return { taskId, title };
  },
});
