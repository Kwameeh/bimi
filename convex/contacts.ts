import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import {
  computeChatState,
  hasCurrentChatState,
  readChatState,
  refreshChatStateFor,
  type ChatState,
} from "./chatState";

const syncStatusValidator = v.union(
  v.literal("synced"),
  v.literal("pending_phone_create"),
  v.literal("pending_cloud_import"),
  v.literal("failed"),
);

const deviceContactValidator = v.object({
  deviceContactId: v.string(),
  name: v.optional(v.string()),
  phoneNumbers: v.array(v.string()),
});

function normalizePhone(value: string): string | undefined {
  const phone = value.replace(/\D/g, "");
  return phone && phone.length >= 7 ? phone : undefined;
}

function getPrimaryPhone(phoneNumbers: string[]): { phoneNumber?: string; normalizedPhone?: string } {
  for (const phoneNumber of phoneNumbers) {
    const normalizedPhone = normalizePhone(phoneNumber);
    if (normalizedPhone) {
      return { phoneNumber, normalizedPhone };
    }
  }
  return {};
}

function contactLabel(args: { name?: string; phoneNumber?: string; normalizedPhone?: string }): string {
  return args.name ?? args.phoneNumber ?? args.normalizedPhone ?? "Unknown contact";
}

export const listContacts = query({
  args: {
    instance: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("contacts")
      .withIndex("by_instance", (q) => q.eq("instance", args.instance))
      .take(args.limit ?? 200);
    return rows.map(withGroupView);
  },
});

export const listInstances = query({
  args: {},
  handler: async (ctx) => {
    const contacts = await ctx.db.query("contacts").take(100);
    return Array.from(new Set(contacts.map((contact) => contact.instance))).sort();
  },
});

export const listSyncCandidates = query({
  args: {
    instance: v.string(),
    status: v.optional(syncStatusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.status) {
      return await ctx.db
        .query("contacts")
        .withIndex("by_instance_and_syncStatus", (q) =>
          q.eq("instance", args.instance).eq("syncStatus", args.status),
        )
        .take(args.limit ?? 100);
    }

    return await ctx.db
      .query("contacts")
      .withIndex("by_instance", (q) => q.eq("instance", args.instance))
      .take(args.limit ?? 200);
  },
});

