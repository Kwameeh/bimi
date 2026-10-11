import { v } from "convex/values";
import { action } from "./_generated/server";
import { transcribeAudio } from "./providers/transcription";
import { synthesizeSpeech, TTS_MAX_CHARS } from "./providers/processing";

/**
 * Synthesize a spoken version of an assistant reply.
 *
 * Returns `null` rather than throwing on any provider failure — the client
 * treats null as "fall back to the on-device voice", so a Workers AI outage
 * or a missing credential degrades to a robotic voice instead of silence.
 */
export const speak = action({
  args: {
    text: v.string(),
    lang: v.optional(v.string()),
  },
  handler: async (
    _ctx,
    args,
  ): Promise<{ base64: string; mimeType: string } | null> => {
    const text = args.text.trim();
    if (text.length === 0) return null;
    try {
      return await synthesizeSpeech({
        text: text.slice(0, TTS_MAX_CHARS),
        lang: args.lang,
      });
    } catch (err) {
      console.warn("[voice.speak] synthesis failed", {
        err: err instanceof Error ? err.message : String(err),
        textLength: text.length,
      });
      return null;
    }
  },
});

/**
 * Fallback speech-to-text for devices without on-device recognition
 * (older Android, no Google speech service, Firefox/Safari on web).
 * The primary path is `expo-speech-recognition` on the client, which is free
 * and streams interim results; this one costs an API call and gives no
 * partials, so it is only used when the device can't do it itself.
 */
export const transcribe = action({
  args: { base64: v.string(), mimeType: v.optional(v.string()) },
  handler: async (_ctx, args): Promise<string> => {
    if (args.base64.length === 0) return "";
    return await transcribeAudio({ base64: args.base64, mimeType: args.mimeType });
  },
});
