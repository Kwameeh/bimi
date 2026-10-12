/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import schema from './schema';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { extractReactions } from './http';

const modules = import.meta.glob('./**/*.ts');

const INSTANCE = 'test-instance';

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
});

describe('WhatsApp Reaction Engine', () => {
  describe('extractReactions helper', () => {
    it('extracts reaction from messages.upsert reactionMessage', () => {
      const payload = {
        event: 'messages.upsert',
        instance: INSTANCE,
        data: {
          key: {
            remoteJid: '2331234567@s.whatsapp.net',
            fromMe: false,
            id: 'REACTION_MSG_ID_1',
            participant: undefined,
          },
          pushName: 'Alice',
          messageType: 'reactionMessage',
          message: {
            reactionMessage: {
              key: {
                remoteJid: '2331234567@s.whatsapp.net',
                fromMe: true,
                id: 'TARGET_MSG_123',
              },
              text: '👍',
              senderTimestampMs: 1728000000000,
            },
          },
          messageTimestamp: 1728000000,
        },
      };

      const extracted = extractReactions(payload);
      expect(extracted).toHaveLength(1);
      expect(extracted[0]).toMatchObject({
        instance: INSTANCE,
        targetMessageId: 'TARGET_MSG_123',
        emoji: '👍',
        fromMe: false,
        pushName: 'Alice',
      });
    });

    it('extracts reaction from messages.reaction event', () => {
      const payload = {
        event: 'messages.reaction',
        instance: INSTANCE,
        data: [
          {
            key: {
              remoteJid: 'group123@g.us',
              id: 'TARGET_MSG_456',
            },
            reaction: {
              text: '❤️',
              key: {
                id: 'TARGET_MSG_456',
                remoteJid: 'group123@g.us',
                fromMe: false,
              },
              senderTimestampMs: 1728000000000,
            },
            fromMe: false,
            participant: 'user456@s.whatsapp.net',
            pushName: 'Bob',
          },
        ],
      };

      const extracted = extractReactions(payload);
      expect(extracted).toHaveLength(1);
      expect(extracted[0]).toMatchObject({
        instance: INSTANCE,
        targetMessageId: 'TARGET_MSG_456',
        emoji: '❤️',
        fromMe: false,
        participant: 'user456@s.whatsapp.net',
        pushName: 'Bob',
      });
    });

    it('handles removal of reaction (empty string emoji)', () => {
      const payload = {
        event: 'messages.upsert',
        instance: INSTANCE,
        data: {
          key: {
            remoteJid: '2331234567@s.whatsapp.net',
            fromMe: false,
            id: 'REACTION_MSG_ID_2',
          },
          pushName: 'Alice',
          messageType: 'reactionMessage',
          message: {
            reactionMessage: {
              key: {
                remoteJid: '2331234567@s.whatsapp.net',
                fromMe: true,
                id: 'TARGET_MSG_123',
              },
              text: '',
            },
          },
        },
      };

      const extracted = extractReactions(payload);
      expect(extracted).toHaveLength(1);
      expect(extracted[0].emoji).toBe('');
      expect(extracted[0].targetMessageId).toBe('TARGET_MSG_123');
    });
  });

  describe('applyReaction mutation', () => {
    it('applies, updates, and removes reactions on messages', async () => {
      const t = setup();

      // Ingest a message
      const ingestResult = await t.mutation(internal.messages.ingestMessage, {
        instance: INSTANCE,
        remoteJid: 'contact1@s.whatsapp.net',
        messageId: 'MSG_TEST_001',
        fromMe: false,
        messageType: 'conversation',
        text: 'Hello, can you review this document?',
        status: 'ready',
        pushName: 'Charlie',
      });

      expect(ingestResult.messageId).not.toBeNull();

      // Charlie reacts with 👍
      const reaction1 = await t.mutation(internal.messages.applyReaction, {
        instance: INSTANCE,
        targetMessageId: 'MSG_TEST_001',
        emoji: '👍',
        fromMe: false,
        pushName: 'Charlie',
      });

      expect(reaction1.success).toBe(true);
      expect(reaction1.count).toBe(1);

      // Check message reactions
      const msgAfterRx1 = await t.query(internal.messages.getMessageForProcessing, {
        messageId: ingestResult.messageId as Id<'messages'>,
      });
      expect(msgAfterRx1?.reactions).toHaveLength(1);
      expect(msgAfterRx1?.reactions?.[0].emoji).toBe('👍');
      expect(msgAfterRx1?.reactions?.[0].fromMe).toBe(false);

      // Current user reacts with ❤️
      const reaction2 = await t.mutation(internal.messages.applyReaction, {
        instance: INSTANCE,
        targetMessageId: 'MSG_TEST_001',
        emoji: '❤️',
        fromMe: true,
      });

      expect(reaction2.success).toBe(true);
      expect(reaction2.count).toBe(2);

      const msgAfterRx2 = await t.query(internal.messages.getMessageForProcessing, {
        messageId: ingestResult.messageId as Id<'messages'>,
      });
      expect(msgAfterRx2?.reactions).toHaveLength(2);

      // Charlie changes reaction from 👍 to 🎉
      const reaction3 = await t.mutation(internal.messages.applyReaction, {
        instance: INSTANCE,
        targetMessageId: 'MSG_TEST_001',
        emoji: '🎉',
        fromMe: false,
        pushName: 'Charlie',
      });

      expect(reaction3.count).toBe(2);
      const msgAfterRx3 = await t.query(internal.messages.getMessageForProcessing, {
        messageId: ingestResult.messageId as Id<'messages'>,
      });
      expect(msgAfterRx3?.reactions?.find((r) => !r.fromMe)?.emoji).toBe('🎉');

      // Current user removes their reaction
      const reaction4 = await t.mutation(internal.messages.applyReaction, {
        instance: INSTANCE,
        targetMessageId: 'MSG_TEST_001',
        emoji: '',
        fromMe: true,
      });

      expect(reaction4.count).toBe(1);
      const msgAfterRx4 = await t.query(internal.messages.getMessageForProcessing, {
        messageId: ingestResult.messageId as Id<'messages'>,
      });
      expect(msgAfterRx4?.reactions).toHaveLength(1);
      expect(msgAfterRx4?.reactions?.[0].emoji).toBe('🎉');
    });

    it('returns message_not_found gracefully when messageId does not exist', async () => {
      const t = setup();

      const result = await t.mutation(internal.messages.applyReaction, {
        instance: INSTANCE,
        targetMessageId: 'NON_EXISTENT_MSG',
        emoji: '👍',
        fromMe: false,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('message_not_found');
    });

    it('cleans up legacy reaction dummy messages', async () => {
      const t = setup();

      const ingestResult = await t.mutation(internal.messages.ingestMessage, {
        instance: INSTANCE,
        remoteJid: 'contact2@s.whatsapp.net',
        messageId: 'DUMMY_REACTION_MSG',
        fromMe: false,
        messageType: 'conversation',
        text: '[reactionMessage received — not handled]',
        status: 'skipped',
      });

      expect(ingestResult.messageId).not.toBeNull();

      const cleanup = await t.mutation(internal.messages.cleanupReactionMessages, {
        instance: INSTANCE,
      });

      expect(cleanup.deleted).toBeGreaterThanOrEqual(1);

      const check = await t.query(internal.messages.getMessageForProcessing, {
        messageId: ingestResult.messageId as Id<'messages'>,
      });
      expect(check).toBeNull();
    });
  });
});
