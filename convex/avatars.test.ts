// Tests for cached WhatsApp profile pictures.
//
// The picture URL is cached rather than copied into Convex storage, and WhatsApp
// serves pictures from signed URLs that rotate. So the behaviour worth locking in
// is the rotation handling: a live URL must not cost an Evolution call, a rotated
// one must be re-fetched, and a provider outage must not wipe a good picture.
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

const fetchProfilePictureUrl = vi.hoisted(() => vi.fn());
const isProfilePictureAlive = vi.hoisted(() => vi.fn());

vi.mock("./providers/evolution", () => ({
  fetchProfilePictureUrl,
  isProfilePictureAlive,
  sendText: vi.fn(),
  fetchMediaBase64: vi.fn(),
  fetchGroupInfo: vi.fn(),
}));
vi.mock("./providers/processing", () => ({
  generateReply: vi.fn(),
  generateText: vi.fn(),
}));
vi.mock("./providers/aiSdk", () => ({ runJsonExtraction: vi.fn() }));

const INSTANCE = "avatar-test";
const JID = "233200000001@s.whatsapp.net";
const PICTURE = "https://pps.whatsapp.net/v/original.jpg";
const ROTATED = "https://pps.whatsapp.net/v/rotated.jpg";

type Ctx = ReturnType<typeof convexTest>;

beforeEach(() => {
  vi.clearAllMocks();
});

async function makeContact(
  t: Ctx,
  overrides: Record<string, unknown> = {},
): Promise<Id<"contacts">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("contacts", {
      instance: INSTANCE,
      remoteJid: JID,
      displayName: "Kwame",
      lastMessageAt: 1_000,
      ...overrides,
    }),
  );
}

async function readContact(t: Ctx, contactId: Id<"contacts">) {
  return await t.run(async (ctx) => ctx.db.get(contactId));
}

