// Tests for the denormalized chat-list state behind contacts.listChats.
//
// listChats used to derive every row from source data on each read. It now reads
// state stored on the contact, refreshed at write time. The thing most worth
// locking in is that the two agree: every test that asserts on a row also asserts
// the stored row is identical to the one computed from source, so a missed
// refresh hook shows up as a failure rather than a stale badge in the app.
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

vi.mock("./providers/evolution", () => ({
  sendText: vi.fn(),
  fetchMediaBase64: vi.fn(),
  fetchGroupInfo: vi.fn(),
}));
vi.mock("./providers/processing", () => ({
  generateReply: vi.fn(),
  generateText: vi.fn(),
}));
vi.mock("./providers/aiSdk", () => ({ runJsonExtraction: vi.fn() }));

const INSTANCE = "chat-state-test";
const JID = "233200000001@s.whatsapp.net";

type Ctx = ReturnType<typeof convexTest>;

let seq = 0;

async function ingest(
  t: Ctx,
  overrides: Record<string, unknown> = {},
): Promise<{ contactId: Id<"contacts">; messageId: Id<"messages"> }> {
  seq += 1;
  const result = await t.mutation(internal.messages.ingestMessage, {
    instance: INSTANCE,
    remoteJid: JID,
    messageId: `wamid-${seq}`,
    fromMe: false,
    messageType: "conversation",
    text: `message ${seq}`,
    status: "ready",
    timestamp: 1_000 + seq,
    ...overrides,
  });
  if (result.messageId === null) {
    throw new Error("Test message was unexpectedly ignored");
  }
  return { contactId: result.contactId, messageId: result.messageId };
}

async function listChats(t: Ctx) {
  return await t.query(api.contacts.listChats, { instance: INSTANCE });
}

/**
 * Drop the stored state so listChats falls back to computing from source, the
 * way it did before denormalization and the way it still does for contacts that
 * predate the backfill.
 */
async function clearStoredState(t: Ctx, contactId: Id<"contacts">) {
  await t.run(async (ctx) => {
    await ctx.db.patch(contactId, {
      chatStateVersion: undefined,
      unreadCount: undefined,
      unreadUrgent: undefined,
      unreadNeedsReply: undefined,
      unreadDeadline: undefined,
      unreadMeeting: undefined,
      unreadMentioned: undefined,
      pendingDraftCount: undefined,
      lastMessagePreview: undefined,
    });
  });
}

/**
 * The core invariant: the stored row and the computed-from-source row match.
 * Returns the row so callers can assert on it directly.
 */
async function expectStoredMatchesComputed(t: Ctx, contactId: Id<"contacts">) {
  const stored = await listChats(t);

  await clearStoredState(t, contactId);
  const computed = await listChats(t);
  expect(stored).toEqual(computed);

  // Put the contact back on the fast path for any assertions that follow.
  await t.mutation(internal.contacts.backfillChatState, {});
  return stored[0];
}

