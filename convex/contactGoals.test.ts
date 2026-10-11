// Integration tests for the contact-goal engine. The model call and the
// WhatsApp send are mocked at their module boundaries (providers/aiSdk and
// providers/evolution), which is exactly why the engine keeps them there.
//
// Priority of what these lock in, most important first:
//  1. an inbound message never produces two outbound messages
//  2. the turn claim is exclusive, and a stale lease cannot write
//  3. the stall cap terminates an unanswered open-ended goal
//  4. a blocked auto-send always falls back to a draft, never a silent skip
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import schema from './schema';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { GOAL_MAX_TURNS } from './goalRules';

const modules = import.meta.glob('./**/*.ts');

const runJsonExtraction = vi.hoisted(() => vi.fn());
const sendText = vi.hoisted(() => vi.fn());
const generateReply = vi.hoisted(() => vi.fn());
const generateText = vi.hoisted(() => vi.fn());

vi.mock('./providers/aiSdk', () => ({ runJsonExtraction }));
vi.mock('./providers/evolution', () => ({
  sendText,
  fetchMediaBase64: vi.fn(),
  fetchGroupInfo: vi.fn(),
}));
vi.mock('./providers/processing', () => ({ generateReply, generateText }));

const INSTANCE = 'test-instance';
const REMOTE_JID = '233200000000@s.whatsapp.net';

/** What the model returns for the message-writing call. */
function modelSays(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    text: 'Are you free Thursday or Friday?',
    completed: false,
    confidence: 0.8,
    reasoning: 'asking availability',
    ...overrides,
  });
}

/** What the model returns for the assessment call that runs before it. */
function assessmentSays(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    completed: false,
    confidence: 0.9,
    goalRelevant: true,
    shouldRaise: true,
    reasoning: 'still working the goal',
    ...overrides,
  });
}

/**
 * An open-ended turn makes two calls through the same provider — assess, then
 * write — so the mock routes on the schema rather than answering both the same
 * way. Without this a test that stubs `completed: true` to exercise the writer
 * would also be telling the assessor the goal is already finished.
 */
function mockTurn(turn: Record<string, unknown> = {}, assessment: Record<string, unknown> = {}) {
  runJsonExtraction.mockImplementation(
    async (args: { schema?: { properties?: Record<string, unknown> } }) =>
      args?.schema?.properties?.goalRelevant !== undefined
        ? assessmentSays(assessment)
        : modelSays(turn),
  );
}

type Ctx = ReturnType<typeof convexTest>;

// convex-test drains scheduled functions through the timer API, so these tests
// need fake timers. Without them finishAllScheduledFunctions throws, the work
// it should have drained leaks into whichever test runs next, and that test's
// mock call counts silently include another test's sends.
let active: Ctx | null = null;

function setup(): Ctx {
  active = convexTest(schema, modules);
  return active;
}