export const createContact = mutation({
  args: {
    instance: v.string(),
    name: v.optional(v.string()),
    phoneNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedPhone = normalizePhone(args.phoneNumber);
    if (!normalizedPhone) {
      throw new Error("A valid phone number is required.");
    }

    const existing = await ctx.db
      .query("contacts")
      .withIndex("by_instance_and_normalizedPhone", (q) =>
        q.eq("instance", args.instance).eq("normalizedPhone", normalizedPhone),
      )
      .first();

    const now = Date.now();
    const displayName = contactLabel({
      name: args.name,
      phoneNumber: args.phoneNumber,
      normalizedPhone,
    });

    if (existing) {
      await ctx.db.patch(existing._id, {
        displayName,
        phoneNumber: args.phoneNumber,
        normalizedPhone,
        source: existing.source ?? "bimi",
        syncStatus: existing.deviceContactId ? "synced" : "pending_phone_create",
        syncUpdatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("contacts", {
      instance: args.instance,
      remoteJid: `bimi:${normalizedPhone}`,
      phoneNumber: args.phoneNumber,
      normalizedPhone,
      displayName,
      source: "bimi",
      syncStatus: "pending_phone_create",
      syncUpdatedAt: now,
    });
  },
});

export const upsertFromDeviceBatch = mutation({
  args: {
    instance: v.string(),
    contacts: v.array(deviceContactValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const contact of args.contacts) {
      const { phoneNumber, normalizedPhone } = getPrimaryPhone(contact.phoneNumbers);
      if (!normalizedPhone && !contact.name) {
        skipped += 1;
        continue;
      }

      const existingByDeviceId = await ctx.db
        .query("contacts")
        .withIndex("by_instance_and_deviceContactId", (q) =>
          q.eq("instance", args.instance).eq("deviceContactId", contact.deviceContactId),
        )
        .first();

      const existingByPhone =
        existingByDeviceId || !normalizedPhone
          ? null
          : await ctx.db
              .query("contacts")
              .withIndex("by_instance_and_normalizedPhone", (q) =>
                q.eq("instance", args.instance).eq("normalizedPhone", normalizedPhone),
              )
              .first();

      const existing = existingByDeviceId ?? existingByPhone;
      const displayName = contactLabel({ name: contact.name, phoneNumber, normalizedPhone });

      if (existing) {
        await ctx.db.patch(existing._id, {
          displayName,
          deviceContactId: contact.deviceContactId,
          deviceContactName: contact.name,
          phoneNumber,
          normalizedPhone,
          source: existing.source ?? "device",
          syncStatus: "synced",
          lastDeviceSeenAt: now,
          lastDeviceSyncedAt: now,
          syncUpdatedAt: now,
        });
        updated += 1;
      } else {
        await ctx.db.insert("contacts", {
          instance: args.instance,
          remoteJid: `device:${contact.deviceContactId}`,
          displayName,
          deviceContactId: contact.deviceContactId,
          deviceContactName: contact.name,
          phoneNumber,
          normalizedPhone,
          source: "device",
          syncStatus: "synced",
          lastDeviceSeenAt: now,
          lastDeviceSyncedAt: now,
          syncUpdatedAt: now,
        });
        inserted += 1;
      }
    }

    return { inserted, updated, skipped };
  },
});

export const markExportedToDevice = mutation({
  args: {
    contactId: v.id("contacts"),
    deviceContactId: v.string(),
    deviceContactName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.contactId, {
      deviceContactId: args.deviceContactId,
      deviceContactName: args.deviceContactName,
      syncStatus: "synced",
      lastDeviceSeenAt: now,
      lastDeviceSyncedAt: now,
      syncUpdatedAt: now,
    });
    return null;
  },
});

export const markSyncFailed = mutation({
  args: {
    contactId: v.id("contacts"),
    syncError: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.contactId, {
      syncStatus: "failed",
      syncError: args.syncError.slice(0, 500),
      syncUpdatedAt: Date.now(),
    });
    return null;
  },
});

function isGroupJid(remoteJid: string): boolean {
  return remoteJid.endsWith("@g.us");
}

/**
 * How long a cached avatar is trusted before it is re-verified, by status.
 *
 * "ready" is re-checked daily with a cheap HEAD rather than a full Evolution
 * round-trip. "none" is retried rarely — the contact simply has no picture, but
 * they may add one. "failed" backs off enough to survive a provider outage.
 */
const AVATAR_RECHECK_MS: Record<"ready" | "none" | "failed", number> = {
  ready: 24 * 60 * 60 * 1000,
  none: 7 * 24 * 60 * 60 * 1000,
  failed: 6 * 60 * 60 * 1000,
};

/** Floor on client-reported refreshes, so a screen full of broken rows collapses into one retry per contact. */
const AVATAR_BROKEN_RETRY_MS = 10 * 60 * 1000;

const AVATAR_SWEEP_SCAN = 1000;
const AVATAR_SWEEP_BATCH = 40;
const AVATAR_SWEEP_STAGGER_MS = 400;

/**
 * The identifier Evolution can look a picture up by. Contacts imported from the
 * device or created in-app have no WhatsApp identity until they are messaged, so
 * they fall back to a phone number and are skipped when there isn't one.
 */
function profileLookupKey(contact: Doc<"contacts">): string | null {
  if (contact.remoteJid.includes("@")) return contact.remoteJid;
  return contact.normalizedPhone ?? null;
}

function isAvatarDue(contact: Doc<"contacts">, nowMs: number): boolean {
  if (contact.avatarCheckedAt === undefined) return true;
  const status = contact.avatarStatus ?? "failed";
  return nowMs - contact.avatarCheckedAt >= AVATAR_RECHECK_MS[status];
}

export const applyAvatarInternal = internalMutation({
  args: {
    contactId: v.id("contacts"),
    avatarUrl: v.optional(v.string()),
    status: v.union(v.literal("ready"), v.literal("none"), v.literal("failed")),
  },
  handler: async (ctx, args) => {
    // avatarUrl is always written, so an absent value clears a URL that has
    // rotated away rather than leaving a dead link on the contact.
    await ctx.db.patch(args.contactId, {
      avatarUrl: args.avatarUrl,
      avatarStatus: args.status,
      avatarCheckedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Verify a contact's cached profile picture and re-fetch it if it has rotated.
 *
 * WhatsApp serves pictures from signed pps.whatsapp.net URLs that expire, so a
 * cached URL is checked with a HEAD first and Evolution is only asked for a new
 * one when that check fails. `force` skips straight to the re-fetch, which is
 * what a client-reported broken image wants.
 */
export const refreshAvatarInternal = internalAction({
  args: {
    contactId: v.id("contacts"),
    force: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ status: "ready" | "none" | "failed" | "skipped"; rotated: boolean }> => {
    const contact: Doc<"contacts"> | null = await ctx.runQuery(
      internal.contacts.getContactInternal,
      { contactId: args.contactId },
    );
    if (!contact) return { status: "skipped", rotated: false };

    const lookup = profileLookupKey(contact);
    if (!lookup) {
      await ctx.runMutation(internal.contacts.applyAvatarInternal, {
        contactId: args.contactId,
        status: "none",
      });
      return { status: "none", rotated: false };
    }

    const { fetchProfilePictureUrl, isProfilePictureAlive } = await import(
      "./providers/evolution"
    );

    if (args.force !== true && contact.avatarUrl) {
      if (await isProfilePictureAlive(contact.avatarUrl)) {
        await ctx.runMutation(internal.contacts.applyAvatarInternal, {
          contactId: args.contactId,
          avatarUrl: contact.avatarUrl,
          status: "ready",
        });
        return { status: "ready", rotated: false };
      }
    }

    try {
      const pictureUrl = await fetchProfilePictureUrl({
        instance: contact.instance,
        number: lookup,
      });
      await ctx.runMutation(internal.contacts.applyAvatarInternal, {
        contactId: args.contactId,
        avatarUrl: pictureUrl ?? undefined,
        status: pictureUrl ? "ready" : "none",
      });
      return { status: pictureUrl ? "ready" : "none", rotated: true };
    } catch (err) {
      console.warn("refreshAvatar failed", {
        contactId: args.contactId,
        error: err instanceof Error ? err.message : String(err),
      });
      await ctx.runMutation(internal.contacts.applyAvatarInternal, {
        contactId: args.contactId,
        // Keep showing the old picture while the provider is unhappy; it may
        // still render even though the check could not confirm it.
        avatarUrl: contact.avatarUrl,
        status: "failed",
      });
      return { status: "failed", rotated: false };
    }
  },
});

/**
 * Periodic sweep for avatars that are missing or due a re-check. Most recently
 * active chats go first, since those are the rows actually on screen, and the
 * refreshes are staggered so a sweep never bursts against Evolution.
 */
export const sweepAvatarsInternal = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const now = Date.now();
    const contacts = await ctx.db.query("contacts").take(AVATAR_SWEEP_SCAN);
    const due = contacts
      .filter((c) => c.lastMessageAt !== undefined && isAvatarDue(c, now))
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
      .slice(0, AVATAR_SWEEP_BATCH);

    for (let i = 0; i < due.length; i++) {
      await ctx.scheduler.runAfter(
        i * AVATAR_SWEEP_STAGGER_MS,
        internal.contacts.refreshAvatarInternal,
        { contactId: due[i]._id },
      );
    }
    return { scheduled: due.length };
  },
});

/**
 * Called by the client when an avatar fails to render — the ground truth that a
 * URL has rotated, ahead of the next scheduled check. Rate-limited per contact,
 * because a list re-render can report the same broken picture many times.
 */
export const reportAvatarBroken = mutation({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) return null;
    if (
      contact.avatarCheckedAt !== undefined &&
      Date.now() - contact.avatarCheckedAt < AVATAR_BROKEN_RETRY_MS
    ) {
      return null;
    }
    // Stamp before scheduling so concurrent reports collapse into one refresh.
    await ctx.db.patch(args.contactId, { avatarCheckedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.contacts.refreshAvatarInternal, {
      contactId: args.contactId,
      force: true,
    });
    return null;
  },
});

function withGroupView(contact: Doc<"contacts">) {
  const isGroup = contact.isGroup ?? isGroupJid(contact.remoteJid);
  const displayName = isGroup
    ? contact.groupSubject ?? contact.displayName ?? contact.remoteJid
    : contact.displayName ?? contact.pushName ?? contact.normalizedPhone ?? contact.remoteJid;
  return { ...contact, isGroup, displayName };
}

/**
 * Trimmed contact projection for the chat list.
 *
 * The list used to return whole contact documents, which drags `groupParticipants`
 * (one entry per group member), `groupDescription` and every sync/goal field over
 * the wire for all 100-200 rows. The list screen only needs identity and grouping,
 * so send only that.
 */
function chatListContactView(contact: Doc<"contacts">) {
  const isGroup = contact.isGroup ?? isGroupJid(contact.remoteJid);
  return {
    _id: contact._id,
    remoteJid: contact.remoteJid,
    isGroup,
    displayName: isGroup
      ? contact.groupSubject ?? contact.displayName ?? contact.remoteJid
      : contact.displayName ?? contact.pushName ?? contact.normalizedPhone ?? contact.remoteJid,
    groupSubject: contact.groupSubject,
    // groupPictureUrl is a leftover from findGroupInfos and is not liveness
    // checked, so it only stands in until the avatar sweep reaches this group.
    avatarUrl: contact.avatarUrl ?? (isGroup ? contact.groupPictureUrl : undefined),
  };
}

function chatListRow(contact: Doc<"contacts">, state: ChatState) {
  const latest = state.lastMessagePreview;
  const recentAutoReply =
    contact.lastAutoReplyAt !== undefined &&
    latest?.timestamp !== undefined &&
    contact.lastAutoReplyAt >= latest.timestamp - 60;

  return {
    contact: chatListContactView(contact),
    lastMessage: latest
      ? {
          _id: latest.messageId,
          text: latest.text,
          fromMe: latest.fromMe,
          sentByAi: latest.sentByAi,
          timestamp: latest.timestamp,
          messageType: latest.messageType,
          deliveryStatus: latest.deliveryStatus,
          participant: latest.participant,
          participantPushName: latest.participantPushName,
        }
      : null,
    unreadCount: state.unreadCount,
    badges: {
      urgent: state.unreadUrgent,
      needsReply: state.unreadNeedsReply,
      draftReady: state.pendingDraftCount > 0,
      deadline: state.unreadDeadline,
      meeting: state.unreadMeeting,
      muted: contact.muted === true,
      autoReplied: recentAutoReply,
      mentioned: state.unreadMentioned,
    },
    priority: contact.priority ?? "normal",
  };
}

export const listChats = query({
  args: {
    instance: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 100, 200);
    const candidates = await ctx.db
      .query("contacts")
      .withIndex("by_instance_and_lastMessageAt", (q) => q.eq("instance", args.instance))
      .order("desc")
      .take(limit);
    const withChats = candidates.filter((c) => c.lastMessageAt !== undefined);

    // Fast path: the row is already stored on the contact, so this whole query
    // reads nothing beyond the contacts it returns. Contacts written before the
    // denormalization (or before a version bump) still compute from source until
    // the backfill or their next message stamps them.
    return await Promise.all(
      withChats.map(async (contact) =>
        chatListRow(
          contact,
          hasCurrentChatState(contact)
            ? readChatState(contact)
            : await computeChatState(ctx, contact),
        ),
      ),
    );
  },
});

export const getContact = query({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) return null;
    return withGroupView(contact);
  },
});

