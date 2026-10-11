import { v } from 'convex/values';
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import { assertBulkSize, bulkResult } from './bulkDelete';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';

const scopeValidator = v.union(v.literal('user'), v.literal('contact'), v.literal('chat'));

const typeValidator = v.union(
  v.literal('fact'),
  v.literal('preference'),
  v.literal('commitment'),
  v.literal('ongoing'),
  v.literal('relationship'),
);

const statusValidator = v.union(
  v.literal('active'),
  v.literal('proposed'),
  v.literal('superseded'),
  v.literal('dismissed'),
  v.literal('expired'),
);

const writeModeValidator = v.union(v.literal('auto'), v.literal('approval'), v.literal('off'));

const DAY_MS = 24 * 60 * 60 * 1000;
const ONGOING_TTL_MS = 14 * DAY_MS;
const COMMITMENT_TTL_MS = 30 * DAY_MS;
const AUTO_CONFIDENCE_THRESHOLD = 0.7;

function defaultExpiry(type: string, now: number): number | undefined {
  if (type === 'ongoing') return now + ONGOING_TTL_MS;
  if (type === 'commitment') return now + COMMITMENT_TTL_MS;
  return undefined;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function overlapsExisting(a: string, b: string): boolean {
  const aTokens = new Set(tokenize(a));
  const bTokens = tokenize(b);
  let shared = 0;
  for (const t of bTokens) if (aTokens.has(t)) shared++;
  if (shared >= 3) return true;
  // Cheap prefix similarity for short entries.
  const aHead = a.slice(0, 40).toLowerCase();
  const bHead = b.slice(0, 40).toLowerCase();
  if (aHead.length >= 12 && bHead.length >= 12) {
    let same = 0;
    const min = Math.min(aHead.length, bHead.length);
    for (let i = 0; i < min; i++) if (aHead[i] === bHead[i]) same++;
    if (same / min >= 0.8) return true;
  }
  return false;
}

// ---------- public queries ----------

export const list = query({
  args: {
    instance: v.string(),
    scope: v.optional(scopeValidator),
    contactId: v.optional(v.id('contacts')),
    status: v.optional(statusValidator),
    type: v.optional(typeValidator),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<'memories'>[]> => {
    const limit = Math.min(args.limit ?? 100, 200);
    const q = (args.query ?? '').trim();

    let rows: Doc<'memories'>[];
    if (q.length > 0) {
      rows = await ctx.db
        .query('memories')
        .withSearchIndex('search_content', (b) => {
          const base = b.search('content', q).eq('instance', args.instance);
          if (args.contactId && args.scope && args.status !== undefined) {
            return base
              .eq('scope', args.scope)
              .eq('status', args.status)
              .eq('contactId', args.contactId);
          }
          if (args.scope && args.status !== undefined) {
            return base.eq('scope', args.scope).eq('status', args.status);
          }
          if (args.scope) return base.eq('scope', args.scope);
          return base;
        })
        .take(limit);
    } else if (args.contactId && args.scope) {
      rows = await ctx.db
        .query('memories')
        .withIndex('by_contact_scope_status', (qb) =>
          args.status !== undefined
            ? qb.eq('contactId', args.contactId!).eq('scope', args.scope!).eq('status', args.status)
            : qb.eq('contactId', args.contactId!).eq('scope', args.scope!),
        )
        .order('desc')
        .take(limit);
    } else if (args.scope) {
      rows = await ctx.db
        .query('memories')
        .withIndex('by_instance_scope_status', (qb) =>
          args.status !== undefined
            ? qb.eq('instance', args.instance).eq('scope', args.scope!).eq('status', args.status)
            : qb.eq('instance', args.instance).eq('scope', args.scope!),
        )
        .order('desc')
        .take(limit);
    } else {
      rows = await ctx.db
        .query('memories')
        .withIndex('by_instance_scope_status', (qb) => qb.eq('instance', args.instance))
        .order('desc')
        .take(limit);
      if (args.status !== undefined) {
        rows = rows.filter((r) => r.status === args.status);
      }
    }
    const filtered = args.type ? rows.filter((r) => r.type === args.type) : rows;
    filtered.sort((a, b) => {
      const ap = a.pinned ? 1 : 0;
      const bp = b.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return b.updatedAt - a.updatedAt;
    });
    return filtered;
  },
});

export const listPending = query({
  args: { instance: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<'memories'>[]> => {
    const limit = Math.min(args.limit ?? 50, 200);
    return await ctx.db
      .query('memories')
      .withIndex('by_instance_scope_status', (q) => q.eq('instance', args.instance))
      .filter((q) => q.eq(q.field('status'), 'proposed'))
      .order('desc')
      .take(limit);
  },
});

export const auditFor = query({
  args: { memoryId: v.id('memories'), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<'memoryAudit'>[]> => {
    const limit = Math.min(args.limit ?? 50, 200);
    return await ctx.db
      .query('memoryAudit')
      .withIndex('by_memory', (q) => q.eq('memoryId', args.memoryId))
      .order('desc')
      .take(limit);
  },
});

// ---------- public mutations ----------

async function writeAudit(
  ctx: { db: { insert: (table: 'memoryAudit', row: any) => Promise<unknown> } },
  args: {
    instance: string;
    memoryId: Id<'memories'>;
    action: Doc<'memoryAudit'>['action'];
    actor: Doc<'memoryAudit'>['actor'];
    before?: unknown;
    after?: unknown;
  },
) {
  await ctx.db.insert('memoryAudit', {
    instance: args.instance,
    memoryId: args.memoryId,
    action: args.action,
    actor: args.actor,
    before: args.before,
    after: args.after,
    at: Date.now(),
  });
}

export const create = mutation({
  args: {
    instance: v.string(),
    scope: scopeValidator,
    contactId: v.optional(v.id('contacts')),
    type: typeValidator,
    content: v.string(),
    pinned: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const content = args.content.trim();
    if (content.length === 0) throw new Error('content required');
    const now = Date.now();
    const id = await ctx.db.insert('memories', {
      instance: args.instance,
      scope: args.scope,
      contactId: args.contactId,
      type: args.type,
      content,
      confidence: 1,
      status: 'active',
      pinned: args.pinned,
      createdBy: 'user',
      expiresAt: args.pinned ? undefined : defaultExpiry(args.type, now),
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      instance: args.instance,
      memoryId: id,
      action: 'create',
      actor: 'user',
      after: { content, type: args.type, scope: args.scope },
    });
    return id;
  },
});

export const update = mutation({
  args: {
    memoryId: v.id('memories'),
    content: v.optional(v.string()),
    type: v.optional(typeValidator),
    expiresAt: v.optional(v.number()),
    pinned: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.memoryId);
    if (!row) throw new Error('memory not found');
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    const before = {
      content: row.content,
      type: row.type,
      expiresAt: row.expiresAt,
      pinned: row.pinned,
    };
    if (args.content !== undefined) patch.content = args.content.trim();
    if (args.type !== undefined) patch.type = args.type;
    if (args.expiresAt !== undefined) patch.expiresAt = args.expiresAt;
    if (args.pinned !== undefined) {
      patch.pinned = args.pinned;
      if (args.pinned === true) patch.expiresAt = undefined;
    }
    await ctx.db.patch(args.memoryId, patch);
    await writeAudit(ctx, {
      instance: row.instance,
      memoryId: args.memoryId,
      action: 'edit',
      actor: 'user',
      before,
      after: patch,
    });
    return null;
  },
});

export const pin = mutation({
  args: { memoryId: v.id('memories'), pinned: v.boolean() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.memoryId);
    if (!row) throw new Error('memory not found');
    const patch: Record<string, unknown> = {
      pinned: args.pinned,
      updatedAt: Date.now(),
    };
    if (args.pinned === true) patch.expiresAt = undefined;
    await ctx.db.patch(args.memoryId, patch);
    await writeAudit(ctx, {
      instance: row.instance,
      memoryId: args.memoryId,
      action: args.pinned ? 'pin' : 'unpin',
      actor: 'user',
    });
    return null;
  },
});

async function applySupersession(ctx: any, newRow: Doc<'memories'>): Promise<void> {
  // Find candidates of same (scope, contactId, type) that are active.
  const candidates = await ctx.db
    .query('memories')
    .withIndex(
      newRow.contactId ? 'by_contact_scope_status' : 'by_instance_scope_status',
      (q: any) =>
        newRow.contactId
          ? q.eq('contactId', newRow.contactId).eq('scope', newRow.scope).eq('status', 'active')
          : q.eq('instance', newRow.instance).eq('scope', newRow.scope).eq('status', 'active'),
    )
    .take(50);
  for (const c of candidates) {
    if (c._id === newRow._id) continue;
    if (c.type !== newRow.type) continue;
    if (c.pinned === true) continue;
    if (!overlapsExisting(c.content, newRow.content)) continue;
    const before = { status: c.status, supersededBy: c.supersededBy };
    await ctx.db.patch(c._id, {
      status: 'superseded',
      supersededBy: newRow._id,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      instance: c.instance,
      memoryId: c._id,
      action: 'supersede',
      actor: 'ai',
      before,
      after: { supersededBy: newRow._id },
    });
  }
}

export const approve = mutation({
  args: { memoryId: v.id('memories') },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.memoryId);
    if (!row) throw new Error('memory not found');
    if (row.status !== 'proposed') return null;
    const now = Date.now();
    await ctx.db.patch(args.memoryId, {
      status: 'active',
      updatedAt: now,
      expiresAt: row.expiresAt ?? defaultExpiry(row.type, now),
    });
    await writeAudit(ctx, {
      instance: row.instance,
      memoryId: args.memoryId,
      action: 'approve',
      actor: 'user',
    });
    const updated = await ctx.db.get(args.memoryId);
    if (updated) await applySupersession(ctx, updated);
    return null;
  },
});