/** Let every scheduled function settle, so nothing crosses a test boundary. */
async function drain(t: Ctx): Promise<void> {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

beforeEach(() => {
  vi.useFakeTimers();
  runJsonExtraction.mockReset();
  mockTurn();
  sendText.mockReset().mockResolvedValue({ messageId: 'wamid.stub', raw: {} });
  generateReply.mockReset().mockResolvedValue('generic pipeline reply');
  generateText.mockReset().mockResolvedValue('summary');
});

afterEach(async () => {
  // Drain before clearing mocks: follow-on work (memory extraction, follow-up
  // detection) hits the same mocked providers.
  if (active) {
    await active.finishAllScheduledFunctions(vi.runAllTimers);
    active = null;
  }
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function seedContact(t: Ctx, patch: Partial<Doc<'contacts'>> = {}): Promise<Id<'contacts'>> {
  return await t.run(async (ctx) =>
    ctx.db.insert('contacts', {
      instance: INSTANCE,
      remoteJid: REMOTE_JID,
      displayName: 'Ama',
      ...patch,
    }),
  );
}

async function seedInbound(
  t: Ctx,
  contactId: Id<'contacts'>,
  patch: Partial<Doc<'messages'>> = {},
): Promise<Id<'messages'>> {
  return await t.run(async (ctx) =>
    ctx.db.insert('messages', {
      contactId,
      instance: INSTANCE,
      remoteJid: REMOTE_JID,
      messageId: `wamid.in.${Math.random().toString(36).slice(2)}`,
      fromMe: false,
      messageType: 'conversation',
      text: "hey what's up",
      timestamp: Math.floor(Date.now() / 1000),
      status: 'ready',
      category: 'greeting',
      classificationConfidence: 0.9,
      ...patch,
    }),
  );
}

async function seedGoal(
  t: Ctx,
  contactId: Id<'contacts'>,
  patch: Partial<Doc<'contactGoals'>> = {},
): Promise<Id<'contactGoals'>> {
  const now = Date.now();
  return await t.run(async (ctx) =>
    ctx.db.insert('contactGoals', {
      instance: INSTANCE,
      contactId,
      title: 'Find a time to meet',
      instructions: 'Ask when they are available.',
      kind: 'meeting',
      recurrence: 'until_done',
      mode: 'auto',
      status: 'active',
      unansweredCount: 0,
      nextRunAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
      ...patch,
    }),
  );
}

const getGoal = (t: Ctx, goalId: Id<'contactGoals'>) => t.run(async (ctx) => ctx.db.get(goalId));

const listDrafts = (t: Ctx) => t.run(async (ctx) => ctx.db.query('drafts').collect());

/** Claim a goal the way the cron does, returning the lease token. */
async function claim(t: Ctx, goalId: Id<'contactGoals'>): Promise<string> {
  const result = await t.mutation(internal.contactGoals.claimGoalTurnInternal, {
    goalId,
    nowMs: Date.now(),
  });
  if (result.kind !== 'claimed' || !result.leaseToken) {
    throw new Error(`expected to claim, got ${result.kind}`);
  }
  return result.leaseToken;
}

describe('takeover: no double-messaging', () => {
  test('a busy goal makes decideAndDraft stand down entirely', async () => {
    const t = setup();
    const contactId = await seedContact(t, { aiMode: 'full_auto' });
    // Lease already held by an in-flight turn.
    const goalId = await seedGoal(t, contactId, {
      turnLockUntil: Date.now() + 60_000,
      turnLockToken: 'held-by-cron',
    });
    const messageId = await seedInbound(t, contactId, { text: 'ok' });

    await t.action(internal.replies.decideAndDraft, { messageId });

    // The generic pipeline must not have produced anything: no send, no draft.
    expect(sendText).not.toHaveBeenCalled();
    expect(generateReply).not.toHaveBeenCalled();
    expect(await listDrafts(t)).toHaveLength(0);
    // The goal is untouched and still locked.
    expect((await getGoal(t, goalId))?.turnLockToken).toBe('held-by-cron');
  });

  test('the busy retry is bounded — it never schedules a second', async () => {
    const t = setup();
    const contactId = await seedContact(t, { aiMode: 'full_auto' });
    await seedGoal(t, contactId, {
      turnLockUntil: Date.now() + 60_000,
      turnLockToken: 'held',
    });
    const messageId = await seedInbound(t, contactId, { text: 'ok' });

    // goalRetry: true is the loop guard — still busy, so give up quietly.
    await t.action(internal.replies.decideAndDraft, { messageId, goalRetry: true });

    expect(sendText).not.toHaveBeenCalled();
    expect(await listDrafts(t)).toHaveLength(0);
    // Nothing further queued: draining the scheduler is a no-op.
    await drain(t);
    expect(sendText).not.toHaveBeenCalled();
  });

  test('an inbound message with an active goal never runs the generic pipeline', async () => {
    const t = setup();
    // full_auto + "ok" is exactly what decideReplyMode would auto-send as an
    // acknowledgment, so this proves the goal really preempts it.
    const contactId = await seedContact(t, { aiMode: 'full_auto' });
    const goalId = await seedGoal(t, contactId);
    const messageId = await seedInbound(t, contactId, { text: 'ok' });

    await t.action(internal.replies.decideAndDraft, { messageId });
    await drain(t);

    expect(generateReply).not.toHaveBeenCalled();
    // Exactly one outbound message, from the goal.
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0][0]).toMatchObject({
      instance: INSTANCE,
      to: REMOTE_JID,
      text: 'Are you free Thursday or Friday?',
    });
    // Quoted against the message that triggered the turn.
    expect(sendText.mock.calls[0][0].quoted).toBeDefined();
    expect((await getGoal(t, goalId))?.lastGoalMessageId).toBeTruthy();
  });

  test('with no goal, the generic pipeline is untouched', async () => {
    const t = setup();
    const contactId = await seedContact(t, { aiMode: 'full_auto' });
    const messageId = await seedInbound(t, contactId, { text: 'ok' });

    await t.action(internal.replies.decideAndDraft, { messageId });

    // The generic pipeline generated the reply, not the goal engine. (Asserting
    // on runJsonExtraction would be ambiguous here — the memory-extraction step
    // scheduled off recordOutgoing calls it too.)
    expect(generateReply).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0][0].text).toBe('generic pipeline reply');
  });
});