describe("profile picture caching", () => {
  test("fetches and stores a picture for a contact that has none", async () => {
    const t = convexTest(schema, modules);
    const contactId = await makeContact(t);
    fetchProfilePictureUrl.mockResolvedValue(PICTURE);

    const result = await t.action(internal.contacts.refreshAvatarInternal, { contactId });

    expect(result.status).toBe("ready");
    const contact = await readContact(t, contactId);
    expect(contact?.avatarUrl).toBe(PICTURE);
    expect(contact?.avatarStatus).toBe("ready");
    expect(contact?.avatarCheckedAt).toBeGreaterThan(0);
  });

  test("records 'none' when the contact has no picture or hides it", async () => {
    const t = convexTest(schema, modules);
    const contactId = await makeContact(t);
    fetchProfilePictureUrl.mockResolvedValue(null);

    const result = await t.action(internal.contacts.refreshAvatarInternal, { contactId });

    expect(result.status).toBe("none");
    const contact = await readContact(t, contactId);
    expect(contact?.avatarUrl).toBeUndefined();
    expect(contact?.avatarStatus).toBe("none");
  });

  test("a still-live cached URL is kept without asking Evolution again", async () => {
    const t = convexTest(schema, modules);
    const contactId = await makeContact(t, {
      avatarUrl: PICTURE,
      avatarStatus: "ready",
      avatarCheckedAt: 1,
    });
    isProfilePictureAlive.mockResolvedValue(true);

    const result = await t.action(internal.contacts.refreshAvatarInternal, { contactId });

    expect(result).toEqual({ status: "ready", rotated: false });
    expect(isProfilePictureAlive).toHaveBeenCalledWith(PICTURE);
    // The whole point of the HEAD check: no provider round-trip when nothing moved.
    expect(fetchProfilePictureUrl).not.toHaveBeenCalled();
    expect((await readContact(t, contactId))?.avatarUrl).toBe(PICTURE);
  });

  test("a rotated URL is detected and replaced", async () => {
    const t = convexTest(schema, modules);
    const contactId = await makeContact(t, {
      avatarUrl: PICTURE,
      avatarStatus: "ready",
      avatarCheckedAt: 1,
    });
    isProfilePictureAlive.mockResolvedValue(false);
    fetchProfilePictureUrl.mockResolvedValue(ROTATED);

    const result = await t.action(internal.contacts.refreshAvatarInternal, { contactId });

    expect(result).toEqual({ status: "ready", rotated: true });
    expect(fetchProfilePictureUrl).toHaveBeenCalledOnce();
    expect((await readContact(t, contactId))?.avatarUrl).toBe(ROTATED);
  });

  test("a picture removed upstream clears the cached URL", async () => {
    const t = convexTest(schema, modules);
    const contactId = await makeContact(t, {
      avatarUrl: PICTURE,
      avatarStatus: "ready",
      avatarCheckedAt: 1,
    });
    isProfilePictureAlive.mockResolvedValue(false);
    fetchProfilePictureUrl.mockResolvedValue(null);

    await t.action(internal.contacts.refreshAvatarInternal, { contactId });

    const contact = await readContact(t, contactId);
    expect(contact?.avatarUrl).toBeUndefined();
    expect(contact?.avatarStatus).toBe("none");
  });

  test("force skips the liveness check and re-fetches immediately", async () => {
    const t = convexTest(schema, modules);
    const contactId = await makeContact(t, {
      avatarUrl: PICTURE,
      avatarStatus: "ready",
      avatarCheckedAt: 1,
    });
    fetchProfilePictureUrl.mockResolvedValue(ROTATED);

    await t.action(internal.contacts.refreshAvatarInternal, { contactId, force: true });

    expect(isProfilePictureAlive).not.toHaveBeenCalled();
    expect((await readContact(t, contactId))?.avatarUrl).toBe(ROTATED);
  });

  test("a provider outage keeps the existing picture instead of blanking it", async () => {
    const t = convexTest(schema, modules);
    const contactId = await makeContact(t, {
      avatarUrl: PICTURE,
      avatarStatus: "ready",
      avatarCheckedAt: 1,
    });
    isProfilePictureAlive.mockResolvedValue(false);
    fetchProfilePictureUrl.mockRejectedValue(new Error("evolution down"));

    const result = await t.action(internal.contacts.refreshAvatarInternal, { contactId });

    expect(result.status).toBe("failed");
    const contact = await readContact(t, contactId);
    expect(contact?.avatarUrl).toBe(PICTURE);
    expect(contact?.avatarStatus).toBe("failed");
  });

  test("contacts with no WhatsApp identity are not looked up", async () => {
    const t = convexTest(schema, modules);
    const contactId = await makeContact(t, {
      remoteJid: "device:abc123",
      normalizedPhone: undefined,
    });

    const result = await t.action(internal.contacts.refreshAvatarInternal, { contactId });

    expect(result.status).toBe("none");
    expect(fetchProfilePictureUrl).not.toHaveBeenCalled();
  });

  test("a device contact falls back to its phone number", async () => {
    const t = convexTest(schema, modules);
    const contactId = await makeContact(t, {
      remoteJid: "device:abc123",
      normalizedPhone: "233200000009",
    });
    fetchProfilePictureUrl.mockResolvedValue(PICTURE);

    await t.action(internal.contacts.refreshAvatarInternal, { contactId });

    expect(fetchProfilePictureUrl).toHaveBeenCalledWith({
      instance: INSTANCE,
      number: "233200000009",
    });
  });

  test("repeat broken-image reports collapse into a single refresh", async () => {
    const t = convexTest(schema, modules);
    const contactId = await makeContact(t, {
      avatarUrl: PICTURE,
      avatarStatus: "ready",
    });

    await t.mutation(api.contacts.reportAvatarBroken, { contactId });
    const firstCheckedAt = (await readContact(t, contactId))?.avatarCheckedAt;
    expect(firstCheckedAt).toBeGreaterThan(0);

    // A list re-render reports the same broken picture again straight away.
    await t.mutation(api.contacts.reportAvatarBroken, { contactId });
    expect((await readContact(t, contactId))?.avatarCheckedAt).toBe(firstCheckedAt);
  });

  test("the sweep only schedules contacts that are actually due", async () => {
    const t = convexTest(schema, modules);
    const fresh = await makeContact(t, {
      remoteJid: "233200000010@s.whatsapp.net",
      avatarUrl: PICTURE,
      avatarStatus: "ready",
      avatarCheckedAt: Date.now(),
    });
    await makeContact(t, { remoteJid: "233200000011@s.whatsapp.net" });

    const result = await t.mutation(internal.contacts.sweepAvatarsInternal, {});

    // Only the never-checked contact is due; the one checked just now is not.
    expect(result.scheduled).toBe(1);
    expect((await readContact(t, fresh))?.avatarUrl).toBe(PICTURE);
  });

  test("the chat list serves the cached picture with no extra reads", async () => {
    const t = convexTest(schema, modules);
    const contactId = await makeContact(t, {
      avatarUrl: PICTURE,
      avatarStatus: "ready",
    });
    await t.mutation(internal.contacts.backfillChatState, {});

    const rows = await t.query(api.contacts.listChats, { instance: INSTANCE });
    expect(rows[0].contact.avatarUrl).toBe(PICTURE);
    expect(rows[0].contact._id).toBe(contactId);
  });
});