export const getContactInternal = internalQuery({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args): Promise<Doc<"contacts"> | null> => {
    return await ctx.db.get(args.contactId);
  },
});

export const findByName = query({
  args: { instance: v.string(), query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const trimmed = args.query.trim();
    if (trimmed.length === 0) return [];
    const limit = Math.min(args.limit ?? 5, 20);
    const rows = await ctx.db
      .query("contacts")
      .withSearchIndex("search_name", (q) =>
        q.search("displayName", trimmed).eq("instance", args.instance),
      )
      .take(limit);
    return rows.map((c) => ({
      _id: c._id,
      displayName: c.displayName ?? c.pushName ?? c.normalizedPhone ?? null,
      isGroup: c.isGroup === true,
      phoneNumber: c.phoneNumber,
      remoteJid: c.remoteJid,
    }));
  },
});

export const markRead = mutation({
  args: {
    contactId: v.id("contacts"),
    readAtSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ts = args.readAtSeconds ?? Math.floor(Date.now() / 1000);
    await ctx.db.patch(args.contactId, { lastReadAt: ts });
    // Unread count and badges are derived from lastReadAt, so they have to be
    // recomputed against the new watermark.
    const contact = await ctx.db.get(args.contactId);
    if (contact) await refreshChatStateFor(ctx, contact);
    return ts;
  },
});

