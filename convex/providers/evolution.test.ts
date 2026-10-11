/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { internal } from '../_generated/api';
import { canonicalWhatsAppJid } from '../whatsappJid';
import schema from '../schema';
import { findAlternativeJid, sendText } from './evolution';

const modules = import.meta.glob('../**/*.ts');
const LID_JID = '171339180712079@lid';
const PHONE_JID = '233200000001@s.whatsapp.net';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Evolution @lid handling', () => {
  test('uses remoteJidAlt as the canonical one-to-one chat JID', () => {
    expect(canonicalWhatsAppJid(LID_JID, PHONE_JID)).toBe(PHONE_JID);
    expect(canonicalWhatsAppJid('120363000000000000@g.us', undefined)).toBe(
      '120363000000000000@g.us',
    );
  });

  test('finds a phone JID in Evolution message history', () => {
    expect(
      findAlternativeJid(
        {
          messages: {
            records: [
              { key: { remoteJid: LID_JID } },
              { key: { remoteJid: LID_JID, remoteJidAlt: PHONE_JID } },
            ],
          },
        },
        LID_JID,
      ),
    ).toBe(PHONE_JID);
  });

  test('resolves an older stored LID before sending', async () => {
    vi.stubEnv('EVOLUTION_API_BASE_URL', 'https://evolution.example.com');
    vi.stubEnv('EVOLUTION_API_KEY', 'test-key');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            messages: {
              records: [{ key: { remoteJid: LID_JID, remoteJidAlt: PHONE_JID } }],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ key: { id: 'wamid.sent' }, status: 'PENDING' }), {
          status: 201,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendText({ instance: 'main', to: LID_JID, text: 'Hello' })).resolves.toMatchObject(
      { messageId: 'wamid.sent' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://evolution.example.com/chat/findMessages/main',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      number: '233200000001',
      text: 'Hello',
    });
  });

  test('repairs an existing LID contact when a webhook includes remoteJidAlt', async () => {
    const t = convexTest(schema, modules);
    const contactId = await t.run(async (ctx) => {
      return await ctx.db.insert('contacts', {
        instance: 'main',
        remoteJid: LID_JID,
        normalizedPhone: '171339180712079',
        displayName: 'Legacy contact',
        source: 'whatsapp',
      });
    });

    const result = await t.mutation(internal.messages.ingestMessage, {
      instance: 'main',
      remoteJid: LID_JID,
      remoteJidAlt: PHONE_JID,
      messageId: 'wamid.inbound',
      fromMe: false,
      messageType: 'conversation',
      text: 'Hello',
      status: 'ready',
    });

    expect(result.contactId).toBe(contactId);
    const saved = await t.run(async (ctx) => await ctx.db.get(contactId));
    expect(saved?.remoteJid).toBe(PHONE_JID);
    expect(saved?.normalizedPhone).toBe('233200000001');
  });
});