describe('claiming', () => {
  test('a claim is exclusive', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId);

    const first = await t.mutation(internal.contactGoals.onInboundForContactInternal, {
      contactId,
      nowMs: Date.now(),
    });
    expect(first.kind).toBe('claimed');

    const second = await t.mutation(internal.contactGoals.onInboundForContactInternal, {
      contactId,
      nowMs: Date.now(),
    });
    expect(second.kind).toBe('busy');
    expect(second.retryAfterMs).toBeGreaterThan(0);

    // The cron's by-id claim is blocked by the same lease.
    const viaCron = await t.mutation(internal.contactGoals.claimGoalTurnInternal, {
      goalId,
      nowMs: Date.now(),
    });
    expect(viaCron.kind).toBe('busy');
  });

  test('an expired lease can be re-claimed', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId, {
      turnLockUntil: Date.now() - 1,
      turnLockToken: 'stale',
    });
    const result = await t.mutation(internal.contactGoals.claimGoalTurnInternal, {
      goalId,
      nowMs: Date.now(),
    });
    expect(result.kind).toBe('claimed');
    expect(result.leaseToken).not.toBe('stale');
  });

  test('contacts with no open-ended goal report none', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    await seedGoal(t, contactId, { recurrence: 'daily', preferredTime: '09:00' });
    const result = await t.mutation(internal.contactGoals.onInboundForContactInternal, {
      contactId,
      nowMs: Date.now(),
    });
    expect(result.kind).toBe('none');
  });

  test('a stale lease token cannot write', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId, { nextRunAt: 111 });
    // Someone else owns the goal now.
    await claim(t, goalId);

    const result = await t.mutation(internal.contactGoals.recordGoalTurnInternal, {
      goalId,
      leaseToken: 'stale-token',
      outcome: 'sent',
      countAsAttempt: true,
      completed: false,
    });
    expect(result.applied).toBe(false);
    const goal = await getGoal(t, goalId);
    expect(goal?.nextRunAt).toBe(111);
    expect(goal?.unansweredCount).toBe(0);
  });

  test('a turn cannot resurrect a goal the user paused mid-flight', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId);
    const leaseToken = await claim(t, goalId);
    await t.mutation(api.contactGoals.updateStatus, { goalId, status: 'paused' });

    const result = await t.mutation(internal.contactGoals.recordGoalTurnInternal, {
      goalId,
      leaseToken,
      outcome: 'sent',
      countAsAttempt: true,
      completed: false,
    });
    expect(result.applied).toBe(false);
    expect((await getGoal(t, goalId))?.status).toBe('paused');
  });

  test('recording releases the lease', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId);
    const leaseToken = await claim(t, goalId);
    await t.mutation(internal.contactGoals.recordGoalTurnInternal, {
      goalId,
      leaseToken,
      outcome: 'drafted',
      countAsAttempt: true,
      completed: false,
    });
    const goal = await getGoal(t, goalId);
    expect(goal?.turnLockToken).toBeUndefined();
    expect(goal?.turnLockUntil).toBeUndefined();
  });
});