describe("denormalized chat list", () => {
  test("reports unread count and last-message preview", async () => {
    const t = convexTest(schema, modules);
    const { contactId } = await ingest(t, { text: "first" });
    await ingest(t, { text: "second" });

    const row = await expectStoredMatchesComputed(t, contactId);
    expect(row.unreadCount).toBe(2);
    expect(row.lastMessage?.text).toBe("second");
    expect(row.lastMessage?.fromMe).toBe(false);
  });

  test("outgoing messages update the preview but do not count as unread", async () => {
    const t = convexTest(schema, modules);
    const { contactId } = await ingest(t, { text: "from them" });

    await t.mutation(internal.messages.recordOutgoing, {
      instance: INSTANCE,
      remoteJid: JID,
      contactId,
      messageId: "wamid-out-1",
      text: "from me",
      sentByAi: false,
    });

    const row = await expectStoredMatchesComputed(t, contactId);
    expect(row.lastMessage?.text).toBe("from me");
    expect(row.lastMessage?.fromMe).toBe(true);
    // The inbound message is still unread; ours is not counted.
    expect(row.unreadCount).toBe(1);
  });

  test("markRead clears the unread count and its badges", async () => {
    const t = convexTest(schema, modules);
    const { contactId, messageId } = await ingest(t);
    await t.mutation(internal.messageActions.setFlagsInternal, {
      messageId,
      isUrgent: true,
      needsReply: true,
    });

    const before = await listChats(t);
    expect(before[0].unreadCount).toBe(1);
    expect(before[0].badges.urgent).toBe(true);

    await t.mutation(api.contacts.markRead, { contactId });

    const row = await expectStoredMatchesComputed(t, contactId);
    expect(row.unreadCount).toBe(0);
    expect(row.badges.urgent).toBe(false);
    expect(row.badges.needsReply).toBe(false);
    // The chat still shows its last message after being read.
    expect(row.lastMessage).not.toBeNull();
  });

  test("flags set after ingest surface as badges", async () => {
    const t = convexTest(schema, modules);
    const { contactId, messageId } = await ingest(t);

    await t.mutation(internal.messageActions.setFlagsInternal, {
      messageId,
      needsReply: true,
      hasDeadline: true,
      isMeeting: true,
      mentionsUser: true,
    });

    const row = await expectStoredMatchesComputed(t, contactId);
    expect(row.badges.needsReply).toBe(true);
    expect(row.badges.deadline).toBe(true);
    expect(row.badges.meeting).toBe(true);
    expect(row.badges.mentioned).toBe(true);
  });

  test("clearing a flag clears its badge", async () => {
    const t = convexTest(schema, modules);
    const { contactId, messageId } = await ingest(t);
    await t.mutation(internal.messageActions.setFlagsInternal, {
      messageId,
      isUrgent: true,
    });
    expect((await listChats(t))[0].badges.urgent).toBe(true);

    await t.mutation(api.messageActions.setUrgent, { messageId, isUrgent: false });

    const row = await expectStoredMatchesComputed(t, contactId);
    expect(row.badges.urgent).toBe(false);
  });

  test("a pending draft raises the draft badge and resolving it lowers it", async () => {
    const t = convexTest(schema, modules);
    const { contactId } = await ingest(t);

    const draftId = await t.mutation(internal.drafts.insertDraftInternal, {
      instance: INSTANCE,
      contactId,
      text: "suggested reply",
    });
    expect((await listChats(t))[0].badges.draftReady).toBe(true);

    await t.mutation(api.drafts.reject, { draftId });

    const row = await expectStoredMatchesComputed(t, contactId);
    expect(row.badges.draftReady).toBe(false);
  });

  test("deleting a draft lowers the draft badge", async () => {
    const t = convexTest(schema, modules);
    const { contactId } = await ingest(t);
    const draftId = await t.mutation(internal.drafts.insertDraftInternal, {
      instance: INSTANCE,
      contactId,
      text: "suggested reply",
    });

    await t.mutation(api.drafts.remove, { draftId });

    const row = await expectStoredMatchesComputed(t, contactId);
    expect(row.badges.draftReady).toBe(false);
  });

  test("delivery receipts update the preview's status ticks", async () => {
    const t = convexTest(schema, modules);
    const { contactId } = await ingest(t);
    await t.mutation(internal.messages.recordOutgoing, {
      instance: INSTANCE,
      remoteJid: JID,
      contactId,
      messageId: "wamid-out-2",
      text: "from me",
      sentByAi: false,
    });

    await t.mutation(internal.messages.updateDeliveryStatus, {
      instance: INSTANCE,
      messageId: "wamid-out-2",
      deliveryStatus: "read",
    });

    const row = await expectStoredMatchesComputed(t, contactId);
    expect(row.lastMessage?.deliveryStatus).toBe("read");
  });

  test("transcribing a voice note updates the stored preview text", async () => {
    const t = convexTest(schema, modules);
    const { contactId, messageId } = await ingest(t, {
      messageType: "audioMessage",
      text: "",
      status: "processing",
    });

    await t.mutation(internal.messages.setProcessingResult, {
      messageId,
      status: "ready",
      text: "transcribed content",
    });

    const row = await expectStoredMatchesComputed(t, contactId);
    expect(row.lastMessage?.text).toBe("transcribed content");
  });

  test("the backfill stamps contacts that predate the stored state", async () => {
    const t = convexTest(schema, modules);
    const { contactId } = await ingest(t);
    await clearStoredState(t, contactId);

    await t.run(async (ctx) => {
      const contact = await ctx.db.get(contactId);
      expect(contact?.chatStateVersion).toBeUndefined();
    });

    await t.mutation(internal.contacts.backfillChatState, {});

    await t.run(async (ctx) => {
      const contact = await ctx.db.get(contactId);
      expect(contact?.chatStateVersion).toBe(1);
      expect(contact?.unreadCount).toBe(1);
    });
  });

  test("chats are ordered by most recent message", async () => {
    const t = convexTest(schema, modules);
    await ingest(t, { remoteJid: "233200000002@s.whatsapp.net", timestamp: 5_000 });
    await ingest(t, { remoteJid: "233200000003@s.whatsapp.net", timestamp: 9_000 });

    const rows = await listChats(t);
    expect(rows).toHaveLength(2);
    expect(rows[0].lastMessage?.timestamp).toBe(9_000);
    expect(rows[1].lastMessage?.timestamp).toBe(5_000);
  });
});
