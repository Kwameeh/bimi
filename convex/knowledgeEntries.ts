import { v } from 'convex/values';
import { internalQuery, mutation, query } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { assertBulkSize, bulkResult } from './bulkDelete';

const kindValidator = v.union(
  v.literal('project'),
  v.literal('url'),
  v.literal('template'),
  v.literal('client_note'),
  v.literal('availability'),
  v.literal('note'),
);

export const list = query({
  args: {
    instance: v.string(),
    kind: v.optional(kindValidator),
    pinnedOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Doc<'knowledgeEntries'>[]> => {
    let rows: Doc<'knowledgeEntries'>[];
    if (args.kind) {
      rows = await ctx.db
        .query('knowledgeEntries')
        .withIndex('by_instance_and_kind', (q) =>
          q.eq('instance', args.instance).eq('kind', args.kind!),
        )
        .order('desc')
        .take(200);
    } else {
      rows = await ctx.db
        .query('knowledgeEntries')
        .withIndex('by_instance_and_pinned', (q) => q.eq('instance', args.instance))
        .order('desc')
        .take(200);
    }
    if (args.pinnedOnly) {
      return rows.filter((r) => r.pinned === true);
    }
    // pinned first
    rows.sort((a, b) => {
      const ap = a.pinned ? 1 : 0;
      const bp = b.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return b.updatedAt - a.updatedAt;
    });
    return rows;
  },
});

export const create = mutation({
  args: {
    instance: v.string(),
    kind: kindValidator,
    title: v.string(),
    body: v.string(),
    tags: v.optional(v.array(v.string())),
    pinned: v.optional(v.boolean()),
    contactId: v.optional(v.id('contacts')),
  },
  handler: async (ctx, args) => {
    if (args.title.trim().length === 0) {
      throw new Error('Title required');
    }
    return await ctx.db.insert('knowledgeEntries', {
      instance: args.instance,
      kind: args.kind,
      title: args.title.trim(),
      body: args.body,
      tags: args.tags,
      pinned: args.pinned,
      contactId: args.contactId,
      updatedAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    entryId: v.id('knowledgeEntries'),
    kind: v.optional(kindValidator),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    pinned: v.optional(v.boolean()),
    contactId: v.optional(v.id('contacts')),
  },
  handler: async (ctx, args) => {
    const { entryId, ...rest } = args;
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(rest)) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(entryId, patch);
    return null;
  },
});

export const remove = mutation({
  args: { entryId: v.id('knowledgeEntries') },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.entryId);
    return null;
  },
});

export const removeMany = mutation({
  args: { entryIds: v.array(v.id('knowledgeEntries')) },
  returns: v.object({ deleted: v.number(), missing: v.number() }),
  handler: async (ctx, args) => {
    assertBulkSize(args.entryIds);
    let deleted = 0;
    for (const entryId of args.entryIds) {
      if ((await ctx.db.get(entryId)) === null) continue;
      await ctx.db.delete(entryId);
      deleted++;
    }
    return bulkResult(deleted, args.entryIds.length);
  },
});

export const search = query({
  args: {
    instance: v.string(),
    query: v.string(),
    kind: v.optional(kindValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<'knowledgeEntries'>[]> => {
    const q = args.query.trim();
    if (q.length === 0) return [];
    const limit = Math.min(args.limit ?? 20, 50);
    return await ctx.db
      .query('knowledgeEntries')
      .withSearchIndex('search_body', (b) => {
        const base = b.search('body', q).eq('instance', args.instance);
        return args.kind ? base.eq('kind', args.kind) : base;
      })
      .take(limit);
  },
});

export const listPinnedInternal = internalQuery({
  args: { instance: v.string() },
  handler: async (ctx, args): Promise<Doc<'knowledgeEntries'>[]> => {
    const rows = await ctx.db
      .query('knowledgeEntries')
      .withIndex('by_instance_and_pinned', (q) =>
        q.eq('instance', args.instance).eq('pinned', true),
      )
      .take(20);
    return rows;
  },
});

export const searchInternal = internalQuery({
  args: {
    instance: v.string(),
    query: v.string(),
    kind: v.optional(kindValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<'knowledgeEntries'>[]> => {
    const q = args.query.trim();
    if (q.length === 0) return [];
    const limit = Math.min(args.limit ?? 10, 50);
    return await ctx.db
      .query('knowledgeEntries')
      .withSearchIndex('search_body', (b) => {
        const base = b.search('body', q).eq('instance', args.instance);
        return args.kind ? base.eq('kind', args.kind) : base;
      })
      .take(limit);
  },
});
