/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

const providerMocks = vi.hoisted(() => ({
  fetchMediaBase64: vi.fn(),
  describeImage: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock("./providers/evolution", () => ({
  sendText: vi.fn(),
  fetchMediaBase64: providerMocks.fetchMediaBase64,
  fetchGroupInfo: vi.fn(),
  fetchProfilePictureUrl: vi.fn(),
}));
vi.mock("./providers/processing", () => ({
  generateReply: vi.fn(),
  generateText: providerMocks.generateText,
  describeImage: providerMocks.describeImage,
}));
vi.mock("./providers/aiSdk", () => ({ runJsonExtraction: vi.fn() }));

const INSTANCE = "message-policy-test";

async function insertContact(
  t: ReturnType<typeof convexTest>,
  remoteJid: string,
  incomingMessageMode?: "save_and_process" | "save_only" | "ignore",
): Promise<Id<"contacts">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("contacts", {
      instance: INSTANCE,
      remoteJid,
      displayName: remoteJid,
      incomingMessageMode,
      lastMessageAt: 100,
    });
  });
}

async function ingest(
  t: ReturnType<typeof convexTest>,
  args: {
    remoteJid: string;
    messageId: string;
    fromMe?: boolean;
    messageType?: string;
    text?: string;
    timestamp?: number;
    mediaFileName?: string;
  },
) {
  return await t.mutation(internal.messages.ingestMessage, {
    instance: INSTANCE,
    remoteJid: args.remoteJid,
    messageId: args.messageId,
    fromMe: args.fromMe ?? false,
    messageType: args.messageType ?? "conversation",
    text: args.text ?? "hello",
    status: args.messageType && args.messageType !== "conversation" ? "processing" : "ready",
    timestamp: args.timestamp ?? 200,
    mediaFileName: args.mediaFileName,
  });
}

describe("per-chat incoming message policy", () => {
  test("save only stores raw text as manual-only and keeps it out of automatic reads", async () => {
    const t = convexTest(schema, modules);
    const remoteJid = "233200000101@s.whatsapp.net";
    const contactId = await insertContact(t, remoteJid, "save_only");

    const saved = await ingest(t, {
      remoteJid,
      messageId: "save-only",
      timestamp: 201,
    });
    expect(saved).toMatchObject({
      contactId,
      ignored: false,
      incomingMessageMode: "save_only",
    });

    const message = await t.run(async (ctx) => {
      return await ctx.db
        .query("messages")
        .withIndex("by_instance_and_messageId", (q) => q.eq("instance", INSTANCE).eq("messageId", "save-only"))
        .unique();
    });
    expect(message).toMatchObject({
      text: "hello",
      status: "ready",
      processingModeAtIngest: "manual_only",
    });

    const automatic = await t.query(internal.messages.listForInstanceInRange, {
      instance: INSTANCE,
      sinceMs: 0,
      includeFromMe: true,
      automaticOnly: true,
      limit: 20,
    });
    expect(automatic).toEqual([]);
  });

  test("save-only media uses a stable placeholder instead of remaining in processing", async () => {
    const t = convexTest(schema, modules);
    const remoteJid = "120363000001@g.us";
    await insertContact(t, remoteJid, "save_only");

    const saved = await ingest(t, {
      remoteJid,
      messageId: "saved-image",
      messageType: "imageMessage",
      text: "[Image received — describing...]",
    });
    if (saved.messageId === null) throw new Error("Expected saved message");
    const message = await t.query(api.messages.getMessage, {
      messageId: saved.messageId,
    });
    expect(message).toMatchObject({
      status: "skipped",
      text: "[Image received — saved without AI analysis]",
      processingModeAtIngest: "manual_only",
    });
  });

  test("a manual AI action prepares one saved-only media item without derived automation", async () => {
    const t = convexTest(schema, modules);
    const remoteJid = "120363000004@g.us";
    await insertContact(t, remoteJid, "save_only");
    const saved = await ingest(t, {
      remoteJid,
      messageId: "manual-image",
      messageType: "imageMessage",
    });
    if (saved.messageId === null) throw new Error("Expected saved message");

    providerMocks.fetchMediaBase64.mockResolvedValue({
      base64: "aW1hZ2U=",
      mimeType: "image/jpeg",
    });
    providerMocks.describeImage.mockResolvedValue("A project whiteboard with three tasks.");
    providerMocks.generateText.mockResolvedValue("A whiteboard lists three project tasks.");

    const result = await t.action(api.messageActions.summarize, {
      messageId: saved.messageId,
    });
    expect(result.summary).toBe("A whiteboard lists three project tasks.");
    const state = await t.run(async (ctx) => ({
      message: await ctx.db.get(saved.messageId as Id<"messages">),
      tasks: await ctx.db.query("tasks").take(10),
      drafts: await ctx.db.query("drafts").take(10),
      memories: await ctx.db.query("memories").take(10),
    }));
    expect(state.message).toMatchObject({
      status: "ready",
      text: "[Image] A project whiteboard with three tasks.",
      processingModeAtIngest: "manual_only",
    });
    expect(state.tasks).toEqual([]);
    expect(state.drafts).toEqual([]);
    expect(state.memories).toEqual([]);
  });

  test("ignore acknowledges without writing a message or advancing chat state", async () => {
    const t = convexTest(schema, modules);
    const remoteJid = "120363000002@g.us";
    const contactId = await insertContact(t, remoteJid, "ignore");

    const result = await ingest(t, {
      remoteJid,
      messageId: "ignored",
      timestamp: 999,
    });
    expect(result).toMatchObject({
      contactId,
      messageId: null,
      ignored: true,
      incomingMessageMode: "ignore",
    });
    const state = await t.run(async (ctx) => ({
      contact: await ctx.db.get(contactId),
      messages: await ctx.db.query("messages").take(10),
    }));
    expect(state.messages).toEqual([]);
    expect(state.contact?.lastMessageAt).toBe(100);
  });

  test("outgoing messages bypass Ignore", async () => {
    const t = convexTest(schema, modules);
    const remoteJid = "233200000102@s.whatsapp.net";
    await insertContact(t, remoteJid, "ignore");

    const result = await ingest(t, {
      remoteJid,
      messageId: "outgoing",
      fromMe: true,
    });
    expect(result).toMatchObject({
      ignored: false,
      incomingMessageMode: "save_and_process",
    });
    expect(result.messageId).not.toBeNull();
  });

  test("re-enabling processing affects only later messages", async () => {
    const t = convexTest(schema, modules);
    const remoteJid = "233200000103@s.whatsapp.net";
    const contactId = await insertContact(t, remoteJid, "save_only");
    await ingest(t, { remoteJid, messageId: "before-enable", timestamp: 201 });
    await t.mutation(api.chatSettings.setIncomingMessageMode, {
      contactId,
      mode: "save_and_process",
    });
    await ingest(t, { remoteJid, messageId: "after-enable", timestamp: 202 });

    const automatic = await t.query(internal.messages.listForInstanceInRange, {
      instance: INSTANCE,
      sinceMs: 0,
      includeFromMe: true,
      automaticOnly: true,
      limit: 20,
    });
    expect(automatic.map((message) => message.messageId)).toEqual(["after-enable"]);
  });
});
