import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { assemblyTranscribe } = vi.hoisted(() => ({
  assemblyTranscribe: vi.fn(),
}));
vi.mock('./assemblyAi', () => ({ transcribeAudio: assemblyTranscribe }));
import { transcribeAudio } from './transcription';

const ogg = btoa('OggS\x00test-audio');
const wav = btoa('RIFF\x00\x00\x00\x00WAVEtest-audio');
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  assemblyTranscribe.mockReset();
  vi.stubEnv('BIMI_TRANSCRIPTION_PROVIDER', '');
  vi.stubEnv('BIMI_TRANSCRIPTION_MODEL', '');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('transcription adapters', () => {
  it('preserves AssemblyAI as the legacy default', async () => {
    assemblyTranscribe.mockResolvedValue('legacy transcript');
    expect(await transcribeAudio({ base64: ogg })).toBe('legacy transcript');
    expect(assemblyTranscribe).toHaveBeenCalledWith({ base64: ogg });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['openai', 'OPENAI_API_KEY', 'https://api.openai.com/v1/audio/transcriptions', 'whisper-1'],
    [
      'groq',
      'GROQ_API_KEY',
      'https://api.groq.com/openai/v1/audio/transcriptions',
      'whisper-large-v3-turbo',
    ],
    [
      'openai-compatible',
      'OPENAI_COMPATIBLE_API_KEY',
      'http://localhost:8000/v1/audio/transcriptions',
      'custom-whisper',
    ],
  ])('uploads real audio bytes through %s', async (provider, key, url, model) => {
    vi.stubEnv('BIMI_TRANSCRIPTION_PROVIDER', provider);
    vi.stubEnv(key, 'test-key');
    vi.stubEnv('OPENAI_COMPATIBLE_BASE_URL', 'http://localhost:8000/v1/');
    vi.stubEnv('OPENAI_COMPATIBLE_TRANSCRIPTION_MODEL', 'custom-whisper');
    fetchMock.mockResolvedValue(Response.json({ text: ' hello there ' }));
    const audio = provider === 'openai' ? wav : ogg;
    expect(await transcribeAudio({ base64: audio, language: 'en' })).toBe('hello there');
    const [actualUrl, request] = fetchMock.mock.calls[0];
    expect(actualUrl).toBe(url);
    expect(request.headers).toEqual({ Authorization: 'Bearer test-key' });
    const form = request.body as FormData;
    expect(form.get('model')).toBe(model);
    expect(form.get('language')).toBe('en');
    const file = form.get('file') as File;
    expect(file.name).toBe(provider === 'openai' ? 'audio.wav' : 'audio.ogg');
    expect(file.type).toBe(provider === 'openai' ? 'audio/wav' : 'audio/ogg');
    expect(await file.text()).toBe(atob(audio));
  });

  it('honors model and MIME overrides for native recordings', async () => {
    vi.stubEnv('BIMI_TRANSCRIPTION_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_API_KEY', 'test');
    vi.stubEnv('BIMI_TRANSCRIPTION_MODEL', 'custom-speech-model');
    fetchMock.mockResolvedValue(Response.json({ text: '' }));
    expect(
      await transcribeAudio({
        base64: btoa('audio-bytes'),
        mimeType: 'audio/mp4',
      }),
    ).toBe('');
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get('model')).toBe('custom-speech-model');
    expect((form.get('file') as File).name).toBe('audio.m4a');
  });

  it("uses Cloudflare's binary Whisper input", async () => {
    vi.stubEnv('BIMI_TRANSCRIPTION_PROVIDER', 'cloudflare');
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'test');
    fetchMock.mockResolvedValue(
      Response.json({ success: true, result: { text: ' cloud transcript ' } }),
    );
    expect(await transcribeAudio({ base64: ogg })).toBe('cloud transcript');
    expect(fetchMock.mock.calls[0][0]).toContain('/account/ai/run/@cf/openai/whisper');
    expect(Array.from(fetchMock.mock.calls[0][1].body)).toEqual(
      Array.from(atob(ogg), (c) => c.charCodeAt(0)),
    );
  });

  it('rejects unknown providers, missing credentials, and malformed audio before calling an API', async () => {
    vi.stubEnv('BIMI_TRANSCRIPTION_PROVIDER', 'typo');
    await expect(transcribeAudio({ base64: ogg })).rejects.toThrow(
      'Unknown transcription provider',
    );
    vi.stubEnv('BIMI_TRANSCRIPTION_PROVIDER', 'groq');
    vi.stubEnv('GROQ_API_KEY', '');
    await expect(transcribeAudio({ base64: ogg })).rejects.toThrow('GROQ_API_KEY');
    vi.stubEnv('GROQ_API_KEY', 'test');
    await expect(transcribeAudio({ base64: btoa('unknown-format') })).rejects.toThrow(
      'Unknown audio format',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects HTTP and invalid response errors without exposing response bodies', async () => {
    vi.stubEnv('BIMI_TRANSCRIPTION_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_API_KEY', 'test');
    fetchMock.mockResolvedValue(new Response('private provider details', { status: 401 }));
    await expect(transcribeAudio({ base64: wav })).rejects.toThrow('HTTP 401');
    fetchMock.mockResolvedValue(Response.json({ unexpected: true }));
    await expect(transcribeAudio({ base64: wav })).rejects.toThrow('returned no text');
  });

  it('aborts a hung transcription request', async () => {
    vi.useFakeTimers();
    vi.stubEnv('BIMI_TRANSCRIPTION_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_API_KEY', 'test');
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const expectation = expect(transcribeAudio({ base64: wav })).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(120_000);
    await expectation;
  });

  it('rejects OGG on OpenAI before uploading and explains compatible alternatives', async () => {
    vi.stubEnv('BIMI_TRANSCRIPTION_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_API_KEY', 'test');
    await expect(transcribeAudio({ base64: ogg })).rejects.toThrow('WhatsApp OGG voice notes');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
