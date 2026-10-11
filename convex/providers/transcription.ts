import { envValue, requireEnv } from './config';
import { transcribeAudio as assemblyAiTranscribe } from './assemblyAi';

export type TranscriptionProvider =
  | 'assemblyai'
  | 'cloudflare'
  | 'openai'
  | 'groq'
  | 'openai-compatible';
export type AudioInput = {
  base64: string;
  mimeType?: string;
  language?: string;
};
export interface TranscriptionAdapter {
  transcribe(input: AudioInput): Promise<string>;
}

function audioBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytes.length > 25 * 1024 * 1024)
    throw new Error('Audio exceeds the 25 MB transcription limit');
  return bytes;
}

function audioFormat(
  bytes: Uint8Array,
  mimeType?: string,
): { mimeType: string; extension: string } {
  const extensions: Record<string, string> = {
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
    'video/webm': 'webm',
    'audio/mp4': 'm4a',
    'video/mp4': 'mp4',
    'audio/m4a': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
  };
  const mime = mimeType?.split(';')[0].trim().toLowerCase();
  if (mime && extensions[mime]) return { mimeType: mime, extension: extensions[mime] };
  const magic = String.fromCharCode(...bytes.slice(0, 12));
  const inferred = magic.startsWith('OggS')
    ? 'audio/ogg'
    : magic.startsWith('RIFF') && magic.slice(8, 12) === 'WAVE'
      ? 'audio/wav'
      : magic.startsWith('fLaC')
        ? 'audio/flac'
        : magic.slice(4, 8) === 'ftyp'
          ? 'audio/mp4'
          : bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
            ? 'audio/webm'
            : magic.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
              ? 'audio/mpeg'
              : null;
  if (!inferred) throw new Error('Unknown audio format. Supply a supported audio MIME type.');
  return { mimeType: inferred, extension: extensions[inferred] };
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function compatibleAdapter(
  provider: 'openai' | 'groq' | 'openai-compatible',
): TranscriptionAdapter {
  return {
    async transcribe(input) {
      const prefix =
        provider === 'openai-compatible' ? 'OPENAI_COMPATIBLE' : provider.toUpperCase();
      const apiKey = requireEnv(`${prefix}_API_KEY`);
      const baseURL =
        provider === 'openai'
          ? 'https://api.openai.com/v1'
          : provider === 'groq'
            ? 'https://api.groq.com/openai/v1'
            : requireEnv('OPENAI_COMPATIBLE_BASE_URL');
      const model =
        envValue('BIMI_TRANSCRIPTION_MODEL') ??
        (provider === 'openai'
          ? 'whisper-1'
          : provider === 'groq'
            ? 'whisper-large-v3-turbo'
            : requireEnv('OPENAI_COMPATIBLE_TRANSCRIPTION_MODEL'));
      const bytes = audioBytes(input.base64);
      const format = audioFormat(bytes, input.mimeType);
      if (provider === 'openai' && (format.extension === 'ogg' || format.extension === 'flac')) {
        throw new Error(
          'OpenAI transcription requires MP3, MP4/M4A, WAV, or WebM audio. For WhatsApp OGG voice notes, select Groq, Cloudflare, or AssemblyAI, or convert the audio first.',
        );
      }
      const form = new FormData();
      form.append(
        'file',
        new Blob([bytes], { type: format.mimeType }),
        `audio.${format.extension}`,
      );
      form.append('model', model);
      form.append('response_format', 'json');
      if (input.language) form.append('language', input.language);
      const response = await timedFetch(`${baseURL.replace(/\/$/, '')}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!response.ok)
        throw new Error(`${provider} transcription failed (HTTP ${response.status})`);
      const result = (await response.json()) as { text?: unknown };
      if (typeof result.text !== 'string')
        throw new Error(`${provider} transcription returned no text`);
      return result.text.trim();
    },
  };
}

/** Add another adapter here; media processing and voice code stay unchanged. */
export const transcriptionAdapters: Record<TranscriptionProvider, TranscriptionAdapter> = {
  assemblyai: { transcribe: assemblyAiTranscribe },
  openai: compatibleAdapter('openai'),
  groq: compatibleAdapter('groq'),
  'openai-compatible': compatibleAdapter('openai-compatible'),
  cloudflare: {
    async transcribe(input) {
      const account = requireEnv('CLOUDFLARE_ACCOUNT_ID');
      const token = requireEnv('CLOUDFLARE_API_TOKEN');
      const model = envValue('BIMI_TRANSCRIPTION_MODEL') ?? '@cf/openai/whisper';
      const response = await timedFetch(
        `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
          },
          body: audioBytes(input.base64),
        },
      );
      if (!response.ok)
        throw new Error(`Cloudflare transcription failed (HTTP ${response.status})`);
      const result = (await response.json()) as {
        success?: boolean;
        result?: { text?: unknown };
      };
      if (result.success === false || typeof result.result?.text !== 'string')
        throw new Error('Cloudflare transcription returned no text');
      return result.result.text.trim();
    },
  },
};

export async function transcribeAudio(input: AudioInput): Promise<string> {
  const provider = envValue('BIMI_TRANSCRIPTION_PROVIDER') ?? 'assemblyai';
  if (!Object.hasOwn(transcriptionAdapters, provider))
    throw new Error(`Unknown transcription provider: ${provider}`);
  if (!input.base64) return '';
  return transcriptionAdapters[provider as TranscriptionProvider].transcribe(input);
}
