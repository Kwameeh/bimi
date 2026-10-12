import { v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { assertBulkSize, bulkResult } from './bulkDelete';

const priorityValidator = v.union(
  v.literal('urgent'),
  v.literal('high'),
  v.literal('normal'),
  v.literal('low'),
);

const PRIORITY_RANK: Record<string, number> = {
  urgent: 4,
  high: 3,
  normal: 2,
  low: 1,
};

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'is',
  'are',
  'was',
  'were',
  'to',
  'for',
  'of',
  'in',
  'on',
  'at',
  'by',
  'from',
  'with',
  'about',
  'please',
  'pls',
  'can',
  'you',
  'could',
  'kindly',
  'remember',
  'remind',
  'dont',
  "don't",
  'forget',
  'need',
  'needs',
  'urgent',
  'asap',
  'fyi',
  'team',
  'all',
  'everyone',
  'hi',
  'hello',
  'hey',
  'dear',
  'task',
  'todo',
  'action',
  'item',
]);

export function normalizeTaskTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w))
    .join(' ')
    .trim();
}

export function areTaskTitlesSimilar(titleA: string, titleB: string): boolean {
  const normA = normalizeTaskTitle(titleA);
  const normB = normalizeTaskTitle(titleB);
  if (!normA || !normB) return false;
  if (normA === normB) return true;

  if (normA.length >= 10 && normB.length >= 10) {
    if (normA.includes(normB) || normB.includes(normA)) return true;
  }

  const tokensA = new Set(normA.split(/\s+/));
  const tokensB = new Set(normB.split(/\s+/));
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  if (union === 0) return false;
  const jaccard = intersection / union;
  const dice = (2 * intersection) / (tokensA.size + tokensB.size);

  return jaccard >= 0.55 || dice >= 0.65;
}

export function areTasksDuplicate(
  a: { title: string; dueAt?: number },
  b: { title: string; dueAt?: number },
): boolean {
  if (!areTaskTitlesSimilar(a.title, b.title)) return false;

  // If both have dueAt timestamps, verify they are within 24 hours of each other
  if (a.dueAt && b.dueAt) {
    const diff = Math.abs(a.dueAt - b.dueAt);
    return diff <= 24 * 60 * 60 * 1000;
  }

  return true;
}

export const create = mutation({
  args: {
    instance: v.string(),
    contactId: v.optional(v.id('contacts')),
    sourceMessageId: v.optional(v.id('messages')),
    title: v.string(),
    description: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    priority: v.optional(priorityValidator),
  },
  handler: async (ctx, args) => {
    if (args.title.trim().length === 0) {
      throw new Error('Task title is required');
    }
    return await ctx.db.insert('tasks', {
      instance: args.instance,
      contactId: args.contactId,
      sourceMessageId: args.sourceMessageId,
      title: args.title.trim(),
      description: args.description,
      dueAt: args.dueAt,
      priority: args.priority,
      status: 'open',
      createdBy: 'user',
      mentionCount: 1,
      sourceContactIds: args.contactId ? [args.contactId] : undefined,
      sourceMessageIds: args.sourceMessageId ? [args.sourceMessageId] : undefined,
      lastMentionedAt: Date.now(),
    });
  },
});

export const createInternal = internalMutation({
  args: {
    instance: v.string(),
    contactId: v.optional(v.id('contacts')),
    sourceMessageId: v.optional(v.id('messages')),
    title: v.string(),
    description: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    priority: v.optional(priorityValidator),
  },
  handler: async (ctx, args) => {
    const candidateTitle = args.title.trim();
    if (candidateTitle.length === 0) {
      throw new Error('Task title cannot be empty');
    }

    // Check open tasks in this instance for duplicates
    const openTasks = await ctx.db
      .query('tasks')
      .withIndex('by_instance_and_status', (q) =>
        q.eq('instance', args.instance).eq('status', 'open'),
      )
      .take(100);

    const duplicate = openTasks.find((existing) =>
      areTasksDuplicate(
        { title: existing.title, dueAt: existing.dueAt },
        { title: candidateTitle, dueAt: args.dueAt },
      ),
    );

    if (duplicate) {
      // Consolidate into existing task
      const newMentionCount = (duplicate.mentionCount ?? 1) + 1;
      const patch: Record<string, unknown> = {
        mentionCount: newMentionCount,
        lastMentionedAt: Date.now(),
      };

      // Merge source contacts (capped at 5)
      if (args.contactId) {
        const contactIds = duplicate.sourceContactIds ? [...duplicate.sourceContactIds] : [];
        if (duplicate.contactId && !contactIds.includes(duplicate.contactId)) {
          contactIds.unshift(duplicate.contactId);
        }
        if (!contactIds.includes(args.contactId) && contactIds.length < 5) {
          contactIds.push(args.contactId);
        }
        patch.sourceContactIds = contactIds;
      }

      // Merge source messages (capped at 5)
      if (args.sourceMessageId) {
        const messageIds = duplicate.sourceMessageIds ? [...duplicate.sourceMessageIds] : [];
        if (duplicate.sourceMessageId && !messageIds.includes(duplicate.sourceMessageId)) {
          messageIds.unshift(duplicate.sourceMessageId);
        }
        if (!messageIds.includes(args.sourceMessageId) && messageIds.length < 5) {
          messageIds.push(args.sourceMessageId);
        }
        patch.sourceMessageIds = messageIds;
      }

      // Upgrade priority if incoming priority is higher
      if (args.priority) {
        const currentRank = PRIORITY_RANK[duplicate.priority ?? 'normal'] ?? 2;
        const candidateRank = PRIORITY_RANK[args.priority] ?? 2;
        if (candidateRank > currentRank) {
          patch.priority = args.priority;
        }
      }

      // Fill in dueAt or description if missing on existing
      if (!duplicate.dueAt && args.dueAt) {
        patch.dueAt = args.dueAt;
      }
      if (!duplicate.description && args.description) {
        patch.description = args.description;
      }

      await ctx.db.patch(duplicate._id, patch);
      return duplicate._id;
    }

    return await ctx.db.insert('tasks', {
      instance: args.instance,
      contactId: args.contactId,
      sourceMessageId: args.sourceMessageId,
      title: candidateTitle,
      description: args.description,
      dueAt: args.dueAt,
      priority: args.priority,
      status: 'open',
      createdBy: 'ai',
      mentionCount: 1,
      sourceContactIds: args.contactId ? [args.contactId] : undefined,
      sourceMessageIds: args.sourceMessageId ? [args.sourceMessageId] : undefined,
      lastMentionedAt: Date.now(),
    });
  },
});

