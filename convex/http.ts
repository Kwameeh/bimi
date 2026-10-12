import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import { ACTION_REQUEST_PATTERN } from './replyRules';
import { detectMentions, isNoiseMessage } from './mentions';

const http = httpRouter();

const PDF_PAGE_LIMIT = 20;
const PDF_BYTES_LIMIT = 5 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function redactSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveFields);
  }

  if (!isRecord(value)) {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === 'base64' ||
      lowerKey.includes('apikey') ||
      lowerKey.includes('api_key') ||
      lowerKey.includes('token') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('authorization')
    ) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = redactSensitiveFields(nestedValue);
    }
  }
  return redacted;
}

function getMessagePreview(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  const data = isRecord(payload.data) ? payload.data : undefined;
  const key = isRecord(data?.key) ? data.key : undefined;
  const message = isRecord(data?.message) ? data.message : undefined;
  const imageMessage = isRecord(message?.imageMessage) ? message.imageMessage : undefined;
  const audioMessage = isRecord(message?.audioMessage) ? message.audioMessage : undefined;
  const documentMessage = isRecord(message?.documentMessage) ? message.documentMessage : undefined;
  const videoMessage = isRecord(message?.videoMessage) ? message.videoMessage : undefined;
  const stickerMessage = isRecord(message?.stickerMessage) ? message.stickerMessage : undefined;
  const extendedText = isRecord(message?.extendedTextMessage)
    ? message.extendedTextMessage
    : undefined;
  const mediaMessage =
    imageMessage ?? audioMessage ?? documentMessage ?? videoMessage ?? stickerMessage;

  const base64Candidate =
    (typeof message?.base64 === 'string' ? message.base64 : undefined) ??
    (typeof data?.base64 === 'string' ? data.base64 : undefined) ??
    (typeof mediaMessage?.base64 === 'string' ? mediaMessage.base64 : undefined);

  const fileLength =
    typeof documentMessage?.fileLength === 'number'
      ? documentMessage.fileLength
      : typeof documentMessage?.fileLength === 'string'
        ? Number(documentMessage.fileLength)
        : typeof mediaMessage?.fileLength === 'number'
          ? mediaMessage.fileLength
          : undefined;

  const captionCandidate =
    (typeof imageMessage?.caption === 'string' ? imageMessage.caption : undefined) ??
    (typeof documentMessage?.caption === 'string' ? documentMessage.caption : undefined) ??
    (typeof videoMessage?.caption === 'string' ? videoMessage.caption : undefined);

  const contextInfoCandidate =
    (isRecord(extendedText?.contextInfo) ? extendedText.contextInfo : undefined) ??
    (isRecord(imageMessage?.contextInfo) ? imageMessage.contextInfo : undefined) ??
    (isRecord(audioMessage?.contextInfo) ? audioMessage.contextInfo : undefined) ??
    (isRecord(documentMessage?.contextInfo) ? documentMessage.contextInfo : undefined) ??
    (isRecord(videoMessage?.contextInfo) ? videoMessage.contextInfo : undefined) ??
    (isRecord(stickerMessage?.contextInfo) ? stickerMessage.contextInfo : undefined);

  const mentionedJids = Array.isArray(contextInfoCandidate?.mentionedJid)
    ? contextInfoCandidate.mentionedJid.filter(
        (j: unknown): j is string => typeof j === 'string' && j.length > 0,
      )
    : undefined;
  const quotedMessageId =
    typeof contextInfoCandidate?.stanzaId === 'string' && contextInfoCandidate.stanzaId.length > 0
      ? contextInfoCandidate.stanzaId
      : undefined;
  const quotedParticipant =
    typeof contextInfoCandidate?.participant === 'string' &&
    contextInfoCandidate.participant.length > 0
      ? contextInfoCandidate.participant
      : undefined;

  return {
    event: payload.event,
    instance: payload.instance,
    messageId: key?.id,
    remoteJid: key?.remoteJid,
    remoteJidAlt: key?.remoteJidAlt,
    fromMe: key?.fromMe,
    participant: key?.participant,
    pushName: data?.pushName,
    status: data?.status,
    messageType: data?.messageType,
    text: message?.conversation ?? extendedText?.text,
    caption: captionCandidate && captionCandidate.length > 0 ? captionCandidate : undefined,
    mediaMimeType: mediaMessage?.mimetype,
    mediaFileName: documentMessage?.fileName ?? documentMessage?.title,
    mediaUrl: mediaMessage?.url,
    mediaWidth: imageMessage?.width,
    mediaHeight: imageMessage?.height,
    mediaSeconds: typeof audioMessage?.seconds === 'number' ? audioMessage.seconds : undefined,
    mediaPageCount:
      typeof documentMessage?.pageCount === 'number' ? documentMessage.pageCount : undefined,
    mediaFileLength:
      typeof fileLength === 'number' && !Number.isNaN(fileLength) ? fileLength : undefined,
    base64: base64Candidate,
    timestamp: data?.messageTimestamp,
    source: data?.source,
    owner:
      typeof payload.owner === 'string'
        ? payload.owner
        : typeof data?.owner === 'string'
          ? data.owner
          : undefined,
    mentionedJids: mentionedJids && mentionedJids.length > 0 ? mentionedJids : undefined,
    quotedMessageId,
    quotedParticipant,
  };
}