export const setMemoryEnabled = mutation({
  args: { contactId: v.id("contacts"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.contactId, { memoryEnabled: args.enabled });
    return null;
  },
});

export const searchContacts = query({
  args: {
    instance: v.string(),
    queryText: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.queryText.trim().length === 0) return [];
    const limit = Math.min(args.limit ?? 30, 100);
    const results = await ctx.db
      .query("contacts")
      .withSearchIndex("search_name", (q) =>
        q.search("displayName", args.queryText).eq("instance", args.instance),
      )
      .take(limit);
    return results.map(withGroupView);
  },
});

export const applyGroupInfo = internalMutation({
  args: {
    contactId: v.id("contacts"),
    subject: v.optional(v.string()),
    description: v.optional(v.string()),
    size: v.optional(v.number()),
    owner: v.optional(v.string()),
    pictureUrl: v.optional(v.string()),
    creationAt: v.optional(v.number()),
    participants: v.array(
      v.object({
        id: v.string(),
        admin: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) return null;
    const patch: Record<string, unknown> = {
      isGroup: true,
      groupParticipants: args.participants,
      groupInfoUpdatedAt: Math.floor(Date.now() / 1000),
    };
    if (args.subject !== undefined) {
      const subject = args.subject.trim();
      if (subject.length > 0) {
        patch.groupSubject = subject;
        patch.displayName = subject;
      }
    }
    if (args.description !== undefined) patch.groupDescription = args.description;
    if (args.size !== undefined) patch.groupSize = args.size;
    if (args.owner !== undefined) patch.groupOwner = args.owner;
    if (args.pictureUrl !== undefined) patch.groupPictureUrl = args.pictureUrl;
    if (args.creationAt !== undefined) patch.groupCreationAt = args.creationAt;
    await ctx.db.patch(args.contactId, patch);
    return null;
  },
});

async function refreshGroupInfoForContact(
  ctx: ActionCtx,
  contactId: Id<"contacts">,
): Promise<{ ok: boolean; participants: number; subject?: string }> {
  const contact: Doc<"contacts"> | null = await ctx.runQuery(
    internal.contacts.getContactInternal,
    { contactId },
  );
  if (!contact) throw new Error("Contact not found");
  if (!(contact.isGroup ?? isGroupJid(contact.remoteJid))) {
    throw new Error("Contact is not a group");
  }
  const { fetchGroupInfo } = await import("./providers/evolution");
  const info = await fetchGroupInfo({
    instance: contact.instance,
    groupJid: contact.remoteJid,
  });
  await ctx.runMutation(internal.contacts.applyGroupInfo, {
    contactId,
    subject: info.subject,
    description: info.desc,
    size: info.size ?? info.participants.length,
    owner: info.owner,
    pictureUrl: info.pictureUrl,
    creationAt: info.creation,
    participants: info.participants,
  });
  return { ok: true, participants: info.participants.length, subject: info.subject };
}

export const refreshGroupInfoInternal = internalAction({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    return await refreshGroupInfoForContact(ctx, args.contactId);
  },
});

export const refreshGroupInfo = action({
  args: { contactId: v.id("contacts") },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; participants: number; subject?: string }> => {
    return await refreshGroupInfoForContact(ctx, args.contactId);
  },
});

