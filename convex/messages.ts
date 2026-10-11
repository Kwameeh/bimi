import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { internalMutation, internalQuery, query, action } from './_generated/server';
import { internal } from './_generated/api';
import type { Id, Doc } from './_generated/dataModel';
import { refreshChatState, refreshChatStateIfLatest } from './chatState';
import { canonicalWhatsAppJid } from './whatsappJid';
import {
  listAutomaticMessagesForContact,
  listAutomaticMessagesForInstance,
} from './messageProcessingPolicy';

const statusValidator = v.union(
  v.literal('ready'),
  v.literal('processing'),
  v.literal('failed'),
  v.literal('skipped'),
);

type IncomingMessageMode = 'save_and_process' | 'save_only' | 'ignore';

function savedWithoutAiText(messageType: string, fileName?: string): string {
  if (messageType === 'imageMessage') return '[Image received — saved without AI analysis]';
  if (messageType === 'audioMessage') return '[Voice note received — saved without AI analysis]';
  if (messageType === 'documentMessage') {
    return `[Document: ${fileName ?? 'unknown'} — saved without AI analysis]`;
  }
  return `[${messageType} received — saved without AI analysis]`;
}

function normalizePhone(value: string): string | undefined {
  const phone = value.split('@')[0]?.replace(/\D/g, '');
  return phone && phone.length >= 7 ? phone : undefined;
}

function getDisplayName(args: {
  pushName?: string;
  normalizedPhone?: string;
  remoteJid: string;
}): string {
  return args.pushName ?? args.normalizedPhone ?? args.remoteJid;
}