const URGENT_PATTERN =
  /\b(urgent|asap|emergency|now|immediately|right away|critical|server is down|payment failed|call me|deadline (is|today|tomorrow)|client (is )?(waiting|wants))\b/i;

const QUESTION_PATTERN =
  /(\?|\bcan you\b|\bcould you\b|\bare you\b|\bdo you\b|\bdid you\b|\bwhen (can|will|are|is)\b|\bwhere (is|are|can)\b|\bwhat (is|are|time|about)\b|\bwhich\b|\bhow (do|can|much|long|many)\b|\bwhy\b|\bwho\b)/i;

const DEADLINE_PATTERN =
  /\b(by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|eod|end of (day|week|month))|due (on|by|today|tomorrow)|deadline|before (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|noon|\d{1,2}(am|pm)))\b/i;

const MEETING_PATTERN =
  /\b(meeting|meet up|let'?s meet|catch up|call at|zoom|google meet|gmeet|teams call|huddle|video call|conference call|schedule a (call|meeting|chat)|are you (free|available) (at|on|for)|standup|sync)\b/i;

function detectFlags(text: string): {
  needsReply: boolean;
  isUrgent: boolean;
  hasDeadline: boolean;
  isMeeting: boolean;
} {
  const t = text.trim();
  return {
    needsReply: QUESTION_PATTERN.test(t) || ACTION_REQUEST_PATTERN.test(t),
    isUrgent: URGENT_PATTERN.test(t),
    hasDeadline: DEADLINE_PATTERN.test(t),
    isMeeting: MEETING_PATTERN.test(t),
  };
}

type IngestArgs = {
  instance: string;
  remoteJid: string;
  remoteJidAlt?: string;
  messageId: string;
  fromMe: boolean;
  messageType: string;
  text: string;
  caption?: string;
  status: 'ready' | 'processing' | 'failed' | 'skipped';
  pushName?: string;
  timestamp?: number;
  mediaMimeType?: string;
  mediaFileName?: string;
  mediaSeconds?: number;
  mediaPageCount?: number;
  mediaFileLength?: number;
  participant?: string;
  participantPushName?: string;
  mentionedJids?: string[];
  quotedMessageId?: string;
  quotedParticipant?: string;
  owner?: string;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function buildPdfPlaceholder(args: {
  fileName?: string;
  pageCount?: number;
  fileLength?: number;
  tooLong: boolean;
}): string {
  const name = args.fileName ?? 'untitled.pdf';
  const parts: string[] = [name];
  if (args.pageCount !== undefined) parts.push(`${args.pageCount} pages`);
  if (args.fileLength !== undefined) parts.push(formatBytes(args.fileLength));
  const meta = parts.join(', ');
  return args.tooLong
    ? `[Long PDF: ${meta}. Too large to summarize — please review manually.]`
    : `[PDF: ${meta}. Auto-summary not yet implemented.]`;
}

function planIngest(preview: ReturnType<typeof getMessagePreview>):
  | {
      args: IngestArgs;
      scheduleProcessing: boolean;
    }
  | { skipped: string } {
  if (!preview) return { skipped: 'no_preview' };
  if (typeof preview.instance !== 'string' || !preview.instance)
    return { skipped: 'missing_instance' };
  if (typeof preview.remoteJid !== 'string' || !preview.remoteJid)
    return { skipped: 'missing_remoteJid' };
  if (typeof preview.messageId !== 'string' || !preview.messageId)
    return { skipped: 'missing_messageId' };
  if (typeof preview.messageType !== 'string' || !preview.messageType)
    return { skipped: 'missing_messageType' };

  const isGroup = preview.remoteJid.endsWith('@g.us');
  const base: Omit<IngestArgs, 'text' | 'status'> = {
    instance: preview.instance,
    remoteJid: preview.remoteJid,
    remoteJidAlt:
      typeof preview.remoteJidAlt === 'string' && preview.remoteJidAlt.length > 0
        ? preview.remoteJidAlt
        : undefined,
    messageId: preview.messageId,
    fromMe: preview.fromMe === true,
    messageType: preview.messageType,
    caption: typeof preview.caption === 'string' ? preview.caption : undefined,
    pushName: typeof preview.pushName === 'string' ? preview.pushName : undefined,
    timestamp: typeof preview.timestamp === 'number' ? preview.timestamp : undefined,
    mediaMimeType: typeof preview.mediaMimeType === 'string' ? preview.mediaMimeType : undefined,
    mediaFileName: typeof preview.mediaFileName === 'string' ? preview.mediaFileName : undefined,
    mediaSeconds: typeof preview.mediaSeconds === 'number' ? preview.mediaSeconds : undefined,
    mediaPageCount: typeof preview.mediaPageCount === 'number' ? preview.mediaPageCount : undefined,
    mediaFileLength:
      typeof preview.mediaFileLength === 'number' ? preview.mediaFileLength : undefined,
    participant:
      isGroup && typeof preview.participant === 'string' && preview.participant.length > 0
        ? preview.participant
        : undefined,
    participantPushName:
      isGroup && typeof preview.pushName === 'string' && preview.pushName.length > 0
        ? preview.pushName
        : undefined,
    mentionedJids: preview.mentionedJids,
    quotedMessageId: preview.quotedMessageId,
    quotedParticipant: preview.quotedParticipant,
    owner: typeof preview.owner === 'string' ? preview.owner : undefined,
  };

  switch (preview.messageType) {
    case 'conversation':
    case 'extendedTextMessage': {
      if (typeof preview.text !== 'string' || preview.text.length === 0) {
        return { skipped: 'empty_text' };
      }
      return {
        args: { ...base, text: preview.text, status: 'ready' },
        scheduleProcessing: false,
      };
    }
    case 'imageMessage': {
      const hasBase64 = typeof preview.base64 === 'string' && preview.base64.length > 0;
      return {
        args: {
          ...base,
          text: hasBase64
            ? '[Image received — describing...]'
            : '[Image received — no media payload]',
          status: hasBase64 ? 'processing' : 'failed',
        },
        scheduleProcessing: hasBase64,
      };
    }
    case 'audioMessage': {
      const hasBase64 = typeof preview.base64 === 'string' && preview.base64.length > 0;
      return {
        args: {
          ...base,
          text: hasBase64
            ? '[Voice note received — transcribing...]'
            : '[Voice note received — no media payload]',
          status: hasBase64 ? 'processing' : 'failed',
        },
        scheduleProcessing: hasBase64,
      };
    }
    case 'documentMessage': {
      const mt = (preview.mediaMimeType ?? '').toLowerCase();
      const fn = (preview.mediaFileName ?? '').toLowerCase();
      const isPdf = mt.includes('pdf') || fn.endsWith('.pdf');
      const isDocx =
        mt.includes('officedocument.wordprocessingml') ||
        mt.includes('msword') ||
        fn.endsWith('.docx') ||
        fn.endsWith('.doc');
      const isTxt =
        mt.startsWith('text/') || fn.endsWith('.txt') || fn.endsWith('.md') || fn.endsWith('.csv');
      const isSupported = isPdf || isDocx || isTxt;

      if (!isSupported) {
        return {
          args: {
            ...base,
            text: `[Document: ${preview.mediaFileName ?? 'unknown'} (${preview.mediaMimeType ?? 'unknown type'})]`,
            status: 'skipped',
          },
          scheduleProcessing: false,
        };
      }

      const tooLong =
        (typeof preview.mediaPageCount === 'number' && preview.mediaPageCount > PDF_PAGE_LIMIT) ||
        (typeof preview.mediaFileLength === 'number' && preview.mediaFileLength > PDF_BYTES_LIMIT);
      const hasBase64 = typeof preview.base64 === 'string' && preview.base64.length > 0;

      if (tooLong || !hasBase64) {
        return {
          args: {
            ...base,
            text: buildPdfPlaceholder({
              fileName: base.mediaFileName,
              pageCount: base.mediaPageCount,
              fileLength: base.mediaFileLength,
              tooLong: true,
            }),
            status: tooLong ? 'ready' : 'failed',
          },
          scheduleProcessing: false,
        };
      }

      const docLabel = isPdf ? 'PDF' : isDocx ? 'DOCX' : 'TXT';
      return {
        args: {
          ...base,
          text: `[${docLabel}: ${preview.mediaFileName ?? 'untitled'} — summarizing...]`,
          status: 'processing',
        },
        scheduleProcessing: true,
      };
    }
    case 'reactionMessage': {
      return { skipped: 'reaction_message' };
    }
    default: {
      return {
        args: {
          ...base,
          text: `[${preview.messageType} received — not handled]`,
          status: 'skipped',
        },
        scheduleProcessing: false,
      };
    }
  }
}

type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'played' | 'error';

function normalizeStatus(raw: unknown): DeliveryStatus | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.toUpperCase();
  if (s === 'PENDING') return 'pending';
  if (s === 'SERVER_ACK') return 'sent';
  if (s === 'DELIVERY_ACK') return 'delivered';
  if (s === 'READ') return 'read';
  if (s === 'PLAYED') return 'played';
  if (s === 'ERROR') return 'error';
  return undefined;
}

function collectStatusUpdates(payload: unknown): Array<{
  messageId: string;
  deliveryStatus: DeliveryStatus;
}> {
  const updates: Array<{ messageId: string; deliveryStatus: DeliveryStatus }> = [];
  if (!isRecord(payload)) return updates;
  const data = payload.data;
  const items = Array.isArray(data) ? data : data !== undefined ? [data] : [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const key = isRecord(item.key) ? item.key : undefined;
    const messageId = typeof key?.id === 'string' ? key.id : undefined;
    if (!messageId) continue;
    const status = normalizeStatus(item.status) ?? normalizeStatus(item.update?.status);
    if (!status) continue;
    updates.push({ messageId, deliveryStatus: status });
  }
  return updates;
}

export type ExtractedReaction = {
  instance: string;
  targetMessageId: string;
  emoji: string;
  fromMe: boolean;
  participant?: string;
  remoteJid?: string;
  pushName?: string;
  timestamp?: number;
};

export function extractReactions(payload: unknown): ExtractedReaction[] {
  if (!isRecord(payload)) return [];
  const instance = typeof payload.instance === 'string' ? payload.instance : '';
  if (!instance) return [];

  const results: ExtractedReaction[] = [];
  const event = typeof payload.event === 'string' ? payload.event : undefined;

  // Case 1: Baileys / Evolution event messages.reaction
  if (event === 'messages.reaction') {
    const dataItems = Array.isArray(payload.data)
      ? payload.data
      : isRecord(payload.data)
        ? [payload.data]
        : [];
    for (const item of dataItems) {
      if (!isRecord(item)) continue;
      const reactionObj = isRecord(item.reaction) ? item.reaction : undefined;
      const reactionKey = isRecord(reactionObj?.key)
        ? reactionObj.key
        : isRecord(item.key)
          ? item.key
          : undefined;
      const targetMessageId =
        typeof reactionKey?.id === 'string'
          ? reactionKey.id
          : typeof item.messageId === 'string'
            ? item.messageId
            : undefined;
      const emoji =
        typeof reactionObj?.text === 'string'
          ? reactionObj.text
          : typeof item.text === 'string'
            ? item.text
            : undefined;
      if (!targetMessageId || emoji === undefined) continue;

      const fromMe =
        typeof item.fromMe === 'boolean'
          ? item.fromMe
          : typeof reactionKey?.fromMe === 'boolean'
            ? reactionKey.fromMe
            : false;

      const participant =
        typeof item.participant === 'string'
          ? item.participant
          : typeof item.sender === 'string'
            ? item.sender
            : typeof reactionKey?.participant === 'string'
              ? reactionKey.participant
              : undefined;

      const remoteJid =
        typeof item.remoteJid === 'string'
          ? item.remoteJid
          : typeof reactionKey?.remoteJid === 'string'
            ? reactionKey.remoteJid
            : undefined;

      const pushName = typeof item.pushName === 'string' ? item.pushName : undefined;
      const ts =
        typeof item.timestamp === 'number'
          ? item.timestamp
          : typeof reactionObj?.senderTimestampMs === 'number'
            ? Math.floor(reactionObj.senderTimestampMs / 1000)
            : typeof reactionObj?.senderTimestampMs === 'string'
              ? Math.floor(Number(reactionObj.senderTimestampMs) / 1000)
              : undefined;

      results.push({
        instance,
        targetMessageId,
        emoji,
        fromMe,
        participant,
        remoteJid,
        pushName,
        timestamp: ts,
      });
    }
    return results;
  }

  // Case 2: messages.upsert with reactionMessage
  const data = isRecord(payload.data) ? payload.data : undefined;
  if (!data) return results;

  const message = isRecord(data.message) ? data.message : undefined;
  const reactionMessage = isRecord(message?.reactionMessage) ? message.reactionMessage : undefined;

  if (reactionMessage || data.messageType === 'reactionMessage') {
    const rxKey = isRecord(reactionMessage?.key) ? reactionMessage.key : undefined;
    const targetMessageId = typeof rxKey?.id === 'string' ? rxKey.id : undefined;
    const emoji = typeof reactionMessage?.text === 'string' ? reactionMessage.text : '';

    if (targetMessageId !== undefined) {
      const outerKey = isRecord(data.key) ? data.key : undefined;
      const fromMe = outerKey?.fromMe === true;
      const participant =
        typeof outerKey?.participant === 'string' && outerKey.participant.length > 0
          ? outerKey.participant
          : typeof data.participant === 'string' && data.participant.length > 0
            ? data.participant
            : undefined;
      const remoteJid = typeof outerKey?.remoteJid === 'string' ? outerKey.remoteJid : undefined;
      const pushName = typeof data.pushName === 'string' ? data.pushName : undefined;

      const ts =
        typeof data.messageTimestamp === 'number'
          ? data.messageTimestamp
          : typeof reactionMessage?.senderTimestampMs === 'number'
            ? Math.floor(reactionMessage.senderTimestampMs / 1000)
            : typeof reactionMessage?.senderTimestampMs === 'string'
              ? Math.floor(Number(reactionMessage.senderTimestampMs) / 1000)
              : undefined;

      results.push({
        instance,
        targetMessageId,
        emoji,
        fromMe,
        participant,
        remoteJid,
        pushName,
        timestamp: ts,
      });
    }
  }

  return results;
}

http.route({
  path: '/webhooks/evolution',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const expectedSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
    const url = new URL(request.url);
    const receivedSecret =
      request.headers.get('x-bimi-webhook-secret') ?? url.searchParams.get('secret');

    if (expectedSecret && receivedSecret !== expectedSecret) {
      return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = key.toLowerCase() === 'x-bimi-webhook-secret' ? '[REDACTED]' : value;
    });
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const safePayload = redactSensitiveFields(payload);
    const safeRequestUrl = new URL(request.url);
    if (safeRequestUrl.searchParams.has('secret')) {
      safeRequestUrl.searchParams.set('secret', '[REDACTED]');
    }
    const preview = getMessagePreview(payload);
    const previewForLog = preview
      ? { ...preview, base64: preview.base64 ? '[REDACTED]' : undefined }
      : null;
    const event = isRecord(payload) ? payload.event : undefined;

    if (event === 'messages.update') {
      const updates = collectStatusUpdates(payload);
      const instance =
        isRecord(payload) && typeof payload.instance === 'string' ? payload.instance : undefined;
      let applied = 0;
      if (instance) {
        for (const u of updates) {
          await ctx.runMutation(internal.messages.updateDeliveryStatus, {
            instance,
            messageId: u.messageId,
            deliveryStatus: u.deliveryStatus,
          });
          applied += 1;
        }
      }
      console.log('Evolution status updates applied', { instance, applied });
      return new Response(JSON.stringify({ ok: true, event, applied }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const reactions = extractReactions(payload);
    if (reactions.length > 0) {
      let applied = 0;
      for (const rx of reactions) {
        await ctx.runMutation(internal.messages.applyReaction, {
          instance: rx.instance,
          targetMessageId: rx.targetMessageId,
          emoji: rx.emoji,
          fromMe: rx.fromMe,
          participant: rx.participant,
          remoteJid: rx.remoteJid,
          pushName: rx.pushName,
          timestamp: rx.timestamp,
        });
        applied += 1;
      }
      console.log('Evolution reactions applied', {
        instance: isRecord(payload) ? payload.instance : undefined,
        count: applied,
      });
      return new Response(
        JSON.stringify({
          ok: true,
          event,
          reactionsApplied: applied,
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }

    if (preview?.messageType === 'reactionMessage') {
      return new Response(
        JSON.stringify({
          ok: true,
          event,
          ignored: true,
          reason: 'unhandled_reaction_payload',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }

    if (event !== 'messages.upsert') {
      return new Response(
        JSON.stringify({
          ok: true,
          logged: false,
          ignored: true,
          event,
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }

    const plan = planIngest(preview);
    if ('skipped' in plan) {
      return new Response(
        JSON.stringify({
          ok: true,
          logged: true,
          event,
          preview: previewForLog,
          ingest: { skipped: plan.skipped },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }

    const ingestResult = await ctx.runMutation(internal.messages.ingestMessage, plan.args);

    if (ingestResult.ignored) {
      // Do not retain message text or payload data in logs for ignored chats.
      console.log('Evolution message ignored by chat policy', {
        receivedAt: new Date().toISOString(),
        event,
        instance: plan.args.instance,
        remoteJid: plan.args.remoteJid,
        messageId: plan.args.messageId,
        messageType: plan.args.messageType,
      });
      return new Response(
        JSON.stringify({
          ok: true,
          logged: false,
          event,
          ingest: {
            contactId: ingestResult.contactId,
            ignored: true,
            incomingMessageMode: ingestResult.incomingMessageMode,
            scheduledProcessing: false,
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }

    console.log('Evolution webhook received', {
      receivedAt: new Date().toISOString(),
      event,
      instance: isRecord(payload) ? payload.instance : undefined,
      preview: previewForLog,
      incomingMessageMode: ingestResult.incomingMessageMode,
    });

    console.log(
      'Evolution webhook payload',
      JSON.stringify(
        {
          receivedAt: new Date().toISOString(),
          request: {
            method: request.method,
            url: safeRequestUrl.toString(),
            headers,
          },
          preview: previewForLog,
          payload: safePayload,
        },
        null,
        2,
      ),
    );

    const automaticProcessing = ingestResult.incomingMessageMode === 'save_and_process';

    if (!ingestResult.deduped && automaticProcessing) {
      if (!plan.args.fromMe) {
        const flags = detectFlags(plan.args.text + ' ' + (plan.args.caption ?? ''));

        const pref = await ctx.runQuery(internal.userPreferences.getInternal, {
          instance: plan.args.instance,
        });
        const mention =
          pref?.ownerJid || pref?.ownerName || pref?.ownerAliases?.length
            ? detectMentions({
                text: plan.args.text + ' ' + (plan.args.caption ?? ''),
                mentionedJids: plan.args.mentionedJids,
                quotedParticipant: plan.args.quotedParticipant,
                owner: {
                  jid: pref?.ownerJid,
                  phone: pref?.ownerPhone,
                  name: pref?.ownerName,
                  aliases: pref?.ownerAliases,
                },
              })
            : { mentionsUser: false };

        const noise = isNoiseMessage({
          text: plan.args.text,
          messageType: plan.args.messageType,
          mentionsUser: mention.mentionsUser,
        });

        const needsReplyEffective = flags.needsReply || mention.mentionsUser;

        if (
          needsReplyEffective ||
          flags.isUrgent ||
          flags.hasDeadline ||
          flags.isMeeting ||
          mention.mentionsUser ||
          noise
        ) {
          await ctx.runMutation(internal.messageActions.setFlagsInternal, {
            messageId: ingestResult.messageId,
            needsReply: needsReplyEffective || undefined,
            isUrgent: flags.isUrgent || undefined,
            hasDeadline: flags.hasDeadline || undefined,
            isMeeting: flags.isMeeting || undefined,
            mentionsUser: mention.mentionsUser || undefined,
            mentionReason: mention.reason,
            isNoise: noise || undefined,
          });
        }

        if (plan.args.status === 'ready') {
          await ctx.scheduler.runAfter(0, internal.classification.classifyMessageInternal, {
            messageId: ingestResult.messageId,
          });
        }
      }
    }

    if (
      !ingestResult.deduped &&
      automaticProcessing &&
      plan.scheduleProcessing &&
      preview?.base64
    ) {
      if (plan.args.messageType === 'documentMessage') {
        await ctx.scheduler.runAfter(0, internal.documents.processDocumentMessage, {
          messageId: ingestResult.messageId,
          base64: preview.base64,
        });
      } else {
        await ctx.scheduler.runAfter(0, internal.media.processMediaMessage, {
          messageId: ingestResult.messageId,
          base64: preview.base64,
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        logged: true,
        event,
        preview: previewForLog,
        ingest: {
          contactId: ingestResult.contactId,
          messageId: ingestResult.messageId,
          deduped: ingestResult.deduped,
          ignored: false,
          incomingMessageMode: ingestResult.incomingMessageMode,
          scheduledProcessing:
            !ingestResult.deduped && automaticProcessing && plan.scheduleProcessing,
        },
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  }),
});

http.route({
  path: '/health',
  method: 'GET',
  handler: httpAction(async () => {
    return new Response(JSON.stringify({ ok: true, service: 'bimi-convex' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }),
});

export default http;
