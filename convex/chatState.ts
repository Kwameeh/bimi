import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * Denormalized chat-list state.
 *
 * `contacts.listChats` used to derive every row from source data: per contact it
 * ran a "latest message" query, an unread scan of up to 50 message documents and
 * a pending-draft lookup. At the 100-200 contacts the screen asks for that is
 * ~300 index lookups and up to 10,000 message documents per load — and because
 * Convex queries are reactive subscriptions, every one of those message
 * documents joined the read set, so any write to any of them (classification,
 * media fetch status, delivery receipts) re-ran the whole thing.
 *
 * Instead the row is computed once at write time and stored on the contact, so
 * the query is a single index scan that reads nothing but the contacts it
 * returns.
 *
 * State is always recomputed from source rather than incremented in place.
 * Recomputing costs one bounded scan on a single contact per write, and it
 * cannot drift the way a counter can when messages arrive out of order, get
 * reclassified, or are marked read concurrently.
 */

/**
 * Bump when the stored shape or its semantics change. Contacts still carrying an
 * older version fall back to computing their row from source, so a bump degrades
 * to the old behaviour instead of serving stale data.
 */
export const CHAT_STATE_VERSION = 1;

/**
 * The unread scan is capped, so `unreadCount` means "50+" at the ceiling. This
 * matches the pre-denormalization `.take(50)` exactly — the number the UI shows
 * does not change meaning.
 */
const UNREAD_SCAN_CAP = 50;

/** Only presence matters to the badge, so there is no reason to count further. */
const DRAFT_SCAN_CAP = 5;

export type LastMessagePreview = {
  messageId: Id<"messages">;
  text: string;
  fromMe: boolean;
  sentByAi: boolean;
  timestamp?: number;
  messageType: string;
  deliveryStatus?:
    | "pending"
    | "sent"
    | "delivered"
    | "read"
    | "played"
    | "error";
  participant?: string;
  participantPushName?: string;
};

export type ChatState = {
  unreadCount: number;
  unreadUrgent: boolean;
  unreadNeedsReply: boolean;
  unreadDeadline: boolean;
  unreadMeeting: boolean;
  unreadMentioned: boolean;
  pendingDraftCount: number;
  lastMessagePreview: LastMessagePreview | undefined;
  chatStateVersion: number;
};

function toPreview(message: Doc<"messages">): LastMessagePreview {
  return {
    messageId: message._id,
    text: message.text,
    fromMe: message.fromMe,
    sentByAi: message.sentByAi ?? false,
    timestamp: message.timestamp,
    messageType: message.messageType,
    deliveryStatus: message.deliveryStatus,
    participant: message.participant,
    participantPushName: message.participantPushName,
  };
}

/**
 * Derive a contact's chat-list row from source data. Used to seed the stored
 * state on write, and as the fallback for contacts that predate it.
 */
export async function computeChatState(
  ctx: QueryCtx,
  contact: Doc<"contacts">,
): Promise<ChatState> {
  const unreadStart = contact.lastReadAt ?? 0;
  const unreadBatch = await ctx.db
    .query("messages")
    .withIndex("by_contact_and_timestamp", (q) =>
      q.eq("contactId", contact._id).gt("timestamp", unreadStart),
    )
    .order("desc")
    .take(UNREAD_SCAN_CAP);

  // Anything newer than lastReadAt outranks everything older, so when the unread
  // scan found something its first row is already the contact's latest message
  // and the separate "latest" query can be skipped.
  const latest =
    unreadBatch[0] ??
    (await ctx.db
      .query("messages")
      .withIndex("by_contact_and_timestamp", (q) => q.eq("contactId", contact._id))
      .order("desc")
      .first());

  const unreadIncoming = unreadBatch.filter((m) => !m.fromMe);

  const pendingDrafts = await ctx.db
    .query("drafts")
    .withIndex("by_contact_and_status", (q) =>
      q.eq("contactId", contact._id).eq("status", "pending"),
    )
    .take(DRAFT_SCAN_CAP);

  return {
    unreadCount: unreadIncoming.length,
    unreadUrgent: unreadIncoming.some((m) => m.isUrgent === true),
    unreadNeedsReply: unreadIncoming.some((m) => m.needsReply === true),
    unreadDeadline: unreadIncoming.some((m) => m.hasDeadline === true),
    unreadMeeting: unreadIncoming.some((m) => m.isMeeting === true),
    unreadMentioned: unreadIncoming.some((m) => m.mentionsUser === true),
    pendingDraftCount: pendingDrafts.length,
    lastMessagePreview: latest ? toPreview(latest) : undefined,
    chatStateVersion: CHAT_STATE_VERSION,
  };
}

/** Read state already stored on a contact. Only valid at the current version. */
export function readChatState(contact: Doc<"contacts">): ChatState {
  return {
    unreadCount: contact.unreadCount ?? 0,
    unreadUrgent: contact.unreadUrgent === true,
    unreadNeedsReply: contact.unreadNeedsReply === true,
    unreadDeadline: contact.unreadDeadline === true,
    unreadMeeting: contact.unreadMeeting === true,
    unreadMentioned: contact.unreadMentioned === true,
    pendingDraftCount: contact.pendingDraftCount ?? 0,
    lastMessagePreview: contact.lastMessagePreview,
    chatStateVersion: contact.chatStateVersion ?? 0,
  };
}

export function hasCurrentChatState(contact: Doc<"contacts">): boolean {
  return contact.chatStateVersion === CHAT_STATE_VERSION;
}

/**
 * Recompute and store one contact's chat-list row. Call after any write that can
 * change what the row shows: a new message, a text or delivery-status change on
 * the latest message, a flag change on an unread message, a read receipt, or a
 * draft entering or leaving `pending`.
 *
 * Safe to call with a stale or deleted contact id — it no-ops.
 */
export async function refreshChatState(
  ctx: MutationCtx,
  contactId: Id<"contacts">,
): Promise<void> {
  const contact = await ctx.db.get(contactId);
  if (!contact) return;
  await ctx.db.patch(contactId, await computeChatState(ctx, contact));
}

/**
 * Same, but for a contact document already loaded by the caller. Avoids a second
 * read in mutations that just patched the contact.
 */
export async function refreshChatStateFor(
  ctx: MutationCtx,
  contact: Doc<"contacts">,
): Promise<void> {
  await ctx.db.patch(contact._id, await computeChatState(ctx, contact));
}

/**
 * Refresh only when the changed message is the one the chat list is showing.
 *
 * Delivery receipts and media post-processing fire constantly but usually target
 * a message that is no longer the latest, where a recompute would change nothing.
 * Costs one contact read to decide.
 */
export async function refreshChatStateIfLatest(
  ctx: MutationCtx,
  message: Doc<"messages">,
): Promise<void> {
  const contact = await ctx.db.get(message.contactId);
  if (!contact) return;
  // Not backfilled yet: listChats still computes this row from source, so there
  // is nothing stored to keep in sync.
  if (!hasCurrentChatState(contact)) return;
  if (contact.lastMessagePreview?.messageId !== message._id) return;
  await refreshChatStateFor(ctx, contact);
}