describe('stall cap', () => {
  test('pauses after five unanswered attempts and leaves the cron', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId);

    for (let i = 0; i < 5; i++) {
      await t.run(async (ctx) => ctx.db.patch(goalId, { nextRunAt: Date.now() - 1000 }));
      await t.action(internal.contactGoals.runDueGoalsInternal, {});
      await drain(t);
    }

    const goal = await getGoal(t, goalId);
    expect(goal?.unansweredCount).toBe(5);
    expect(goal?.status).toBe('paused');
    expect(goal?.pausedReason).toBe('stall_cap');

    // A paused goal is out of the due index, so the cron stops seeing it.
    const due = await t.query(internal.contactGoals.listDueGoalsInternal, {
      nowMs: Date.now() + 10_000_000,
    });
    expect(due.map((g) => g._id)).not.toContain(goalId);

    // ...and it sent exactly five messages, not six.
    expect(sendText).toHaveBeenCalledTimes(5);
  });

  test('resume clears the stall state so it does not immediately re-pause', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId, {
      status: 'paused',
      pausedReason: 'stall_cap',
      unansweredCount: 5,
    });

    await t.mutation(api.contactGoals.updateStatus, { goalId, status: 'active' });

    const goal = await getGoal(t, goalId);
    expect(goal?.status).toBe('active');
    expect(goal?.unansweredCount).toBe(0);
    expect(goal?.pausedReason).toBeUndefined();
    // Armed for a future nudge rather than firing instantly at someone who has
    // already ignored five messages.
    expect(goal?.nextRunAt).toBeGreaterThan(Date.now());
  });

  test('resume clears a lease left behind by a turn paused mid-flight', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId);
    await claim(t, goalId);
    await t.mutation(api.contactGoals.updateStatus, { goalId, status: 'paused' });
    await t.mutation(api.contactGoals.updateStatus, { goalId, status: 'active' });

    expect((await getGoal(t, goalId))?.turnLockToken).toBeUndefined();
    // ...so the very next turn can actually be claimed.
    await expect(claim(t, goalId)).resolves.toBeTruthy();
  });

  test('an inbound message does not reset counters before strategy confirms goal engagement', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const openEnded = await seedGoal(t, contactId, { unansweredCount: 3 });
    // A clock-scheduled goal must be reset too, not just the open-ended one.
    const daily = await seedGoal(t, contactId, {
      recurrence: 'daily',
      preferredTime: '09:00',
      unansweredCount: 2,
    });

    await t.mutation(internal.contactGoals.onInboundForContactInternal, {
      contactId,
      nowMs: Date.now(),
    });

    expect((await getGoal(t, openEnded))?.unansweredCount).toBe(3);
    expect((await getGoal(t, daily))?.unansweredCount).toBe(2);
    expect((await getGoal(t, openEnded))?.lastContactReplyAt).toBeUndefined();
  });

  test('a draft-mode goal is capped too, so ignored drafts cannot loop forever', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId, { mode: 'draft' });

    for (let i = 0; i < 5; i++) {
      await t.run(async (ctx) => ctx.db.patch(goalId, { nextRunAt: Date.now() - 1000 }));
      await t.action(internal.contactGoals.runDueGoalsInternal, {});
      await drain(t);
    }

    expect(sendText).not.toHaveBeenCalled();
    expect((await getGoal(t, goalId))?.status).toBe('paused');
    // Regenerated in place — one draft, not a stack of five.
    expect(await listDrafts(t)).toHaveLength(1);
  });

  test('a relationship goal stops after two unanswered attempts', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId, { kind: 'relationship' });

    for (let i = 0; i < 2; i++) {
      await t.run(async (ctx) => ctx.db.patch(goalId, { nextRunAt: Date.now() - 1000 }));
      await t.action(internal.contactGoals.runDueGoalsInternal, {});
      await drain(t);
    }

    const goal = await getGoal(t, goalId);
    expect(goal?.status).toBe('paused');
    expect(goal?.pausedReason).toBe('low_reciprocity');
    expect(sendText).toHaveBeenCalledTimes(2);
  });
});

describe('lifetime budget', () => {
  test('a talkative contact cannot keep a goal alive forever', async () => {
    // The bug this closes: unansweredCount resets to 0 on every inbound, so a
    // contact who actually replies holds the stall cap at zero and the goal
    // re-raises itself in every single reply, indefinitely.
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId);

    for (let i = 0; i < GOAL_MAX_TURNS + 1; i++) {
      // The contact answers every time — this is what used to be unbounded.
      // The inbound hook resets the stall counter and claims the turn in one
      // go, exactly as decideAndDraft drives it.
      const inbound = await t.mutation(internal.contactGoals.onInboundForContactInternal, {
        contactId,
        nowMs: Date.now(),
      });
      if (inbound.kind !== 'claimed' || !inbound.leaseToken) break;
      const messageId = await seedInbound(t, contactId, {
        text: 'yes, tell me more',
      });
      await t.action(internal.contactGoals.runGoalTurnInternal, {
        goalId,
        leaseToken: inbound.leaseToken,
        triggerMessageId: messageId,
      });
      await drain(t);
    }

    const goal = await getGoal(t, goalId);
    expect(goal?.status).toBe('paused');
    expect(goal?.pausedReason).toBe('turn_budget');
    // The stall cap never fired — it could not have.
    expect(goal?.unansweredCount).toBeLessThan(5);
    // It stopped at the budget rather than sending a ninth.
    expect(sendText).toHaveBeenCalledTimes(GOAL_MAX_TURNS);
  });

  test('a goal past its deadline stops without sending', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId, {
      expiresAt: Date.now() - 1000,
    });

    const leaseToken = await claim(t, goalId);
    const result = await t.action(internal.contactGoals.runGoalTurnInternal, {
      goalId,
      leaseToken,
    });

    expect(result.outcome).toBe('exhausted');
    expect(sendText).not.toHaveBeenCalled();
    const goal = await getGoal(t, goalId);
    expect(goal?.status).toBe('paused');
    expect(goal?.pausedReason).toBe('expired');
  });

  test('resume gives the goal a fresh budget', async () => {
    // Otherwise Resume on a budget-paused goal re-pauses on its next turn and
    // the button looks broken — the same trap the stall counter already had.
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId, {
      status: 'paused',
      pausedReason: 'turn_budget',
      turnsUsed: GOAL_MAX_TURNS,
      expiresAt: Date.now() - 1000,
    });

    await t.mutation(api.contactGoals.updateStatus, { goalId, status: 'active' });

    const goal = await getGoal(t, goalId);
    expect(goal?.turnsUsed).toBe(0);
    expect(goal?.expiresAt).toBeGreaterThan(Date.now());
  });

  test('a clock-scheduled goal has no budget to spend', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId, {
      recurrence: 'daily',
      preferredTime: '09:00',
      turnsUsed: 99,
    });

    const leaseToken = await claim(t, goalId);
    await t.action(internal.contactGoals.runGoalTurnInternal, { goalId, leaseToken });

    expect(sendText).toHaveBeenCalledTimes(1);
    expect((await getGoal(t, goalId))?.status).toBe('active');
  });
});

