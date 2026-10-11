import type { Id } from './_generated/dataModel';
import type { ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import { transcribeAudio } from './providers/transcription';
import { fetchMediaBase64 } from './providers/evolution';
import { describeImage } from './providers/processing';

export async function prepareMediaForManualAi(
  ctx: ActionCtx,
  messageId: Id<'messages'>,
): Promise<string> {
  const message = await ctx.runQuery(internal.messages.getMessageForProcessing, {
    messageId,
  });
  if (!message) throw new Error('Message not found');
  if (message.processingModeAtIngest !== 'manual_only') return message.text;
  if (message.status === 'ready') return message.text;
  if (message.messageType !== 'imageMessage' && message.messageType !== 'audioMessage') {
    return message.text;
  }

  const { base64, mimeType } = await fetchMediaBase64({
    instance: message.instance,
    messageId: message.messageId,
  });
  let preparedText: string;
  if (message.messageType === 'imageMessage') {
    preparedText = `[Image] ${await describeImage({
      base64,
      mimeType: mimeType ?? message.mediaMimeType,
    })}`;
  } else {
    const transcript = await transcribeAudio({
      base64,
      mimeType: mimeType ?? message.mediaMimeType,
    });
    preparedText =
      transcript.length > 0 ? `[Voice note] ${transcript}` : '[Voice note: empty transcript]';
  }
  await ctx.runMutation(internal.messages.setProcessingResult, {
    messageId,
    status: 'ready',
    text: preparedText,
  });
  return preparedText;
}