export const ingestMessage = internalMutation({
  args: {
    instance: v.string(),
    remoteJid: v.string(),
    remoteJidAlt: v.optional(v.string()),
    messageId: v.string(),
    fromMe: v.boolean(),
    messageType: v.string(),
    text: v.string(),
    caption: v.optional(v.string()),
    status: statusValidator,
    pushName: v.optional(v.string()),
    timestamp: v.optional(v.number()),
    mediaMimeType: v.optional(v.string()),
    mediaFileName: v.optional(v.string()),
    mediaSeconds: v.optional(v.number()),
    mediaPageCount: v.optional(v.number()),
    mediaFileLength: v.optional(v.number()),
    participant: v.optional(v.string()),
    participantPushName: v.optional(v.string()),
    mentionedJids: v.optional(v.array(v.string())),
    quotedMessageId: v.optional(v.string()),
    quotedParticipant: v.optional(v.string()),
    owner: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const canonicalRemoteJid = canonicalWhatsAppJid(args.remoteJid, args.remoteJidAlt);
    const isGroup = canonicalRemoteJid.endsWith('@g.us');
    const normalizedPhone = isGroup ? undefined : normalizePhone(canonicalRemoteJid);
    const displayName = isGroup
      ? canonicalRemoteJid
      : getDisplayName({
          pushName: args.pushName,
          normalizedPhone,
          remoteJid: canonicalRemoteJid,
        });
    const existingMessage = await ctx.db
      .query('messages')
      .withIndex('by_instance_and_messageId', (q) =>
        q.eq('instance', args.instance).eq('messageId', args.messageId),
      )
      .unique();

    if (existingMessage) {
      return {
        contactId: existingMessage.contactId,
        messageId: existingMessage._id,
        deduped: true as const,
        ignored: false as const,
        incomingMessageMode:
          existingMessage.processingModeAtIngest === 'manual_only'
            ? ('save_only' as const)
            : ('save_and_process' as const),
      };
    }

    const existingContactByJid = await ctx.db
      .query('contacts')
      .withIndex('by_instance_and_remoteJid', (q) =>
        q.eq('instance', args.instance).eq('remoteJid', canonicalRemoteJid),
      )
      .unique();
    const existingContactByLegacyJid =
      existingContactByJid || canonicalRemoteJid === args.remoteJid
        ? null
        : await ctx.db
            .query('contacts')
            .withIndex('by_instance_and_remoteJid', (q) =>
              q.eq('instance', args.instance).eq('remoteJid', args.remoteJid),
            )
            .unique();
    const existingContactByPhone =
      existingContactByJid || existingContactByLegacyJid
        ? null
        : normalizedPhone
          ? await ctx.db
              .query('contacts')
              .withIndex('by_instance_and_normalizedPhone', (q) =>
                q.eq('instance', args.instance).eq('normalizedPhone', normalizedPhone),
              )
              .first()
          : null;
    const existingContact =
      existingContactByJid ?? existingContactByLegacyJid ?? existingContactByPhone;

    const incomingMessageMode: IncomingMessageMode = args.fromMe
      ? 'save_and_process'
      : (existingContact?.incomingMessageMode ?? 'save_and_process');
    if (!args.fromMe && incomingMessageMode === 'ignore' && existingContact) {
      return {
        contactId: existingContact._id,
        messageId: null,
        deduped: false as const,
        ignored: true as const,
        incomingMessageMode,
      };
    }

    const processingModeAtIngest =
      incomingMessageMode === 'save_only' ? ('manual_only' as const) : ('automatic' as const);
    const automaticProcessing = processingModeAtIngest === 'automatic';

    let contactId: Id<'contacts'>;
    let shouldRefreshGroupInfo = false;
    if (existingContact) {
      contactId = existingContact._id;
      const patch: Record<string, unknown> = {};
      if (!isGroup && args.pushName && args.pushName !== existingContact.pushName) {
        patch.pushName = args.pushName;
      }
      if (existingContact.remoteJid !== canonicalRemoteJid) {
        patch.remoteJid = canonicalRemoteJid;
      }
      if (
        !existingContact.displayName ||
        existingContact.displayName === existingContact.remoteJid
      ) {
        patch.displayName = displayName;
      }
      if (!isGroup && normalizedPhone && normalizedPhone !== existingContact.normalizedPhone) {
        patch.normalizedPhone = normalizedPhone;
        patch.phoneNumber = normalizedPhone;
      }
      if (!existingContact.source) {
        patch.source = 'whatsapp';
      }
      if (
        !isGroup &&
        !existingContact.deviceContactId &&
        existingContact.syncStatus !== 'pending_phone_create'
      ) {
        patch.syncStatus = 'pending_phone_create';
        patch.syncUpdatedAt = Date.now();
      }
      if (isGroup && existingContact.isGroup !== true) {
        patch.isGroup = true;
      }
      if (isGroup && existingContact.lastMessageAt === undefined && !existingContact.groupSubject) {
        shouldRefreshGroupInfo = true;
      }
      if (args.timestamp !== undefined) {
        const ts = args.timestamp;
        if (existingContact.lastMessageAt === undefined || ts > existingContact.lastMessageAt) {
          patch.lastMessageAt = ts;
        }
        if (
          automaticProcessing &&
          (existingContact.lastAutomaticMessageAt === undefined ||
            ts > existingContact.lastAutomaticMessageAt)
        ) {
          patch.lastAutomaticMessageAt = ts;
        }
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(contactId, patch);
      }
    } else {
      contactId = await ctx.db.insert('contacts', {
        instance: args.instance,
        remoteJid: canonicalRemoteJid,
        phoneNumber: isGroup ? undefined : normalizedPhone,
        normalizedPhone: isGroup ? undefined : normalizedPhone,
        displayName,
        pushName: isGroup ? undefined : args.pushName,
        source: 'whatsapp',
        syncStatus: isGroup ? undefined : 'pending_phone_create',
        syncUpdatedAt: Date.now(),
        lastMessageAt: args.timestamp,
        lastAutomaticMessageAt: automaticProcessing ? args.timestamp : undefined,
        isGroup: isGroup || undefined,
      });
      shouldRefreshGroupInfo = isGroup;
      // Pull the profile picture for a brand-new chat right away, rather than
      // leaving it on initials until the next avatar sweep.
      await ctx.scheduler.runAfter(0, internal.contacts.refreshAvatarInternal, {
        contactId,
      });
    }

    if (shouldRefreshGroupInfo) {
      await ctx.scheduler.runAfter(0, internal.contacts.refreshGroupInfoInternal, { contactId });
    }

    const isSaveOnlyMedia =
      !args.fromMe &&
      processingModeAtIngest === 'manual_only' &&
      args.messageType !== 'conversation' &&
      args.messageType !== 'extendedTextMessage';
    const insertedId = await ctx.db.insert('messages', {
      contactId,
      instance: args.instance,
      remoteJid: canonicalRemoteJid,
      messageId: args.messageId,
      fromMe: args.fromMe,
      messageType: args.messageType,
      text: isSaveOnlyMedia ? savedWithoutAiText(args.messageType, args.mediaFileName) : args.text,
      caption: args.caption,
      pushName: args.pushName,
      timestamp: args.timestamp,
      status: isSaveOnlyMedia ? 'skipped' : args.status,
      processingModeAtIngest,
      mediaMimeType: args.mediaMimeType,
      mediaFileName: args.mediaFileName,
      mediaSeconds: args.mediaSeconds,
      mediaPageCount: args.mediaPageCount,
      mediaFileLength: args.mediaFileLength,
      deliveryStatus: args.fromMe ? 'sent' : 'delivered',
      participant: args.participant,
      participantPushName: args.participantPushName,
      mentionedJids: args.mentionedJids,
      quotedMessageId: args.quotedMessageId,
      quotedParticipant: args.quotedParticipant,
    });

    if (args.fromMe) {
      const pref = await ctx.db
        .query('userPreferences')
        .withIndex('by_instance', (q) => q.eq('instance', args.instance))
        .unique();
      if (!pref?.ownerJid) {
        // Best-effort owner detection from the webhook payload.
        const ownerJid = args.owner && args.owner.length > 0 ? args.owner : undefined;
        if (ownerJid) {
          const ownerPhone = normalizePhone(ownerJid);
          if (pref) {
            await ctx.db.patch(pref._id, {
              ownerJid,
              ownerPhone,
              ownerName: pref.ownerName ?? args.pushName,
            });
          } else {
            await ctx.db.insert('userPreferences', {
              instance: args.instance,
              defaultTone: 'casual',
              ownerJid,
              ownerPhone,
              ownerName: args.pushName,
            });
          }
        }
      }
    }

    // Refresh after the burst settles so both the user's latest wording and
    // the contact's response can shape this conversation's style profile.
    if (automaticProcessing) {
      await ctx.scheduler.runAfter(5 * 60 * 1000, internal.replyStyle.refreshForContactInternal, {
        instance: args.instance,
        contactId,
      });
    }

    await refreshChatState(ctx, contactId);

    return {
      contactId,
      messageId: insertedId,
      deduped: false as const,
      ignored: false as const,
      incomingMessageMode,
    };
  },
});

