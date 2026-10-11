// The multi-select delete mutations.
//
// What these lock in, most important first:
//  1. a stale id in the batch never costs the user the rest of the selection
//  2. the transaction-size cap is enforced, so a huge batch fails fast and
//     clearly instead of failing late inside Convex
//  3. deleting drafts keeps the chat-list badge honest
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { BULK_DELETE_LIMIT } from "./bulkDelete";

const modules = import.meta.glob("./**/*.ts");

vi.mock("./providers/aiSdk", () => ({
  runJsonExtraction: vi.fn(),
  runAssistantTurn: vi.fn(),
  getAssistantModel: vi.fn(),
  streamAssistantTurn: vi.fn(),
}));
vi.mock("./providers/evolution", () => ({
  sendText: vi.fn(),
  fetchMediaBase64: vi.fn(),
  fetchGroupInfo: vi.fn(),
}));

const INSTANCE = "test-instance";
const REMOTE_JID = "233200000000@s.whatsapp.net";

type Ctx = ReturnType<typeof convexTest>;
let active: Ctx | null = null;

function setup(): Ctx {
  active = convexTest(schema, modules);
  return active;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  if (active) {
    await active.finishAllScheduledFunctions(vi.runAllTimers);
    active = null;
  }
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function seedContact(t: Ctx): Promise<Id<"contacts">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("contacts", {
      instance: INSTANCE,
      remoteJid: REMOTE_JID,
      displayName: "Ama",
    }),
  );
}

async function seedTasks(t: Ctx, count: number): Promise<Id<"tasks">[]> {
  return await t.run(async (ctx) => {
    const ids: Id<"tasks">[] = [];
    for (let i = 0; i < count; i++) {
      ids.push(
        await ctx.db.insert("tasks", {
          instance: INSTANCE,
          title: `Task ${i}`,
          status: "open",
          createdBy: "user",
        }),
      );
    }
    return ids;
  });
}

const countTasks = (t: Ctx) =>
  t.run(async (ctx) => (await ctx.db.query("tasks").collect()).length);

describe("removeMany deletes the selection", () => {
  test("it deletes exactly what was passed and leaves the rest", async () => {
    const t = setup();
    const ids = await seedTasks(t, 5);

    const result = await t.mutation(api.tasks.removeMany, {
      taskIds: ids.slice(0, 3),
    });

    expect(result).toEqual({ deleted: 3, missing: 0 });
    expect(await countTasks(t)).toBe(2);
  });

  test("an id that vanished mid-selection does not sink the batch", async () => {
    // Another device deleted one, or a cron swept it, between the user seeing
    // the list and hitting Delete. Throwing here would lose the whole batch
    // over a row that is already in the state the user asked for.
    const t = setup();
    const ids = await seedTasks(t, 3);
    await t.mutation(api.tasks.remove, { taskId: ids[1] });

    const result = await t.mutation(api.tasks.removeMany, { taskIds: ids });

    expect(result).toEqual({ deleted: 2, missing: 1 });
    expect(await countTasks(t)).toBe(0);
  });

  test("an empty selection is rejected rather than silently doing nothing", async () => {
    const t = setup();
    await expect(
      t.mutation(api.tasks.removeMany, { taskIds: [] }),
    ).rejects.toThrow(/Nothing selected/);
  });

  test("a batch past the transaction cap is rejected before any deletion", async () => {
    const t = setup();
    const ids = await seedTasks(t, 4);
    // Pad to just over the cap by repeating real ids — the size check must run
    // before anything is written.
    const oversized = Array.from(
      { length: BULK_DELETE_LIMIT + 1 },
      (_, i) => ids[i % ids.length],
    );

    await expect(
      t.mutation(api.tasks.removeMany, { taskIds: oversized }),
    ).rejects.toThrow(/at most/);
    expect(await countTasks(t)).toBe(4);
  });
});

describe("drafts", () => {
  test("deleting drafts refreshes the chat-list badge", async () => {
    // pendingDraftCount is denormalized onto the contact, so a bulk delete that
    // skipped the refresh would leave the chat list showing drafts that no
    // longer exist.
    const t = setup();
    const contactId = await seedContact(t);
    const draftIds = await t.run(async (ctx) => {
      const ids: Id<"drafts">[] = [];
      for (let i = 0; i < 3; i++) {
        ids.push(
          await ctx.db.insert("drafts", {
            instance: INSTANCE,
            contactId,
            text: `draft ${i}`,
            status: "pending",
          }),
        );
      }
      // Seed the denormalized state the way a real write would.
      await ctx.db.patch(contactId, {
        pendingDraftCount: 3,
        chatStateVersion: 1,
      });
      return ids;
    });

    const result = await t.mutation(api.drafts.removeMany, { draftIds });

    expect(result.deleted).toBe(3);
    const contact = await t.run(async (ctx) => ctx.db.get(contactId));
    expect(contact?.pendingDraftCount).toBe(0);
  });
});

describe("meetings", () => {
  test("a meeting can finally be deleted", async () => {
    // Meetings are extracted automatically, so a misread used to be permanent:
    // declining says something to the contact, and nothing else removed it.
    const t = setup();
    const contactId = await seedContact(t);
    const meetingId = await t.run(async (ctx) => {
      const messageId = await ctx.db.insert("messages", {
        contactId,
        instance: INSTANCE,
        remoteJid: REMOTE_JID,
        messageId: "wamid.meeting",
        fromMe: false,
        messageType: "conversation",
        text: "lets meet thursday",
        status: "ready",
      });
      return await ctx.db.insert("meetings", {
        instance: INSTANCE,
        contactId,
        sourceMessageId: messageId,
        proposedTimes: [{ startAt: Date.now() + 86_400_000 }],
        status: "pending",
      });
    });

    await t.mutation(api.meetings.remove, { meetingId });

    const remaining = await t.run(async (ctx) =>
      ctx.db.query("meetings").collect(),
    );
    expect(remaining).toHaveLength(0);
    // The message it was extracted from is untouched — deleting the card is
    // tidying up, not rewriting history.
    const messages = await t.run(async (ctx) =>
      ctx.db.query("messages").collect(),
    );
    expect(messages).toHaveLength(1);
  });
});

describe("memories", () => {
  test("every bulk deletion is still audited individually", async () => {
    const t = setup();
    const memoryIds = await t.run(async (ctx) => {
      const ids: Id<"memories">[] = [];
      for (let i = 0; i < 3; i++) {
        ids.push(
          await ctx.db.insert("memories", {
            instance: INSTANCE,
            scope: "user",
            type: "fact",
            content: `fact ${i}`,
            confidence: 0.9,
            status: "active",
            pinned: false,
            createdBy: "user",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }),
        );
      }
      return ids;
    });

    await t.mutation(api.memories.removeMany, { memoryIds });

    const audit = await t.run(async (ctx) =>
      ctx.db.query("memoryAudit").collect(),
    );
    const deletions = audit.filter((a) => a.action === "delete");
    expect(deletions).toHaveLength(3);
  });
});
