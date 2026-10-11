import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { assertBulkSize, bulkResult } from "./bulkDelete";

const priorityValidator = v.union(
  v.literal("urgent"),
  v.literal("high"),
  v.literal("normal"),
  v.literal("low"),
);

export const create = mutation({
  args: {
    instance: v.string(),
    contactId: v.optional(v.id("contacts")),
    sourceMessageId: v.optional(v.id("messages")),
    title: v.string(),
    description: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    priority: v.optional(priorityValidator),
  },
  handler: async (ctx, args) => {
    if (args.title.trim().length === 0) {
      throw new Error("Task title is required");
    }
    return await ctx.db.insert("tasks", {
      instance: args.instance,
      contactId: args.contactId,
      sourceMessageId: args.sourceMessageId,
      title: args.title.trim(),
      description: args.description,
      dueAt: args.dueAt,
      priority: args.priority,
      status: "open",
      createdBy: "user",
    });
  },
});

export const createInternal = internalMutation({
  args: {
    instance: v.string(),
    contactId: v.optional(v.id("contacts")),
    sourceMessageId: v.optional(v.id("messages")),
    title: v.string(),
    description: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    priority: v.optional(priorityValidator),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("tasks", {
      instance: args.instance,
      contactId: args.contactId,
      sourceMessageId: args.sourceMessageId,
      title: args.title,
      description: args.description,
      dueAt: args.dueAt,
      priority: args.priority,
      status: "open",
      createdBy: "ai",
    });
  },
});

export const setStatus = mutation({
  args: {
    taskId: v.id("tasks"),
    status: v.union(v.literal("open"), v.literal("done")),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { status: args.status };
    if (args.status === "done") patch.completedAt = Date.now();
    else patch.completedAt = undefined;
    await ctx.db.patch(args.taskId, patch);
    return null;
  },
});

export const remove = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.taskId);
    return null;
  },
});

export const removeMany = mutation({
  args: { taskIds: v.array(v.id("tasks")) },
  returns: v.object({ deleted: v.number(), missing: v.number() }),
  handler: async (ctx, args) => {
    assertBulkSize(args.taskIds);
    let deleted = 0;
    for (const taskId of args.taskIds) {
      if ((await ctx.db.get(taskId)) === null) continue;
      await ctx.db.delete(taskId);
      deleted++;
    }
    return bulkResult(deleted, args.taskIds.length);
  },
});

export const getTaskInternal = internalQuery({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args): Promise<Doc<"tasks"> | null> => {
    return await ctx.db.get(args.taskId);
  },
});

export const list = query({
  args: {
    instance: v.string(),
    status: v.optional(v.union(v.literal("open"), v.literal("done"))),
    contactId: v.optional(v.id("contacts")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 100, 200);
    const contactId = args.contactId;
    const status = args.status;
    if (contactId !== undefined) {
      const rows = await ctx.db
        .query("tasks")
        .withIndex("by_contact", (q) => q.eq("contactId", contactId))
        .order("desc")
        .take(limit);
      return status ? rows.filter((r) => r.status === status) : rows;
    }
    if (status !== undefined) {
      return await ctx.db
        .query("tasks")
        .withIndex("by_instance_and_status", (q) =>
          q.eq("instance", args.instance).eq("status", status),
        )
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("tasks")
      .withIndex("by_instance_and_status", (q) => q.eq("instance", args.instance))
      .order("desc")
      .take(limit);
  },
});

export const countOpen = query({
  args: { instance: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("tasks")
      .withIndex("by_instance_and_status", (q) =>
        q.eq("instance", args.instance).eq("status", "open"),
      )
      .take(200);
    return rows.length;
  },
});