/**
 * One-time migration that stamps the denormalized chat-list state onto existing
 * contacts, so no chat pays listChats' compute-from-source fallback.
 *
 * Run once after deploying:
 *   npx convex run contacts:backfillChatState
 *
 * Walks the whole contacts table in creation order and re-schedules itself until
 * done. Batches stay small because each contact costs a bounded message scan, and
 * it skips contacts already at the current version so re-running is harmless.
 */
export const backfillChatState = internalMutation({
  args: {
    after: v.optional(v.number()),
    batchSize: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ scanned: number; updated: number; isDone: boolean }> => {
    const batchSize = Math.min(args.batchSize ?? 25, 100);
    const after = args.after;
    const rows = await ctx.db
      .query("contacts")
      .withIndex("by_creation_time", (q) =>
        after === undefined ? q : q.gt("_creationTime", after),
      )
      .order("asc")
      .take(batchSize);

    let updated = 0;
    for (const contact of rows) {
      if (hasCurrentChatState(contact)) continue;
      await refreshChatStateFor(ctx, contact);
      updated += 1;
    }

    const isDone = rows.length < batchSize;
    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.contacts.backfillChatState, {
        after: rows[rows.length - 1]._creationTime,
        batchSize,
      });
    }
    return { scanned: rows.length, updated, isDone };
  },
});
