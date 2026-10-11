import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";

const toneValidator = v.union(
  v.literal("casual"),
  v.literal("professional"),
  v.literal("friendly"),
  v.literal("concise"),
  v.literal("custom"),
);

const aiModeValidator = v.union(
  v.literal("manual"),
  v.literal("semi_auto"),
  v.literal("full_auto"),
  v.literal("silent"),
);

export const get = query({
  args: { instance: v.string() },
  handler: async (ctx, args) => {
    const pref = await ctx.db
      .query("userPreferences")
      .withIndex("by_instance", (q) => q.eq("instance", args.instance))
      .unique();
    return pref;
  },
});

export const setDefaultTone = mutation({
  args: {
    instance: v.string(),
    tone: toneValidator,
    customTone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_instance", (q) => q.eq("instance", args.instance))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        defaultTone: args.tone,
        customTone: args.tone === "custom" ? args.customTone : undefined,
      });
      return existing._id;
    }

    return await ctx.db.insert("userPreferences", {
      instance: args.instance,
      defaultTone: args.tone,
      customTone: args.tone === "custom" ? args.customTone : undefined,
    });
  },
});

export const setReplyStyleLearning = mutation({
  args: {
    instance: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_instance", (q) => q.eq("instance", args.instance))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        replyStyleLearningEnabled: args.enabled,
      });
      return existing._id;
    }
    return await ctx.db.insert("userPreferences", {
      instance: args.instance,
      defaultTone: "casual",
      replyStyleLearningEnabled: args.enabled,
    });
  },
});

export const getInternal = internalQuery({
  args: { instance: v.string() },
  handler: async (ctx, args) => {
    const pref = await ctx.db
      .query("userPreferences")
      .withIndex("by_instance", (q) => q.eq("instance", args.instance))
      .unique();
    return pref;
  },
});

export const setDefaultAiMode = mutation({
  args: {
    instance: v.string(),
    aiMode: aiModeValidator,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_instance", (q) => q.eq("instance", args.instance))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { defaultAiMode: args.aiMode });
      return existing._id;
    }

    return await ctx.db.insert("userPreferences", {
      instance: args.instance,
      defaultTone: "casual",
      defaultAiMode: args.aiMode,
    });
  },
});

export const setOwnerProfile = mutation({
  args: {
    instance: v.string(),
    ownerName: v.optional(v.string()),
    ownerAliases: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_instance", (q) => q.eq("instance", args.instance))
      .unique();
    const patch: Record<string, unknown> = {};
    if (args.ownerName !== undefined) patch.ownerName = args.ownerName;
    if (args.ownerAliases !== undefined) patch.ownerAliases = args.ownerAliases;

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("userPreferences", {
      instance: args.instance,
      defaultTone: "casual",
      ownerName: args.ownerName,
      ownerAliases: args.ownerAliases,
    });
  },
});

export const registerPushToken = mutation({
  args: {
    instance: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_instance", (q) => q.eq("instance", args.instance))
      .unique();

    if (existing) {
      if (existing.pushToken === args.token) return existing._id;
      await ctx.db.patch(existing._id, { pushToken: args.token });
      return existing._id;
    }

    return await ctx.db.insert("userPreferences", {
      instance: args.instance,
      defaultTone: "casual",
      pushToken: args.token,
    });
  },
});

export const markAppOpened = mutation({
  args: { instance: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_instance", (q) => q.eq("instance", args.instance))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { lastOpenedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("userPreferences", {
      instance: args.instance,
      defaultTone: "casual",
      lastOpenedAt: now,
    });
  },
});

export const setQuietHours = mutation({
  args: {
    instance: v.string(),
    enabled: v.boolean(),
    start: v.optional(v.string()),
    end: v.optional(v.string()),
    timezone: v.optional(v.string()),
    allowVip: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      quietHoursEnabled: args.enabled,
    };
    if (args.start !== undefined) patch.quietHoursStart = args.start;
    if (args.end !== undefined) patch.quietHoursEnd = args.end;
    if (args.timezone !== undefined) patch.quietHoursTimezone = args.timezone;
    if (args.allowVip !== undefined) patch.quietHoursAllowVip = args.allowVip;

    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_instance", (q) => q.eq("instance", args.instance))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("userPreferences", {
      instance: args.instance,
      defaultTone: "casual",
      ...patch,
    });
  },
});

export const setMemoryWriteMode = mutation({
  args: {
    instance: v.string(),
    mode: v.union(
      v.literal("auto"),
      v.literal("approval"),
      v.literal("off"),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_instance", (q) => q.eq("instance", args.instance))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { memoryWriteMode: args.mode });
      return existing._id;
    }
    return await ctx.db.insert("userPreferences", {
      instance: args.instance,
      defaultTone: "casual",
      memoryWriteMode: args.mode,
    });
  },
});

export const setMemoryExtractionSchedule = mutation({
  args: {
    instance: v.string(),
    intervalHours: v.number(),
    dailyTime: v.optional(v.string()),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const intervalHours = Math.max(0, Math.min(168, args.intervalHours));
    const patch: Record<string, unknown> = {
      memoryExtractionIntervalHours: intervalHours,
    };
    if (args.dailyTime !== undefined) patch.memoryExtractionDailyTime = args.dailyTime;
    if (args.timezone !== undefined) patch.memoryExtractionTimezone = args.timezone;

    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_instance", (q) => q.eq("instance", args.instance))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("userPreferences", {
      instance: args.instance,
      defaultTone: "casual",
      ...patch,
    });
  },
});

export const setAutoExtractTasks = mutation({
  args: { instance: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_instance", (q) => q.eq("instance", args.instance))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { autoExtractTasks: args.enabled });
      return existing._id;
    }
    return await ctx.db.insert("userPreferences", {
      instance: args.instance,
      defaultTone: "casual",
      autoExtractTasks: args.enabled,
    });
  },
});

export const autoDetectOwnerInternal = internalMutation({
  args: {
    instance: v.string(),
    ownerJid: v.string(),
    ownerPhone: v.optional(v.string()),
    ownerName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_instance", (q) => q.eq("instance", args.instance))
      .unique();

    if (existing) {
      if (existing.ownerJid) return existing._id;
      await ctx.db.patch(existing._id, {
        ownerJid: args.ownerJid,
        ownerPhone: args.ownerPhone,
        ownerName: existing.ownerName ?? args.ownerName,
      });
      return existing._id;
    }

    return await ctx.db.insert("userPreferences", {
      instance: args.instance,
      defaultTone: "casual",
      ownerJid: args.ownerJid,
      ownerPhone: args.ownerPhone,
      ownerName: args.ownerName,
    });
  },
});

export const setVoicePreferences = mutation({
  args: {
    instance: v.string(),
    mode: v.optional(
      v.union(v.literal("push_to_talk"), v.literal("conversational")),
    ),
    ttsEngine: v.optional(v.union(v.literal("device"), v.literal("bimi"))),
    autoSpeak: v.optional(v.boolean()),
    locale: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {};
    if (args.mode !== undefined) patch.voiceMode = args.mode;
    if (args.ttsEngine !== undefined) patch.voiceTtsEngine = args.ttsEngine;
    if (args.autoSpeak !== undefined) patch.voiceAutoSpeak = args.autoSpeak;
    if (args.locale !== undefined) patch.voiceLocale = args.locale;

    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_instance", (q) => q.eq("instance", args.instance))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("userPreferences", {
      instance: args.instance,
      defaultTone: "casual",
      ...patch,
    });
  },
});
