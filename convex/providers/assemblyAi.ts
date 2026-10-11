const ASSEMBLY_BASE = 'https://api.assemblyai.com/v2';
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 120_000;

function getEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.length > 0 ? value : null;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    view[i] = binary.charCodeAt(i);
  }
  return buffer;
}

async function uploadAudio(apiKey: string, base64: string): Promise<string> {
  const buffer = base64ToArrayBuffer(base64);
  const response = await fetch(`${ASSEMBLY_BASE}/upload`, {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'content-type': 'application/octet-stream',
    },
    body: buffer,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AssemblyAI upload failed (${response.status}): ${errText}`);
  }
  const json = (await response.json()) as { upload_url?: string };
  if (!json.upload_url) {
    throw new Error('AssemblyAI upload returned no upload_url');
  }
  return json.upload_url;
}

async function submitTranscript(apiKey: string, audioUrl: string): Promise<string> {
  const modelEnv = getEnv('ASSEMBLYAI_SPEECH_MODELS');
  const speechModels = modelEnv
    ? modelEnv
        .split(',')
        .map((m) => m.trim())
        .filter((m) => m.length > 0)
    : ['universal-2'];

  const response = await fetch(`${ASSEMBLY_BASE}/transcript`, {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      speech_models: speechModels,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AssemblyAI submit failed (${response.status}): ${errText}`);
  }
  const json = (await response.json()) as { id?: string };
  if (!json.id) {
    throw new Error('AssemblyAI submit returned no id');
  }
  return json.id;
}

async function pollTranscript(apiKey: string, transcriptId: string): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const response = await fetch(`${ASSEMBLY_BASE}/transcript/${transcriptId}`, {
      headers: { authorization: apiKey },
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`AssemblyAI poll failed (${response.status}): ${errText}`);
    }
    const json = (await response.json()) as {
      status?: string;
      text?: string;
      error?: string;
    };
    if (json.status === 'completed') {
      return (json.text ?? '').trim();
    }
    if (json.status === 'error') {
      throw new Error(`AssemblyAI transcription error: ${json.error ?? 'unknown'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`AssemblyAI transcription timed out after ${POLL_TIMEOUT_MS}ms`);
}

export async function transcribeAudio(args: { base64: string }): Promise<string> {
  const apiKey = getEnv('ASSEMBLYAI_API_KEY');
  if (!apiKey) {
    throw new Error('AssemblyAI not configured: set ASSEMBLYAI_API_KEY');
  }

  const uploadUrl = await uploadAudio(apiKey, args.base64);
  const transcriptId = await submitTranscript(apiKey, uploadUrl);
  return await pollTranscript(apiKey, transcriptId);
}