describe('assessment', () => {
  test('an off-topic message is handed back to the normal pipeline', async () => {
    const t = setup();
    const contactId = await seedContact(t, { aiMode: 'full_auto' });
    const goalId = await seedGoal(t, contactId);
    mockTurn({}, { goalRelevant: false, shouldRaise: false });
    const messageId = await seedInbound(t, contactId, { text: 'ok' });

    await t.action(internal.replies.decideAndDraft, { messageId });
    await drain(t);

    // The generic pipeline answered, and the goal did not write anything.
    expect(generateReply).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0][0].text).toBe('generic pipeline reply');
    const goal = await getGoal(t, goalId);
    // Handing back costs the goal nothing — no message, no budget, no lease.
    expect(goal?.turnsUsed).toBe(0);
    expect(goal?.status).toBe('active');
    expect(goal?.turnLockToken).toBeUndefined();
  });

  test('a scheduled turn can wait when there is no natural opening', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId);
    mockTurn({}, { goalRelevant: false, shouldRaise: false });

    const leaseToken = await claim(t, goalId);
    await t.action(internal.contactGoals.runGoalTurnInternal, { goalId, leaseToken });

    expect(sendText).not.toHaveBeenCalled();
    expect((await getGoal(t, goalId))?.turnsUsed).toBe(0);
    expect((await getGoal(t, goalId))?.lastStrategyAction).toBe('wait');
  });

  test('a goal the conversation already met closes, and the contact still gets a reply', async () => {
    const t = setup();
    const contactId = await seedContact(t, { aiMode: 'full_auto' });
    const goalId = await seedGoal(t, contactId);
    mockTurn({}, { completed: true, confidence: 0.9 });
    const messageId = await seedInbound(t, contactId, { text: 'ok' });

    await t.action(internal.replies.decideAndDraft, { messageId });
    await drain(t);

    const goal = await getGoal(t, goalId);
    expect(goal?.status).toBe('done');
    expect(goal?.completedAt).toBeGreaterThan(0);
    // Closing the goal must not swallow the contact's message.
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0][0].text).toBe('generic pipeline reply');
  });

  test('a relationship goal pauses on a clear rejection and hands the reply back', async () => {
    const t = setup();
    const contactId = await seedContact(t, { aiMode: 'semi_auto' });
    const goalId = await seedGoal(t, contactId, { kind: 'relationship' });
    mockTurn(
      {},
      {
        action: 'pause',
        goalRelevant: true,
        shouldRaise: false,
        pauseReason: 'declined',
        reasoning: 'they clearly said no',
      },
    );
    const messageId = await seedInbound(t, contactId, {
      text: 'I am not interested, sorry',
    });

    await t.action(internal.replies.decideAndDraft, { messageId });
    await drain(t);

    const goal = await getGoal(t, goalId);
    expect(goal?.status).toBe('paused');
    expect(goal?.pausedReason).toBe('declined');
    expect(sendText).not.toHaveBeenCalled();
    expect(generateReply).toHaveBeenCalledTimes(1);
    expect((await listDrafts(t))[0]?.text).toBe('generic pipeline reply');
  });

  test('a low-confidence completion assessment does not close the goal', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId);
    mockTurn({}, { completed: true, confidence: 0.3 });

    const leaseToken = await claim(t, goalId);
    await t.action(internal.contactGoals.runGoalTurnInternal, { goalId, leaseToken });

    expect((await getGoal(t, goalId))?.status).toBe('active');
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  test('a failed scheduled assessment waits instead of sending blind', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId);
    runJsonExtraction.mockImplementation(
      async (args: { schema?: { properties?: Record<string, unknown> } }) => {
        if (args?.schema?.properties?.goalRelevant !== undefined) {
          throw new Error('assessor down');
        }
        return modelSays();
      },
    );

    const leaseToken = await claim(t, goalId);
    await t.action(internal.contactGoals.runGoalTurnInternal, { goalId, leaseToken });

    expect(sendText).not.toHaveBeenCalled();
    expect((await getGoal(t, goalId))?.status).toBe('active');
    expect((await getGoal(t, goalId))?.lastStrategyAction).toBe('wait');
  });
});