export const reject = mutation({
  args: { memoryId: v.id('memories') },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.memoryId);
    if (!row) throw new Error('memory not found');
    await ctx.db.patch(args.memoryId, {
      status: 'dismissed',
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      instance: row.instance,
      memoryId: args.memoryId,
      action: 'reject',
      actor: 'user',
    });
    return null;
  },
});

export const dismiss = mutation({
  args: { memoryId: v.id('memories') },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.memoryId);
    if (!row) throw new Error('memory not found');
    await ctx.db.patch(args.memoryId, {
      status: 'dismissed',
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      instance: row.instance,
      memoryId: args.memoryId,
      action: 'dismiss',
      actor: 'user',
    });
    return null;
  },
});

export const remove = mutation({
  args: { memoryId: v.id('memories') },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.memoryId);
    if (!row) throw new Error('memory not found');
    await writeAudit(ctx, {
      instance: row.instance,
      memoryId: args.memoryId,
      action: 'delete',
      actor: 'user',
      before: row,
    });
    await ctx.db.delete(args.memoryId);
    return null;
  },
});

export const removeMany = mutation({
  args: { memoryIds: v.array(v.id('memories')) },
  returns: v.object({ deleted: v.number(), missing: v.number() }),
  handler: async (ctx, args) => {
    assertBulkSize(args.memoryIds);
    let deleted = 0;
    for (const memoryId of args.memoryIds) {
      const row = await ctx.db.get(memoryId);
      // Skip rather than throw: an id can go stale between listing and deleting,
      // and one stale row must not cost the user the whole selection.
      if (row === null) continue;
      // Each deletion is audited individually, exactly as the single-row path
      // does — a bulk delete is not a reason to lose the trail.
      await writeAudit(ctx, {
        instance: row.instance,
        memoryId,
        action: 'delete',
        actor: 'user',
        before: row,
      });
      await ctx.db.delete(memoryId);
      deleted++;
    }
    return bulkResult(deleted, args.memoryIds.length);
  },
});

