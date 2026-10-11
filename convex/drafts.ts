import { v } from 'convex/values';
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { refreshChatState } from './chatState';
import { assertBulkSize, bulkResult } from './bulkDelete';

/**
 * A draft entering or leaving `pending` flips the chat list's "draft ready"
 * badge, which is served from the contact's denormalized state.
 */
async function refreshForDraft(ctx: MutationCtx, draftId: Id<'drafts'>): Promise<void> {
  const draft = await ctx.db.get(draftId);
  if (draft) await refreshChatState(ctx, draft.contactId);
}

const statusValidator = v.union(v.literal('pending'), v.literal('sent'), v.literal('rejected'));

const priorityValidator = v.union(
  v.literal('urgent'),
  v.literal('high'),
  v.literal('normal'),
  v.literal('low'),
);

const categoryValidator = v.union(
  v.literal('greeting'),
  v.literal('meeting'),
  v.literal('deadline'),
  v.literal('payment'),
  v.literal('client_issue'),
  v.literal('project_update'),
  v.literal('school'),
  v.literal('family'),
  v.literal('document'),
  v.literal('image'),
  v.literal('voice'),
  v.literal('group_announcement'),
  v.literal('spam'),
  v.literal('unknown'),
);

const sourceModeValidator = v.union(v.literal('auto_pipeline'), v.literal('manual_request'));

export const insertDraftInternal = internalMutation({
  args: {
    instance: v.string(),
    contactId: v.id('contacts'),
    sourceMessageId: v.optional(v.id('messages')),
    text: v.string(),
    style: v.optional(v.string()),
    reason: v.optional(v.string()),
    priority: v.optional(priorityValidator),
    confidence: v.optional(v.number()),
    aiSummary: v.optional(v.string()),
    category: v.optional(categoryValidator),
    sourceMode: v.optional(sourceModeValidator),
    goalId: v.optional(v.id('contactGoals')),
  },
  handler: async (ctx, args) => {
    const draftId = await ctx.db.insert('drafts', {
      instance: args.instance,
      contactId: args.contactId,
      sourceMessageId: args.sourceMessageId,
      text: args.text,
      generatedText: args.text,
      style: args.style,
      status: 'pending',
      reason: args.reason,
      priority: args.priority,
      confidence: args.confidence,
      aiSummary: args.aiSummary,
      category: args.category,
      sourceMode: args.sourceMode,
      goalId: args.goalId,
    });
    await refreshChatState(ctx, args.contactId);
    return draftId;
  },
});

export const list = query({
  args: {
    instance: v.string(),
    contactId: v.optional(v.id('contacts')),
    status: v.optional(statusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 200);
    const status = args.status ?? 'pending';
    const contactId = args.contactId;
    if (contactId !== undefined) {
      return await ctx.db
        .query('drafts')
        .withIndex('by_contact_and_status', (q) =>
          q.eq('contactId', contactId).eq('status', status),
        )
        .order('desc')
        .take(limit);
    }
    return await ctx.db
      .query('drafts')
      .withIndex('by_instance_and_status', (q) =>
        q.eq('instance', args.instance).eq('status', status),
      )
      .order('desc')
      .take(limit);
  },
});

export const hasPendingForContact = query({
  args: { contactId: v.id('contacts') },
  handler: async (ctx, args) => {
    const draft = await ctx.db
      .query('drafts')
      .withIndex('by_contact_and_status', (q) =>
        q.eq('contactId', args.contactId).eq('status', 'pending'),
      )
      .first();
    return draft !== null;
  },
});

export const updateText = mutation({
  args: {
    draftId: v.id('drafts'),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) throw new Error('Draft not found');
    await ctx.db.patch(args.draftId, {
      text: args.text,
      generatedText: draft.generatedText ?? draft.text,
      userEditedAt: args.text.trim() !== draft.text.trim() ? Date.now() : draft.userEditedAt,
    });
    return null;
  },
});

export const reject = mutation({
  args: { draftId: v.id('drafts') },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.draftId, { status: 'rejected' });
    await refreshForDraft(ctx, args.draftId);
    return null;
  },
});

export const ignoreDraft = mutation({
  args: { draftId: v.id('drafts') },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.draftId, { status: 'rejected' });
    await refreshForDraft(ctx, args.draftId);
    return null;
  },
});

export const rejectAndClearNeedsReply = mutation({
  args: { draftId: v.id('drafts') },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) return null;
    await ctx.db.patch(args.draftId, { status: 'rejected' });
    if (draft.sourceMessageId) {
      await ctx.db.patch(draft.sourceMessageId, { needsReply: false });
    }
    // Clears both the draft-ready badge and, if that message was unread, the
    // needs-reply badge.
    await refreshChatState(ctx, draft.contactId);
    return null;
  },
});

const queuePriorityFilterValidator = v.union(
  v.literal('urgent'),
  v.literal('high'),
  v.literal('normal'),
  v.literal('low'),
);