export const updateDeliveryStatus = internalMutation({
  args: {
    instance: v.string(),
    messageId: v.string(),
    deliveryStatus: v.union(
      v.literal('pending'),
      v.literal('sent'),
      v.literal('delivered'),
      v.literal('read'),
      v.literal('played'),
      v.literal('error'),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('messages')
      .withIndex('by_instance_and_messageId', (q) =>
        q.eq('instance', args.instance).eq('messageId', args.messageId),
      )
      .unique();
    if (!existing) return null;
    await ctx.db.patch(existing._id, { deliveryStatus: args.deliveryStatus });
    // The chat list renders read/delivered ticks for the latest message only.
    await refreshChatStateIfLatest(ctx, { ...existing, deliveryStatus: args.deliveryStatus });
    return existing._id;
  },
});

export const attachMediaStorageId = internalMutation({
  args: {
    messageId: v.id('messages'),
    storageId: v.id('_storage'),
    fetchStatus: v.union(v.literal('ready'), v.literal('failed')),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, {
      mediaStorageId: args.storageId,
      mediaFetchStatus: args.fetchStatus,
    });
    return null;
  },
});

export const markMediaFetchStatus = internalMutation({
  args: {
    messageId: v.id('messages'),
    fetchStatus: v.union(v.literal('pending'), v.literal('failed')),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { mediaFetchStatus: args.fetchStatus });
    return null;
  },
});

export const setProcessingResult = internalMutation({
  args: {
    messageId: v.id('messages'),
    status: statusValidator,
    text: v.optional(v.string()),
    processingError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { status: args.status };
    if (args.text !== undefined) patch.text = args.text;
    if (args.processingError !== undefined) patch.processingError = args.processingError;
    await ctx.db.patch(args.messageId, patch);
    // Transcription and OCR rewrite the message text after ingest.
    const updated = await ctx.db.get(args.messageId);
    if (updated) await refreshChatStateIfLatest(ctx, updated);
    return null;
  },
});

export const setImageClassificationInternal = internalMutation({
  args: {
    messageId: v.id('messages'),
    imageType: v.optional(
      v.union(
        v.literal('payment'),
        v.literal('receipt'),
        v.literal('flyer'),
        v.literal('server_error'),
        v.literal('notice'),
        v.literal('screenshot_text'),
        v.literal('other'),
      ),
    ),
    extractedFields: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {};
    if (args.imageType !== undefined) patch.imageType = args.imageType;
    if (args.extractedFields !== undefined) patch.extractedFields = args.extractedFields;
    if (Object.keys(patch).length === 0) return null;
    await ctx.db.patch(args.messageId, patch);
    return null;
  },
});