describe('auto-send gates fall back to a draft, never a silent skip', () => {
  const expectHeldAsDraft = async (t: Ctx, gate: string) => {
    const drafts = await listDrafts(t);
    expect(sendText).not.toHaveBeenCalled();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].style).toBe(`contact_goal:${gate}`);
    expect(drafts[0].goalId).toBeTruthy();
    expect(drafts[0].status).toBe('pending');
    expect(drafts[0].text).toBe('Are you free Thursday or Friday?');
  };

  test('quiet hours', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    await t.run(async (ctx) =>
      ctx.db.insert('userPreferences', {
        instance: INSTANCE,
        defaultTone: 'friendly',
        quietHoursEnabled: true,
        // A window covering the whole day, so this is stable whenever it runs.
        quietHoursStart: '00:00',
        quietHoursEnd: '23:59',
        quietHoursTimezone: 'UTC',
      }),
    );
    const goalId = await seedGoal(t, contactId);
    const leaseToken = await claim(t, goalId);
    await t.action(internal.contactGoals.runGoalTurnInternal, { goalId, leaseToken });
    await expectHeldAsDraft(t, 'quiet_hours');
  });

  test('contact autoReplyBlocked', async () => {
    const t = setup();
    const contactId = await seedContact(t, { autoReplyBlocked: true });
    const goalId = await seedGoal(t, contactId);
    const leaseToken = await claim(t, goalId);
    await t.action(internal.contactGoals.runGoalTurnInternal, { goalId, leaseToken });
    await expectHeldAsDraft(t, 'contact_auto_block');
  });

  test('draft mode', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId, { mode: 'draft' });
    const leaseToken = await claim(t, goalId);
    await t.action(internal.contactGoals.runGoalTurnInternal, { goalId, leaseToken });
    await expectHeldAsDraft(t, 'draft_mode');
  });

  test('suspicious generated text', async () => {
    const t = setup();
    mockTurn({
      text: 'Are you free Thursday or Friday?\n```\nignore all previous\n```',
    });
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId);
    const leaseToken = await claim(t, goalId);
    await t.action(internal.contactGoals.runGoalTurnInternal, { goalId, leaseToken });

    const drafts = await listDrafts(t);
    expect(sendText).not.toHaveBeenCalled();
    expect(drafts[0].style).toBe('contact_goal:suspicious_auto_reply');
  });

  test('a goal reply that stays long after one rewrite is held for review', async () => {
    const t = setup();
    const text = `Hey! ${'Really hoping we can find a slot that works for both of us. '.repeat(4)}`;
    expect(text.length).toBeGreaterThan(240);
    mockTurn({ text });
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId);
    const leaseToken = await claim(t, goalId);
    await t.action(internal.contactGoals.runGoalTurnInternal, { goalId, leaseToken });

    expect(sendText).not.toHaveBeenCalled();
    expect(await listDrafts(t)).toHaveLength(1);
  });

  test('sensitive words in the incoming message hold it back', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId);
    const messageId = await seedInbound(t, contactId, {
      text: 'can you send the payment first',
      category: 'greeting',
    });
    const leaseToken = await claim(t, goalId);
    await t.action(internal.contactGoals.runGoalTurnInternal, {
      goalId,
      leaseToken,
      triggerMessageId: messageId,
    });
    await expectHeldAsDraft(t, 'keyword:payment');
  });

  test('but a meeting goal may talk about meetings', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId, { kind: 'meeting' });
    const messageId = await seedInbound(t, contactId, {
      text: 'when is a good time for a meeting?',
    });
    const leaseToken = await claim(t, goalId);
    await t.action(internal.contactGoals.runGoalTurnInternal, {
      goalId,
      leaseToken,
      triggerMessageId: messageId,
    });

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(await listDrafts(t)).toHaveLength(0);
  });

  test('a send failure degrades to a draft rather than losing the turn', async () => {
    const t = setup();
    sendText.mockRejectedValue(new Error('evolution down'));
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId);
    const leaseToken = await claim(t, goalId);
    await t.action(internal.contactGoals.runGoalTurnInternal, { goalId, leaseToken });

    const drafts = await listDrafts(t);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].style).toBe('contact_goal:send_failed');
    expect((await getGoal(t, goalId))?.turnLockToken).toBeUndefined();
  });
});