export const listQueue = query({
  args: {
    instance: v.string(),
    priority: v.optional(queuePriorityFilterValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 200);
    const all = await ctx.db
      .query('drafts')
      .withIndex('by_instance_and_status', (q) =>
        q.eq('instance', args.instance).eq('status', 'pending'),
      )
      .order('desc')
      .take(limit * 2);

    const filtered = args.priority
      ? all.filter((d) => (d.priority ?? 'normal') === args.priority)
      : all;

    const page = filtered.slice(0, limit);

    // The queue is usually several drafts deep on the same few contacts, so look
    // each contact up once instead of once per draft.
    const contactIds = [...new Set(page.map((d) => d.contactId))];
    const contacts = new Map(
      (await Promise.all(contactIds.map((id) => ctx.db.get(id))))
        .filter((c): c is Doc<'contacts'> => c !== null)
        .map((c) => [c._id as string, c]),
    );

    const sourceMessages = await Promise.all(
      page.map((d) => (d.sourceMessageId ? ctx.db.get(d.sourceMessageId) : null)),
    );

    return page.map((d, i) => {
      const contact = contacts.get(d.contactId as string);
      const sourceMessage = sourceMessages[i];
      return {
        draft: d,
        contactDisplayName:
          contact?.displayName ?? contact?.pushName ?? contact?.normalizedPhone ?? null,
        contactIsGroup: contact?.isGroup === true,
        sourceMessageText: sourceMessage?.text ?? null,
        sourceMessageTimestamp: sourceMessage?.timestamp ?? null,
        sourceMessageNeedsReply: sourceMessage?.needsReply === true,
      };
    });
  },
});

export const remove = mutation({
  args: { draftId: v.id('drafts') },
  handler: async (ctx, args) => {
    // Read the owner before the delete — afterwards there is nothing to read.
    const draft = await ctx.db.get(args.draftId);
    await ctx.db.delete(args.draftId);
    if (draft) await refreshChatState(ctx, draft.contactId);
    return null;
  },
});

export const removeMany = mutation({
  args: { draftIds: v.array(v.id('drafts')) },
  returns: v.object({ deleted: v.number(), missing: v.number() }),
  handler: async (ctx, args) => {
    assertBulkSize(args.draftIds);
    // The approvals queue is usually several drafts deep on the same few
    // contacts, so collect the owners and refresh each chat row once at the end
    // rather than once per draft.
    const touched = new Set<Id<'contacts'>>();
    let deleted = 0;
    for (const draftId of args.draftIds) {
      const draft = await ctx.db.get(draftId);
      if (draft === null) continue;
      await ctx.db.delete(draftId);
      touched.add(draft.contactId);
      deleted++;
    }
    for (const contactId of touched) {
      await refreshChatState(ctx, contactId);
    }
    return bulkResult(deleted, args.draftIds.length);
  },
});

export const getDraftInternal = internalQuery({
  args: { draftId: v.id('drafts') },
  handler: async (ctx, args): Promise<Doc<'drafts'> | null> => {
    return await ctx.db.get(args.draftId);
  },
});

export const updateDraftTextInternal = internalMutation({
  args: {
    draftId: v.id('drafts'),
    text: v.string(),
    style: v.optional(v.string()),
    feedbackVariant: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      text: args.text,
      generatedText: args.text,
      userEditedAt: undefined,
    };
    if (args.style !== undefined) patch.style = args.style;
    if (args.feedbackVariant !== undefined) {
      patch.feedbackVariant = args.feedbackVariant;
    }
    await ctx.db.patch(args.draftId, patch);
    return null;
  },
});

export const markSentInternal = internalMutation({
  args: {
    draftId: v.id('drafts'),
    sentMessageId: v.id('messages'),
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) return null;
    await ctx.db.patch(args.draftId, {
      status: 'sent',
      sentMessageId: args.sentMessageId,
      approvedByUser: true,
    });
    await refreshForDraft(ctx, args.draftId);
    await ctx.scheduler.runAfter(0, internal.replyStyle.refreshForContactInternal, {
      instance: draft.instance,
      contactId: draft.contactId,
    });
    return null;
  },
});

export const send = action({
  args: { draftId: v.id('drafts') },
  handler: async (ctx, args): Promise<{ sentMessageId: Id<'messages'> | null }> => {
    const draft: Doc<'drafts'> | null = await ctx.runQuery(internal.drafts.getDraftInternal, {
      draftId: args.draftId,
    });
    if (!draft) throw new Error('Draft not found');
    if (draft.status !== 'pending') {
      throw new Error(`Draft is not pending (status: ${draft.status})`);
    }
    const contact: Doc<'contacts'> | null = await ctx.runQuery(
      internal.contacts.getContactInternal,
      { contactId: draft.contactId },
    );
    if (!contact) throw new Error('Contact not found');

    const { sendText } = await import('./providers/evolution');
    const result = await sendText({
      instance: contact.instance,
      to: contact.remoteJid,
      text: draft.text,
    });

    if (!result.messageId) {
      console.warn('drafts.send: Evolution returned no messageId', {
        draftId: args.draftId,
      });
      return { sentMessageId: null };
    }

    const sentMessageId: Id<'messages'> = await ctx.runMutation(internal.messages.recordOutgoing, {
      instance: contact.instance,
      remoteJid: contact.remoteJid,
      contactId: contact._id,
      messageId: result.messageId,
      text: draft.text,
      sentByAi: true,
    });

    await ctx.runMutation(internal.drafts.markSentInternal, {
      draftId: args.draftId,
      sentMessageId,
    });

    // Credit the goal that produced this draft, so its "have they replied since
    // our last message" signal stays accurate for the draft-approval path.
    if (draft.goalId) {
      await ctx.runMutation(internal.contactGoals.noteGoalDraftSentInternal, {
        goalId: draft.goalId,
        sentMessageId,
      });
    }

    return { sentMessageId };
  },
});