export const setExtractedFieldsInternal = internalMutation({
  args: {
    messageId: v.id('messages'),
    extractedFields: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { extractedFields: args.extractedFields });
    return null;
  },
});

export const getMessageForProcessing = internalQuery({
  args: { messageId: v.id('messages') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.messageId);
  },
});

export const getMessageForAutomaticProcessing = internalQuery({
  args: { messageId: v.id('messages') },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    return message?.processingModeAtIngest === 'manual_only' ? null : message;
  },
});

export const recordOutgoing = internalMutation({
  args: {
    instance: v.string(),
    remoteJid: v.string(),
    contactId: v.id('contacts'),
    messageId: v.string(),
    text: v.string(),
    sentByAi: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('messages')
      .withIndex('by_instance_and_messageId', (q) =>
        q.eq('instance', args.instance).eq('messageId', args.messageId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        sentByAi: args.sentByAi,
        deliveryStatus: existing.deliveryStatus ?? 'sent',
      });
      await refreshChatState(ctx, existing.contactId);
      return existing._id;
    }

    const now = Math.floor(Date.now() / 1000);
    const insertedId = await ctx.db.insert('messages', {
      contactId: args.contactId,
      instance: args.instance,
      remoteJid: args.remoteJid,
      messageId: args.messageId,
      fromMe: true,
      messageType: 'conversation',
      text: args.text,
      timestamp: now,
      status: 'ready',
      processingModeAtIngest: 'automatic',
      sentByAi: args.sentByAi,
      deliveryStatus: 'sent',
    });

    const contact = await ctx.db.get(args.contactId);
    if (contact) {
      const patch: Record<string, unknown> = {
        lastUserMessageAt: Date.now(),
        lastAutomaticMessageAt: now,
      };
      if (contact.lastMessageAt === undefined || now > contact.lastMessageAt) {
        patch.lastMessageAt = now;
      }
      await ctx.db.patch(args.contactId, patch);
    }

    if (!args.sentByAi) {
      await ctx.scheduler.runAfter(0, internal.followups.detectFollowupInternal, {
        messageId: insertedId,
      });
      await ctx.scheduler.runAfter(0, internal.replyStyle.refreshForContactInternal, {
        instance: args.instance,
        contactId: args.contactId,
      });
    }

    await ctx.scheduler.runAfter(0, internal.memoryExtraction.extractMemoriesInternal, {
      messageId: insertedId,
      direction: 'outgoing',
    });

    await refreshChatState(ctx, args.contactId);

    return insertedId;
  },
});

export const listForInstanceInRange = internalQuery({
  args: {
    instance: v.string(),
    sinceMs: v.number(),
    untilMs: v.optional(v.number()),
    contactId: v.optional(v.id('contacts')),
    includeFromMe: v.optional(v.boolean()),
    automaticOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 200, 800);
    const sinceSec = Math.floor(args.sinceMs / 1000);
    const untilSec = args.untilMs ? Math.floor(args.untilMs / 1000) : undefined;
    const rows = args.automaticOnly
      ? await listAutomaticMessagesForInstance(ctx, {
          instance: args.instance,
          sinceTimestamp: sinceSec,
          untilTimestamp: untilSec,
          limit,
          order: 'desc',
        })
      : await ctx.db
          .query('messages')
          .withIndex('by_instance_and_timestamp', (q) => {
            const base = q.eq('instance', args.instance);
            if (untilSec !== undefined) {
              return base.gte('timestamp', sinceSec).lte('timestamp', untilSec);
            }
            return base.gte('timestamp', sinceSec);
          })
          .order('desc')
          .take(limit);
    return rows.filter((m) => {
      if (!args.includeFromMe && m.fromMe) return false;
      if (args.contactId && m.contactId !== args.contactId) return false;
      return true;
    });
  },
});

export const getChatContext = internalQuery({
  args: {
    contactId: v.id('contacts'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) return null;
    const limit = Math.min(args.limit ?? 30, 80);
    const recent = await ctx.db
      .query('messages')
      .withIndex('by_contact_and_timestamp', (q) => q.eq('contactId', args.contactId))
      .order('desc')
      .take(limit);
    const history = recent
      .slice()
      .reverse()
      .map((m) => ({
        role: m.fromMe ? ('outgoing' as const) : ('incoming' as const),
        text: m.text,
      }));
    return {
      contactName: contact.displayName ?? contact.pushName ?? contact.normalizedPhone,
      isGroup: contact.isGroup === true,
      history,
    };
  },
});