describe('draft lifecycle', () => {
  test('the goal regenerates its own draft in place', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId, { mode: 'draft' });

    const first = await claim(t, goalId);
    await t.action(internal.contactGoals.runGoalTurnInternal, {
      goalId,
      leaseToken: first,
    });

    mockTurn({ text: 'Still keen to meet up?' });
    const second = await claim(t, goalId);
    await t.action(internal.contactGoals.runGoalTurnInternal, {
      goalId,
      leaseToken: second,
    });

    const drafts = await listDrafts(t);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].text).toBe('Still keen to meet up?');
  });

  test('an unrelated pending draft defers without spending the goal budget', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId);
    await t.run(async (ctx) =>
      ctx.db.insert('drafts', {
        instance: INSTANCE,
        contactId,
        text: 'unrelated draft awaiting review',
        status: 'pending',
      }),
    );

    const leaseToken = await claim(t, goalId);
    const result = await t.action(internal.contactGoals.runGoalTurnInternal, {
      goalId,
      leaseToken,
    });

    expect(result.outcome).toBe('deferred');
    expect(runJsonExtraction).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
    expect((await getGoal(t, goalId))?.unansweredCount).toBe(0);
  });

  test('approving a goal draft credits the goal', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId, { mode: 'draft' });
    const leaseToken = await claim(t, goalId);
    await t.action(internal.contactGoals.runGoalTurnInternal, { goalId, leaseToken });

    const [draft] = await listDrafts(t);
    expect((await getGoal(t, goalId))?.lastGoalMessageAt).toBeUndefined();

    await t.action(api.drafts.send, { draftId: draft._id });

    const goal = await getGoal(t, goalId);
    expect(goal?.lastGoalMessageAt).toBeGreaterThan(0);
    expect(goal?.lastGoalMessageId).toBeTruthy();
  });
});

describe('completion', () => {
  test('a completing turn still delivers its closing message', async () => {
    // Regression: the old runner returned on completed before emitting text, so
    // the message that actually closes the goal was thrown away.
    const t = setup();
    mockTurn({ text: 'Great, Thursday 3pm works, see you then', completed: true, confidence: 0.9 });
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId);
    const leaseToken = await claim(t, goalId);
    await t.action(internal.contactGoals.runGoalTurnInternal, { goalId, leaseToken });

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0][0].text).toBe('Great, Thursday 3pm works, see you then');
    const goal = await getGoal(t, goalId);
    expect(goal?.status).toBe('done');
    expect(goal?.completedAt).toBeGreaterThan(0);
  });

  test('a low-confidence completion is ignored', async () => {
    const t = setup();
    mockTurn({ text: 'maybe Thursday?', completed: true, confidence: 0.3 });
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId);
    const leaseToken = await claim(t, goalId);
    await t.action(internal.contactGoals.runGoalTurnInternal, { goalId, leaseToken });

    expect((await getGoal(t, goalId))?.status).toBe('active');
  });

  test('a `once` goal completes after one run', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId, {
      recurrence: 'once',
      mode: 'draft',
    });
    const leaseToken = await claim(t, goalId);
    await t.action(internal.contactGoals.runGoalTurnInternal, { goalId, leaseToken });
    expect((await getGoal(t, goalId))?.status).toBe('done');
  });

  test('a `once` goal whose model call failed is not retired unsent', async () => {
    // "Done after one run" has to mean it actually produced something. Marking
    // it done on a failure retired the goal without ever sending the one
    // message it existed for.
    const t = setup();
    runJsonExtraction.mockRejectedValue(new Error('model down'));
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId, {
      recurrence: 'once',
      mode: 'draft',
    });

    const leaseToken = await claim(t, goalId);
    await t.action(internal.contactGoals.runGoalTurnInternal, { goalId, leaseToken });

    const goal = await getGoal(t, goalId);
    expect(goal?.status).toBe('active');
    expect(goal?.completedAt).toBeUndefined();
  });

  test('empty text neither sends nor drafts, but still counts', async () => {
    const t = setup();
    mockTurn({ text: '' });
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId);
    const leaseToken = await claim(t, goalId);
    const result = await t.action(internal.contactGoals.runGoalTurnInternal, {
      goalId,
      leaseToken,
    });

    expect(result.outcome).toBe('empty');
    expect(sendText).not.toHaveBeenCalled();
    expect(await listDrafts(t)).toHaveLength(0);
    expect((await getGoal(t, goalId))?.unansweredCount).toBe(1);
  });

  test('a generation failure releases the lease without counting', async () => {
    const t = setup();
    runJsonExtraction.mockImplementation(
      async (args: { schema?: { properties?: Record<string, unknown> } }) => {
        if (args?.schema?.properties?.goalRelevant !== undefined) {
          return assessmentSays({ action: 'start_goal', goalRelevant: false });
        }
        throw new Error('model down');
      },
    );
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId);
    const leaseToken = await claim(t, goalId);
    const result = await t.action(internal.contactGoals.runGoalTurnInternal, {
      goalId,
      leaseToken,
    });

    expect(result.outcome).toBe('failed');
    const goal = await getGoal(t, goalId);
    expect(goal?.unansweredCount).toBe(0);
    expect(goal?.turnLockToken).toBeUndefined();
    expect(goal?.status).toBe('active');
  });
});