// ---------- internal helpers ----------

export const proposeBatchInternal = internalMutation({
  args: {
    instance: v.string(),
    sourceMessageId: v.optional(v.id('messages')),
    proposals: v.array(
      v.object({
        scope: scopeValidator,
        contactId: v.optional(v.id('contacts')),
        type: typeValidator,
        content: v.string(),
        confidence: v.number(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<{ created: number; proposed: number }> => {
    if (args.proposals.length === 0) return { created: 0, proposed: 0 };

    const pref = await ctx.db
      .query('userPreferences')
      .withIndex('by_instance', (q) => q.eq('instance', args.instance))
      .unique();
    const mode = pref?.memoryWriteMode ?? 'auto';
    if (mode === 'off') return { created: 0, proposed: 0 };

    const now = Date.now();
    let created = 0;
    let proposed = 0;

    for (const p of args.proposals) {
      const content = p.content.trim();
      if (content.length < 4 || content.length > 500) continue;
      const confidence = Math.max(0, Math.min(1, p.confidence));
      const targetStatus: Doc<'memories'>['status'] =
        mode === 'approval'
          ? 'proposed'
          : confidence >= AUTO_CONFIDENCE_THRESHOLD
            ? 'active'
            : 'proposed';
      const id = await ctx.db.insert('memories', {
        instance: args.instance,
        scope: p.scope,
        contactId: p.contactId,
        type: p.type,
        content,
        confidence,
        status: targetStatus,
        createdBy: 'ai',
        sourceMessageId: args.sourceMessageId,
        expiresAt: targetStatus === 'active' ? defaultExpiry(p.type, now) : undefined,
        createdAt: now,
        updatedAt: now,
      });
      await writeAudit(ctx, {
        instance: args.instance,
        memoryId: id,
        action: 'create',
        actor: 'ai',
        after: {
          scope: p.scope,
          type: p.type,
          content,
          confidence,
          status: targetStatus,
        },
      });
      if (targetStatus === 'active') {
        const fresh = await ctx.db.get(id);
        if (fresh) await applySupersession(ctx, fresh);
        created++;
      } else {
        proposed++;
      }
    }
    return { created, proposed };
  },
});

export const retrieveForCallInternal = internalQuery({
  args: {
    instance: v.string(),
    contactId: v.optional(v.id('contacts')),
    chatId: v.optional(v.id('contacts')),
    charBudget: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    user: Array<{
      id: Id<'memories'>;
      type: string;
      content: string;
      pinned: boolean;
      confidence: number;
    }>;
    contact: Array<{
      id: Id<'memories'>;
      type: string;
      content: string;
      pinned: boolean;
      confidence: number;
    }>;
    chat: Array<{
      id: Id<'memories'>;
      type: string;
      content: string;
      pinned: boolean;
      confidence: number;
    }>;
  }> => {
    const budget = Math.max(500, args.charBudget ?? 8000);
    const now = Date.now();

    const sortAndCap = (rows: Doc<'memories'>[], cap: number) => {
      const fresh = rows.filter(
        (r) => r.status === 'active' && (r.expiresAt === undefined || r.expiresAt > now),
      );
      fresh.sort((a, b) => {
        const ap = a.pinned ? 1 : 0;
        const bp = b.pinned ? 1 : 0;
        if (ap !== bp) return bp - ap;
        // confidence * recency
        const aScore = a.confidence + a.updatedAt / 1e13;
        const bScore = b.confidence + b.updatedAt / 1e13;
        return bScore - aScore;
      });
      const out: Array<{
        id: Id<'memories'>;
        type: string;
        content: string;
        pinned: boolean;
        confidence: number;
      }> = [];
      let used = 0;
      for (const r of fresh) {
        const cost = r.content.length + 4;
        if (used + cost > cap) break;
        out.push({
          id: r._id,
          type: r.type,
          content: r.content,
          pinned: r.pinned === true,
          confidence: r.confidence,
        });
        used += cost;
      }
      return out;
    };

    // Split the budget evenly among scopes we asked for.
    const wantsContact = !!args.contactId;
    const wantsChat = !!args.chatId;
    const parts = 1 + (wantsContact ? 1 : 0) + (wantsChat ? 1 : 0);
    const perScopeCap = Math.floor(budget / parts);

    const userRows = await ctx.db
      .query('memories')
      .withIndex('by_instance_scope_status', (q) =>
        q.eq('instance', args.instance).eq('scope', 'user').eq('status', 'active'),
      )
      .take(100);
    const user = sortAndCap(userRows, perScopeCap);

    let contact: typeof user = [];
    if (wantsContact) {
      const rows = await ctx.db
        .query('memories')
        .withIndex('by_contact_scope_status', (q) =>
          q.eq('contactId', args.contactId!).eq('scope', 'contact').eq('status', 'active'),
        )
        .take(100);
      contact = sortAndCap(rows, perScopeCap);
    }

    let chat: typeof user = [];
    if (wantsChat) {
      const rows = await ctx.db
        .query('memories')
        .withIndex('by_contact_scope_status', (q) =>
          q.eq('contactId', args.chatId!).eq('scope', 'chat').eq('status', 'active'),
        )
        .take(100);
      chat = sortAndCap(rows, perScopeCap);
    }

    return { user, contact, chat };
  },
});

export const sweepExpiredInternal = internalAction({
  args: {},
  handler: async (ctx): Promise<{ expired: number }> => {
    return await ctx.runMutation(internal.memories.sweepExpiredPageInternal, {});
  },
});

export const sweepExpiredPageInternal = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ expired: number }> => {
    const now = Date.now();
    const candidates = await ctx.db
      .query('memories')
      .withIndex('by_status_expiry', (q) => q.eq('status', 'active'))
      .take(200);
    let n = 0;
    for (const r of candidates) {
      if (r.pinned === true) continue;
      if (r.expiresAt === undefined) continue;
      if (r.expiresAt > now) continue;
      await ctx.db.patch(r._id, { status: 'expired', updatedAt: now });
      await writeAudit(ctx, {
        instance: r.instance,
        memoryId: r._id,
        action: 'expire',
        actor: 'system',
      });
      n++;
    }
    return { expired: n };
  },
});

// Helpers needed by other modules (e.g. extractor reads contact memory toggle).
export const isMemoryEnabledForContactInternal = internalQuery({
  args: { contactId: v.id('contacts') },
  handler: async (ctx, args): Promise<boolean> => {
    const c = await ctx.db.get(args.contactId);
    return c?.memoryEnabled !== false;
  },
});

// Suppress unused-import lint (writeModeValidator used in mutations below).
void writeModeValidator;

export const getMemoryInternal = internalQuery({
  args: { memoryId: v.id('memories') },
  handler: async (ctx, args): Promise<Doc<'memories'> | null> => {
    return await ctx.db.get(args.memoryId);
  },
});
