import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { assertBulkSize, bulkResult } from "./bulkDelete";

const statusValidator = v.union(
  v.literal("suggested"),
  v.literal("pending"),
  v.literal("fired"),
  v.literal("dismissed"),
);

const kindValidator = v.union(v.literal("user"), v.literal("ai_followup"));

export const create = mutation({
  args: {
    instance: v.string(),
    contactId: v.optional(v.id("contacts")),
    sourceMessageId: v.optional(v.id("messages")),
    text: v.string(),
    remindAt: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.text.trim().length === 0) {
      throw new Error("Reminder text is required");
    }
    if (args.remindAt <= Date.now()) {
      throw new Error("Remind time must be in the future");
    }
    return await ctx.db.insert("reminders", {
      instance: args.instance,
      contactId: args.contactId,
      sourceMessageId: args.sourceMessageId,
      text: args.text.trim(),
      remindAt: args.remindAt,
      status: "pending",
      kind: "user",
    });
  },
});

export const createInternal = internalMutation({
  args: {
    instance: v.string(),
    contactId: v.optional(v.id("contacts")),
    sourceMessageId: v.optional(v.id("messages")),
    text: v.string(),
    remindAt: v.number(),
    status: v.optional(statusValidator),
    kind: v.optional(kindValidator),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("reminders", {
      instance: args.instance,
      contactId: args.contactId,
      sourceMessageId: args.sourceMessageId,
      text: args.text,
      remindAt: args.remindAt,
      status: args.status ?? "pending",
      kind: args.kind,
    });
  },
});

export const dismiss = mutation({
  args: { reminderId: v.id("reminders") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.reminderId, { status: "dismissed" });
    return null;
  },
});

export const dismissSuggested = mutation({
  args: { reminderId: v.id("reminders") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.reminderId, { status: "dismissed" });
    return null;
  },
});

export const acceptSuggested = mutation({
  args: {
    reminderId: v.id("reminders"),
    remindAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { status: "pending" };
    if (args.remindAt !== undefined) {
      if (args.remindAt <= Date.now()) {
        throw new Error("Remind time must be in the future");
      }
      patch.remindAt = args.remindAt;
    }
    await ctx.db.patch(args.reminderId, patch);
    return null;
  },
});

export const remove = mutation({
  args: { reminderId: v.id("reminders") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.reminderId);
    return null;
  },
});

export const removeMany = mutation({
  args: { reminderIds: v.array(v.id("reminders")) },
  returns: v.object({ deleted: v.number(), missing: v.number() }),
  handler: async (ctx, args) => {
    assertBulkSize(args.reminderIds);
    let deleted = 0;
    for (const reminderId of args.reminderIds) {
      if ((await ctx.db.get(reminderId)) === null) continue;
      await ctx.db.delete(reminderId);
      deleted++;
    }
    return bulkResult(deleted, args.reminderIds.length);
  },
});

export const list = query({
  args: {
    instance: v.string(),
    status: v.optional(statusValidator),
    contactId: v.optional(v.id("contacts")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 100, 200);
    const contactId = args.contactId;
    const status = args.status;
    if (contactId !== undefined) {
      const rows = await ctx.db
        .query("reminders")
        .withIndex("by_contact", (q) => q.eq("contactId", contactId))
        .order("desc")
        .take(limit);
      return status ? rows.filter((r) => r.status === status) : rows;
    }
    if (status !== undefined) {
      return await ctx.db
        .query("reminders")
        .withIndex("by_instance_and_status", (q) =>
          q.eq("instance", args.instance).eq("status", status),
        )
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("reminders")
      .withIndex("by_instance_and_status", (q) => q.eq("instance", args.instance))
      .order("desc")
      .take(limit);
  },
});

export const latestSuggestedForContact = query({
  args: { contactId: v.id("contacts"), sinceMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const sinceMs = args.sinceMs ?? Date.now() - 24 * 60 * 60 * 1000;
    const rows = await ctx.db
      .query("reminders")
      .withIndex("by_contact_and_status", (q) =>
        q.eq("contactId", args.contactId).eq("status", "suggested"),
      )
      .order("desc")
      .take(5);
    return rows.filter((r) => r._creationTime >= sinceMs);
  },
});

export const getReminderInternal = internalQuery({
  args: { reminderId: v.id("reminders") },
  handler: async (ctx, args): Promise<Doc<"reminders"> | null> => {
    return await ctx.db.get(args.reminderId);
  },
});