describe('enhanceDraft', () => {
  /** The enhancer answers on its own schema, distinct from turn and assessment. */
  function mockEnhancer(fields: Record<string, unknown>) {
    runJsonExtraction.mockImplementation(
      async (args: { schema?: { properties?: Record<string, unknown> } }) =>
        args?.schema?.properties?.successCriteria !== undefined
          ? JSON.stringify(fields)
          : modelSays(),
    );
  }

  test('it returns rewritten fields without saving anything', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    mockEnhancer({
      title: 'Chase the invoice',
      instructions: 'Ask him for the outstanding invoice and agree a day if he stalls.',
      successCriteria: 'He sends it or names the day he will.',
    });

    const result = await t.action(api.contactGoals.enhanceDraft, {
      contactId,
      kind: 'custom',
      instructions: 'get him to send the invoice',
    });

    expect(result.title).toBe('Chase the invoice');
    expect(result.successCriteria).toBe('He sends it or names the day he will.');
    // Enhancing is a suggestion the user still has to accept — nothing is
    // created until they save.
    const goals = await t.run(async (ctx) => ctx.db.query('contactGoals').collect());
    expect(goals).toHaveLength(0);
  });

  test('an empty instruction is refused before any model call', async () => {
    const t = setup();
    const contactId = await seedContact(t);

    await expect(
      t.action(api.contactGoals.enhanceDraft, {
        contactId,
        kind: 'custom',
        instructions: '   ',
      }),
    ).rejects.toThrow(/Write the instruction first/);
    expect(runJsonExtraction).not.toHaveBeenCalled();
  });

  test('a useless model answer gives the user their own words back', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    mockEnhancer({});

    const result = await t.action(api.contactGoals.enhanceDraft, {
      contactId,
      kind: 'custom',
      instructions: 'get him to send the invoice',
      title: 'invoice',
      successCriteria: '',
    });

    expect(result).toEqual({
      title: 'invoice',
      instructions: 'get him to send the invoice',
      successCriteria: '',
    });
  });

  test("the contact's saved profile is given to the enhancer", async () => {
    // Without it the rewrite is generic advice about goals rather than
    // something specific to this conversation.
    const t = setup();
    const contactId = await seedContact(t);
    await t.run(async (ctx) =>
      ctx.db.insert('contactMemoryProfiles', {
        instance: INSTANCE,
        contactId,
        summary: 'Runs the print shop on Oxford Street.',
        preferences: ['prefers voice notes'],
        currentTopics: [],
        commitments: [],
        updatedAt: Date.now(),
      }),
    );
    mockEnhancer({ title: 'Chase the invoice' });

    await t.action(api.contactGoals.enhanceDraft, {
      contactId,
      kind: 'custom',
      instructions: 'get him to send the invoice',
    });

    const call = runJsonExtraction.mock.calls.at(-1)?.[0];
    expect(call.messages[0].content).toContain('print shop');
    expect(call.messages[0].content).toContain('prefers voice notes');
  });
});

describe('create', () => {
  test('an open-ended goal opens the conversation immediately', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await t.mutation(api.contactGoals.create, {
      contactId,
      title: 'Find a time to meet',
      instructions: 'Ask when they are available.',
      kind: 'meeting',
      recurrence: 'until_done',
      mode: 'auto',
      successCriteria: 'They agree to a specific day and time.',
    });
    await drain(t);

    expect(sendText).toHaveBeenCalledTimes(1);
    const goal = await getGoal(t, goalId);
    expect(goal?.status).toBe('active');
    expect(goal?.unansweredCount).toBe(1);
    // The silence timer is armed for the next nudge.
    expect(goal?.nextRunAt).toBeGreaterThan(Date.now());
    expect(goal?.turnLockToken).toBeUndefined();
  });

  test('a clock-scheduled goal does not fire on create', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    await t.mutation(api.contactGoals.create, {
      contactId,
      title: 'Morning check-in',
      instructions: 'Say hi.',
      kind: 'check_in',
      recurrence: 'daily',
      preferredTime: '09:00',
      timezone: 'Africa/Accra',
      mode: 'draft',
    });
    await drain(t);

    expect(runJsonExtraction).not.toHaveBeenCalled();
    expect(await listDrafts(t)).toHaveLength(0);
  });

  test('mode defaults to draft and updateMode does not disturb scheduling', async () => {
    const t = setup();
    const contactId = await seedContact(t);
    const goalId = await seedGoal(t, contactId, { mode: 'draft', nextRunAt: 12345 });

    await t.mutation(api.contactGoals.updateMode, { goalId, mode: 'auto' });
    const goal = await getGoal(t, goalId);
    expect(goal?.mode).toBe('auto');
    expect(goal?.nextRunAt).toBe(12345);
  });
});
