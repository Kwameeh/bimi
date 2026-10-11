import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  listAutomaticMessagesForContact,
  listAutomaticMessagesForInstance,
} from "./messageProcessingPolicy";

const DEFAULT_TARGET_WORDS = 12;
export const DEFAULT_AUTO_REPLY_MAX_CHARS = 280;
const MIN_CONTACT_SAMPLES = 3;
const MIN_GLOBAL_SAMPLES = 5;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

export type DerivedReplyStyle = {
  summary: string;
  targetWords: number;
  maxChars: number;
  emojiRate: number;
  commonEmojis: string[];
  examples: string[];
  contactExamples: string[];
  sampleCount: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 280);
}

function words(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function median(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

function percentile(values: number[], ratio: number, fallback: number): number {
  if (values.length === 0) return fallback;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function uniqueRecent(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values.slice().reverse()) {
    const value = cleanText(raw);
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
    if (out.length >= limit) break;
  }
  return out.reverse();
}

function emojiStats(values: string[]): { rate: number; common: string[] } {
  if (values.length === 0) return { rate: 0, common: [] };
  let withEmoji = 0;
  const counts = new Map<string, number>();
  for (const value of values) {
    const found = value.match(EMOJI_RE) ?? [];
    if (found.length > 0) withEmoji++;
    for (const emoji of found) {
      counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
    }
  }
  return {
    rate: withEmoji / values.length,
    common: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([emoji]) => emoji),
  };
}

export function deriveReplyStyle(args: {
  userTexts: string[];
  approvedDraftTexts?: string[];
  contactTexts?: string[];
}): DerivedReplyStyle {
  const userTexts = [...args.userTexts, ...(args.approvedDraftTexts ?? [])]
    .map(cleanText)
    .filter(Boolean);
  const contactTexts = (args.contactTexts ?? []).map(cleanText).filter(Boolean);
  const targetWords = clamp(
    median(userTexts.map(words), DEFAULT_TARGET_WORDS),
    4,
    20,
  );
  const maxChars = clamp(
    percentile(
      userTexts.map((text) => text.length),
      0.75,
      DEFAULT_AUTO_REPLY_MAX_CHARS - 40,
    ) + 40,
    120,
    DEFAULT_AUTO_REPLY_MAX_CHARS,
  );
  const userEmoji = emojiStats(userTexts);
  const contactEmoji = emojiStats(contactTexts);
  // The user's own habits dominate. Contact behavior is only a weak signal
  // that an occasional emoji fits this particular conversation.
  const emojiRate = clamp(
    userEmoji.rate * 0.85 + contactEmoji.rate * 0.15,
    0,
    1,
  );
  const commonEmojis = Array.from(
    new Set([...userEmoji.common, ...contactEmoji.common]),
  ).slice(0, 5);
  const mostlyLowercase =
    userTexts.length > 0 &&
    userTexts.filter((text) => text === text.toLowerCase()).length /
      userTexts.length >=
      0.6;
  const summary = [
    `Usually about ${targetWords} words`,
    mostlyLowercase ? "relaxed casing" : "normal sentence casing",
    emojiRate >= 0.45
      ? "emojis are common"
      : emojiRate >= 0.15
        ? "an occasional emoji fits"
        : "usually no emoji",
  ].join("; ");

  return {
    summary,
    targetWords,
    maxChars,
    emojiRate,
    commonEmojis,
    examples: uniqueRecent(userTexts, 6),
    contactExamples: uniqueRecent(contactTexts, 4),
    sampleCount: userTexts.length,
  };
}

export function formatReplyStyleGuidance(args: {
  profile?: Pick<
    Doc<"replyStyleProfiles">,
    | "summary"
    | "targetWords"
    | "maxChars"
    | "emojiRate"
    | "commonEmojis"
    | "examples"
    | "contactExamples"
  > | null;
  defaultTone?: string;
  customTone?: string;
}): { guidance: string; maxChars: number } {
  const profile = args.profile;
  const maxChars = clamp(
    profile?.maxChars ?? DEFAULT_AUTO_REPLY_MAX_CHARS,
    120,
    DEFAULT_AUTO_REPLY_MAX_CHARS,
  );
  const lines = [
    "REPLY STYLE:",
    `- Keep this message around ${profile?.targetWords ?? DEFAULT_TARGET_WORDS} words and under ${maxChars} characters.`,
    "- Prefer one sentence. Use two short sentences only when the answer genuinely needs them.",
  ];
  if (profile) {
    lines.push(`- Learned pattern: ${profile.summary}.`);
    if (profile.emojiRate >= 0.15) {
      lines.push(
        `- At most one emoji when it feels natural${
          profile.commonEmojis.length > 0
            ? `; familiar choices: ${profile.commonEmojis.join(" ")}`
            : ""
        }.`,
      );
    } else {
      lines.push("- Usually do not use an emoji.");
    }
    if (profile.examples.length > 0) {
      lines.push(
        "- Match the user's rhythm and register from these examples; never copy facts:",
        ...profile.examples.slice(-4).map((text) => `  User: ${text}`),
      );
    }
    if (profile.contactExamples.length > 0) {
      lines.push(
        "- The contact's recent register (context only):",
        ...profile.contactExamples.slice(-2).map((text) => `  Contact: ${text}`),
      );
    }
  } else {
    lines.push("- Use at most one emoji, only if the incoming chat makes it natural.");
  }
  if (args.defaultTone) {
    lines.push(`- Explicit tone setting: ${args.defaultTone}.`);
  }
  if (args.customTone?.trim()) {
    lines.push(`- Highest-priority custom instruction: ${args.customTone.trim()}.`);
  }
  return { guidance: lines.join("\n"), maxChars };
}

export const getLearningContextInternal = internalQuery({
  args: { instance: v.string(), contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    const [contactMessages, globalMessages, contactDrafts, globalDrafts] =
      await Promise.all([
        listAutomaticMessagesForContact(ctx, {
          contactId: args.contactId,
          order: "desc",
          limit: 120,
        }),
        listAutomaticMessagesForInstance(ctx, {
          instance: args.instance,
          sinceTimestamp: 0,
          order: "desc",
          limit: 250,
        }),
        ctx.db
          .query("drafts")
          .withIndex("by_contact_and_status", (q) =>
            q.eq("contactId", args.contactId).eq("status", "sent"),
          )
          .order("desc")
          .take(50),
        ctx.db
          .query("drafts")
          .withIndex("by_instance_and_status", (q) =>
            q.eq("instance", args.instance).eq("status", "sent"),
          )
          .order("desc")
          .take(100),
      ]);
    return {
      contactMessages: contactMessages.reverse(),
      globalMessages: globalMessages.reverse(),
      contactDrafts: contactDrafts.reverse(),
      globalDrafts: globalDrafts.reverse(),
    };
  },
});

export const upsertInternal = internalMutation({
  args: {
    instance: v.string(),
    scope: v.union(v.literal("global"), v.literal("contact")),
    contactId: v.optional(v.id("contacts")),
    summary: v.string(),
    targetWords: v.number(),
    maxChars: v.number(),
    emojiRate: v.number(),
    commonEmojis: v.array(v.string()),
    examples: v.array(v.string()),
    contactExamples: v.array(v.string()),
    sampleCount: v.number(),
    lastAnalyzedMessageAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing =
      args.scope === "contact" && args.contactId
        ? await ctx.db
            .query("replyStyleProfiles")
            .withIndex("by_contactId", (q) => q.eq("contactId", args.contactId))
            .unique()
        : await ctx.db
            .query("replyStyleProfiles")
            .withIndex("by_instance_and_scope", (q) =>
              q.eq("instance", args.instance).eq("scope", "global"),
            )
            .unique();
    const patch = {
      summary: args.summary,
      targetWords: args.targetWords,
      maxChars: args.maxChars,
      emojiRate: args.emojiRate,
      commonEmojis: args.commonEmojis.slice(0, 5),
      examples: args.examples.slice(0, 6),
      contactExamples: args.contactExamples.slice(0, 4),
      sampleCount: args.sampleCount,
      lastAnalyzedMessageAt: args.lastAnalyzedMessageAt,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("replyStyleProfiles", {
      instance: args.instance,
      scope: args.scope,
      contactId: args.scope === "contact" ? args.contactId : undefined,
      ...patch,
    });
  },
});

function messageTime(message: Doc<"messages">): number | undefined {
  const timestamp = message.timestamp;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return undefined;
  }
  return timestamp > 1e12 ? timestamp : timestamp * 1000;
}

export const refreshForContactInternal = internalAction({
  args: { instance: v.string(), contactId: v.id("contacts") },
  handler: async (ctx, args): Promise<{ contact: boolean; global: boolean }> => {
    const pref = await ctx.runQuery(internal.userPreferences.getInternal, {
      instance: args.instance,
    });
    if (pref?.replyStyleLearningEnabled === false) {
      return { contact: false, global: false };
    }
    const context = await ctx.runQuery(
      internal.replyStyle.getLearningContextInternal,
      args,
    );
    const humanTexts = (messages: Doc<"messages">[]) =>
      messages
        .filter((message) => message.fromMe && message.sentByAi !== true)
        .map((message) => message.text);
    const contactTexts = context.contactMessages
      .filter((message: Doc<"messages">) => !message.fromMe)
      .map((message: Doc<"messages">) => message.text);
    const contactStyle = deriveReplyStyle({
      userTexts: humanTexts(context.contactMessages),
      approvedDraftTexts: context.contactDrafts.map(
        (draft: Doc<"drafts">) => draft.text,
      ),
      contactTexts,
    });
    const globalStyle = deriveReplyStyle({
      userTexts: humanTexts(context.globalMessages),
      approvedDraftTexts: context.globalDrafts.map(
        (draft: Doc<"drafts">) => draft.text,
      ),
    });
    const newest = [...context.contactMessages]
      .reverse()
      .find((message: Doc<"messages">) => message.fromMe);
    if (contactStyle.sampleCount >= MIN_CONTACT_SAMPLES) {
      await ctx.runMutation(internal.replyStyle.upsertInternal, {
        instance: args.instance,
        scope: "contact",
        contactId: args.contactId,
        ...contactStyle,
        lastAnalyzedMessageAt: newest ? messageTime(newest) : undefined,
      });
    }
    if (globalStyle.sampleCount >= MIN_GLOBAL_SAMPLES) {
      await ctx.runMutation(internal.replyStyle.upsertInternal, {
        instance: args.instance,
        scope: "global",
        ...globalStyle,
        lastAnalyzedMessageAt: newest ? messageTime(newest) : undefined,
      });
    }
    return {
      contact: contactStyle.sampleCount >= MIN_CONTACT_SAMPLES,
      global: globalStyle.sampleCount >= MIN_GLOBAL_SAMPLES,
    };
  },
});

export const getForCallInternal = internalQuery({
  args: { instance: v.string(), contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    const [contact, global, pref] = await Promise.all([
      ctx.db
        .query("replyStyleProfiles")
        .withIndex("by_contactId", (q) => q.eq("contactId", args.contactId))
        .unique(),
      ctx.db
        .query("replyStyleProfiles")
        .withIndex("by_instance_and_scope", (q) =>
          q.eq("instance", args.instance).eq("scope", "global"),
        )
        .unique(),
      ctx.db
        .query("userPreferences")
        .withIndex("by_instance", (q) => q.eq("instance", args.instance))
        .unique(),
    ]);
    const profile =
      pref?.replyStyleLearningEnabled === false ? null : (contact ?? global);
    return {
      profile,
      source: contact ? ("contact" as const) : global ? ("global" as const) : null,
      ...formatReplyStyleGuidance({
        profile,
        defaultTone: pref?.defaultTone,
        customTone: pref?.customTone,
      }),
    };
  },
});

export const getForContact = query({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("replyStyleProfiles")
      .withIndex("by_contactId", (q) => q.eq("contactId", args.contactId))
      .unique();
  },
});

export const resetForContact = mutation({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("replyStyleProfiles")
      .withIndex("by_contactId", (q) => q.eq("contactId", args.contactId))
      .unique();
    if (profile) await ctx.db.delete(profile._id);
    return null;
  },
});
