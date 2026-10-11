import { v } from 'convex/values';
import { internalQuery, mutation, query } from './_generated/server';
import type { Doc } from './_generated/dataModel';

export const get = query({
  args: { instance: v.string() },
  handler: async (ctx, args): Promise<Doc<'assistantPreferences'> | null> => {
    const row = await ctx.db
      .query('assistantPreferences')
      .withIndex('by_instance', (q) => q.eq('instance', args.instance))
      .first();
    return row;
  },
});

export const set = mutation({
  args: { instance: v.string(), preferences: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('assistantPreferences')
      .withIndex('by_instance', (q) => q.eq('instance', args.instance))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        preferences: args.preferences,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert('assistantPreferences', {
      instance: args.instance,
      preferences: args.preferences,
      updatedAt: now,
    });
  },
});

export const getInternal = internalQuery({
  args: { instance: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    const row = await ctx.db
      .query('assistantPreferences')
      .withIndex('by_instance', (q) => q.eq('instance', args.instance))
      .first();
    return row?.preferences ?? null;
  },
});