export const getReplyContext = internalQuery({
  args: {
    messageId: v.id('messages'),
    historyLimit: v.optional(v.number()),
    includeManualOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) return null;
    if (!args.includeManualOnly && message.processingModeAtIngest === 'manual_only') {
      return null;
    }
    const contact = await ctx.db.get(message.contactId);
    const limit = args.historyLimit ?? 10;
    const recent = args.includeManualOnly
      ? await ctx.db
          .query('messages')
          .withIndex('by_contact_and_timestamp', (q) => q.eq('contactId', message.contactId))
          .order('desc')
          .take(limit + 1)
      : await listAutomaticMessagesForContact(ctx, {
          contactId: message.contactId,
          limit: limit + 1,
          order: 'desc',
        });
    const history = recent
      .filter((m) => m._id !== message._id)
      .reverse()
      .map((m) => ({
        role: m.fromMe ? ('outgoing' as const) : ('incoming' as const),
        text: m.text,
      }));
    return {
      message,
      contactName: contact?.displayName ?? contact?.pushName ?? contact?.normalizedPhone,
      history,
    };
  },
});

function senderOf(msg: Doc<'messages'>): 'contact' | 'user' | 'ai' {
  if (!msg.fromMe) return 'contact';
  return msg.sentByAi ? 'ai' : 'user';
}

export const listForContact = query({
  args: {
    contactId: v.id('contacts'),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('messages')
      .withIndex('by_contact_and_timestamp', (q) => q.eq('contactId', args.contactId))
      .order('desc')
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: page.page.map((m) => ({
        ...m,
        sender: senderOf(m),
      })),
    };
  },
});

export const getMessage = query({
  args: { messageId: v.id('messages') },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.messageId);
    if (!msg) return null;
    return { ...msg, sender: senderOf(msg) };
  },
});

export const searchMessages = query({
  args: {
    instance: v.string(),
    queryText: v.string(),
    contactId: v.optional(v.id('contacts')),
    sinceMs: v.optional(v.number()),
    untilMs: v.optional(v.number()),
    category: v.optional(v.string()),
    fromMe: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.queryText.trim().length === 0) return [];
    const limit = Math.min(args.limit ?? 30, 100);
    const expandedLimit = args.sinceMs || args.untilMs || args.category ? limit * 4 : limit;
    const results = await ctx.db
      .query('messages')
      .withSearchIndex('search_text', (q) => {
        const base = q.search('text', args.queryText).eq('instance', args.instance);
        let r = base;
        if (args.contactId !== undefined) r = r.eq('contactId', args.contactId);
        if (args.fromMe !== undefined) r = r.eq('fromMe', args.fromMe);
        return r;
      })
      .take(expandedLimit);

    const sinceSec = args.sinceMs ? Math.floor(args.sinceMs / 1000) : undefined;
    const untilSec = args.untilMs ? Math.floor(args.untilMs / 1000) : undefined;

    const filtered = results.filter((m) => {
      if (args.category && m.category !== args.category) return false;
      if (sinceSec !== undefined && (m.timestamp ?? 0) < sinceSec) return false;
      if (untilSec !== undefined && (m.timestamp ?? 0) > untilSec) return false;
      return true;
    });

    return filtered.slice(0, limit).map((m) => ({ ...m, sender: senderOf(m) }));
  },
});

export const send = action({
  args: {
    contactId: v.id('contacts'),
    text: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ messageId: Id<'messages'> | null; sentMessageId: string | null }> => {
    const trimmed = args.text.trim();
    if (trimmed.length === 0) {
      throw new Error('Cannot send an empty message');
    }
    const contact: Doc<'contacts'> | null = await ctx.runQuery(
      internal.contacts.getContactInternal,
      { contactId: args.contactId },
    );
    if (!contact) throw new Error('Contact not found');

    const { sendText } = await import('./providers/evolution');
    const sendResult = await sendText({
      instance: contact.instance,
      to: contact.remoteJid,
      text: trimmed,
    });

    if (!sendResult.messageId) {
      console.warn('send: Evolution returned no messageId', { contactId: args.contactId });
      return { messageId: null, sentMessageId: null };
    }

    const insertedId: Id<'messages'> = await ctx.runMutation(internal.messages.recordOutgoing, {
      instance: contact.instance,
      remoteJid: contact.remoteJid,
      contactId: args.contactId,
      messageId: sendResult.messageId,
      text: trimmed,
      sentByAi: false,
    });

    return { messageId: insertedId, sentMessageId: sendResult.messageId };
  },
});
