import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const priorityValidator = v.union(
  v.literal("urgent"),
  v.literal("high"),
  v.literal("normal"),
  v.literal("low"),
);

const aiModeValidator = v.union(
  v.literal("manual"),
  v.literal("semi_auto"),
  v.literal("full_auto"),
  v.literal("silent"),
);

const incomingMessageModeValidator = v.union(
  v.literal("save_and_process"),
  v.literal("save_only"),
  v.literal("ignore"),
);

const relationshipValidator = v.union(
  v.literal("vip"),
  v.literal("client"),
  v.literal("family"),
  v.literal("friend"),
  v.literal("classmate"),
  v.literal("team"),
  v.literal("low_priority"),
  v.literal("unknown"),
);

const DEFAULT_CADENCE_DAYS: Record<string, number> = {
  vip: 3,
  client: 10,
  family: 10,
  team: 7,
  friend: 14,
  classmate: 21,
  low_priority: 30,
  unknown: 0,
};

export const getChatSettings = query({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) return null;
    const pref = await ctx.db
      .query("userPreferences")
      .withIndex("by_instance", (q) => q.eq("instance", contact.instance))
      .unique();
    const defaultAiMode = pref?.defaultAiMode ?? "manual";
    return {
      contactId: contact._id,
      priority: contact.priority ?? "normal",
      muted: contact.muted ?? false,
      aiMode: contact.aiMode ?? defaultAiMode,
      aiModeIsInherited: contact.aiMode === undefined,
      incomingMessageMode: contact.incomingMessageMode ?? "save_and_process",
      autoReplyAllowGreetings: contact.autoReplyAllowGreetings ?? true,
      autoReplyAllowAcknowledgments: contact.autoReplyAllowAcknowledgments ?? true,
      autoReplyAllowSmallTalk: contact.autoReplyAllowSmallTalk ?? true,
      autoReplyBlocked: contact.autoReplyBlocked ?? false,
      relationship: contact.relationship ?? "unknown",
      checkInCadenceDays: contact.checkInCadenceDays ?? 0,
      checkInWeekday: contact.checkInWeekday,
      lastUserMessageAt: contact.lastUserMessageAt,
      lastMessageAt: contact.lastMessageAt,
      memoryEnabled: contact.memoryEnabled !== false,
    };
  },
});

export const setPriority = mutation({
  args: {
    contactId: v.id("contacts"),
    priority: priorityValidator,
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.contactId, { priority: args.priority });
    return args.priority;
  },
});

export const setMuted = mutation({
  args: {
    contactId: v.id("contacts"),
    muted: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.contactId, { muted: args.muted });
    return args.muted;
  },
});

export const setAiMode = mutation({
  args: {
    contactId: v.id("contacts"),
    aiMode: aiModeValidator,
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.contactId, { aiMode: args.aiMode });
    return args.aiMode;
  },
});

export const setIncomingMessageMode = mutation({
  args: {
    contactId: v.id("contacts"),
    mode: incomingMessageModeValidator,
  },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) throw new Error("Contact not found");
    await ctx.db.patch(args.contactId, {
      incomingMessageMode: args.mode,
      // Establish a legacy-history checkpoint before save-only messages begin
      // advancing lastMessageAt without advancing automatic processing.
      lastAutomaticMessageAt: contact.lastAutomaticMessageAt ?? contact.lastMessageAt,
    });
    return args.mode;
  },
});

export const setRelationship = mutation({
  args: {
    contactId: v.id("contacts"),
    relationship: relationshipValidator,
  },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) throw new Error("Contact not found");
    const patch: Record<string, unknown> = { relationship: args.relationship };
    if (contact.checkInCadenceDays === undefined) {
      const defaultDays = DEFAULT_CADENCE_DAYS[args.relationship] ?? 0;
      if (defaultDays > 0) patch.checkInCadenceDays = defaultDays;
    }
    await ctx.db.patch(args.contactId, patch);
    return args.relationship;
  },
});

export const setCheckInCadence = mutation({
  args: {
    contactId: v.id("contacts"),
    days: v.number(),
    weekday: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.days < 0 || args.days > 365) {
      throw new Error("Cadence must be 0-365 days");
    }
    if (
      args.weekday !== undefined &&
      (args.weekday < 0 || args.weekday > 6)
    ) {
      throw new Error("Weekday must be 0-6");
    }
    await ctx.db.patch(args.contactId, {
      checkInCadenceDays: args.days,
      checkInWeekday: args.weekday,
    });
    return null;
  },
});

export const setAutoReplyRules = mutation({
  args: {
    contactId: v.id("contacts"),
    autoReplyAllowGreetings: v.optional(v.boolean()),
    autoReplyAllowAcknowledgments: v.optional(v.boolean()),
    autoReplyAllowSmallTalk: v.optional(v.boolean()),
    autoReplyBlocked: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {};
    if (args.autoReplyAllowGreetings !== undefined) {
      patch.autoReplyAllowGreetings = args.autoReplyAllowGreetings;
    }
    if (args.autoReplyAllowAcknowledgments !== undefined) {
      patch.autoReplyAllowAcknowledgments = args.autoReplyAllowAcknowledgments;
    }
    if (args.autoReplyAllowSmallTalk !== undefined) {
      patch.autoReplyAllowSmallTalk = args.autoReplyAllowSmallTalk;
    }
    if (args.autoReplyBlocked !== undefined) {
      patch.autoReplyBlocked = args.autoReplyBlocked;
    }
    await ctx.db.patch(args.contactId, patch);
    return null;
  },
});