export const getRecentOpenInternal = internalQuery({
  args: { instance: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, 50);
    return await ctx.db
      .query('tasks')
      .withIndex('by_instance_and_status', (q) =>
        q.eq('instance', args.instance).eq('status', 'open'),
      )
      .order('desc')
      .take(limit);
  },
});

export const mergeDuplicates = mutation({
  args: { instance: v.string() },
  returns: v.object({ mergedCount: v.number(), remainingCount: v.number() }),
  handler: async (ctx, args) => {
    const openTasks = await ctx.db
      .query('tasks')
      .withIndex('by_instance_and_status', (q) =>
        q.eq('instance', args.instance).eq('status', 'open'),
      )
      .order('asc')
      .take(200);

    let mergedCount = 0;
    const keptTasks: Doc<'tasks'>[] = [];

    for (const task of openTasks) {
      const match = keptTasks.find((k) =>
        areTasksDuplicate(
          { title: k.title, dueAt: k.dueAt },
          { title: task.title, dueAt: task.dueAt },
        ),
      );

      if (match) {
        const newMentionCount = (match.mentionCount ?? 1) + (task.mentionCount ?? 1);
        const contactIds = match.sourceContactIds ? [...match.sourceContactIds] : [];
        if (task.contactId && !contactIds.includes(task.contactId) && contactIds.length < 5) {
          contactIds.push(task.contactId);
        }
        for (const cid of task.sourceContactIds ?? []) {
          if (!contactIds.includes(cid) && contactIds.length < 5) contactIds.push(cid);
        }

        const messageIds = match.sourceMessageIds ? [...match.sourceMessageIds] : [];
        if (
          task.sourceMessageId &&
          !messageIds.includes(task.sourceMessageId) &&
          messageIds.length < 5
        ) {
          messageIds.push(task.sourceMessageId);
        }
        for (const mid of task.sourceMessageIds ?? []) {
          if (!messageIds.includes(mid) && messageIds.length < 5) messageIds.push(mid);
        }

        const currentRank = PRIORITY_RANK[match.priority ?? 'normal'] ?? 2;
        const candidateRank = PRIORITY_RANK[task.priority ?? 'normal'] ?? 2;
        const higherPriority = candidateRank > currentRank ? task.priority : match.priority;

        await ctx.db.patch(match._id, {
          mentionCount: newMentionCount,
          sourceContactIds: contactIds.length > 0 ? contactIds : undefined,
          sourceMessageIds: messageIds.length > 0 ? messageIds : undefined,
          priority: higherPriority,
          dueAt: match.dueAt ?? task.dueAt,
          description: match.description ?? task.description,
          lastMentionedAt: Math.max(
            match.lastMentionedAt ?? 0,
            task.lastMentionedAt ?? 0,
            Date.now(),
          ),
        });

        await ctx.db.delete(task._id);
        mergedCount++;
      } else {
        keptTasks.push(task);
      }
    }

    return { mergedCount, remainingCount: keptTasks.length };
  },
});

export const setStatus = mutation({
  args: {
    taskId: v.id('tasks'),
    status: v.union(v.literal('open'), v.literal('done')),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { status: args.status };
    if (args.status === 'done') patch.completedAt = Date.now();
    else patch.completedAt = undefined;
    await ctx.db.patch(args.taskId, patch);
    return null;
  },
});

export const remove = mutation({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.taskId);
    return null;
  },
});

export const removeMany = mutation({
  args: { taskIds: v.array(v.id('tasks')) },
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
  args: { taskId: v.id('tasks') },
  handler: async (ctx, args): Promise<Doc<'tasks'> | null> => {
    return await ctx.db.get(args.taskId);
  },
});

export const list = query({
  args: {
    instance: v.string(),
    status: v.optional(v.union(v.literal('open'), v.literal('done'))),
    contactId: v.optional(v.id('contacts')),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 100, 200);
    const contactId = args.contactId;
    const status = args.status;
    if (contactId !== undefined) {
      const rows = await ctx.db
        .query('tasks')
        .withIndex('by_contact', (q) => q.eq('contactId', contactId))
        .order('desc')
        .take(limit);
      return status ? rows.filter((r) => r.status === status) : rows;
    }
    if (status !== undefined) {
      return await ctx.db
        .query('tasks')
        .withIndex('by_instance_and_status', (q) =>
          q.eq('instance', args.instance).eq('status', status),
        )
        .order('desc')
        .take(limit);
    }
    return await ctx.db
      .query('tasks')
      .withIndex('by_instance_and_status', (q) => q.eq('instance', args.instance))
      .order('desc')
      .take(limit);
  },
});

export const countOpen = query({
  args: { instance: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('tasks')
      .withIndex('by_instance_and_status', (q) =>
        q.eq('instance', args.instance).eq('status', 'open'),
      )
      .take(200);
    return rows.length;
  },
});
