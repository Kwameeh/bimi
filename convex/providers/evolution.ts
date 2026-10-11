import { canonicalWhatsAppJid } from '../whatsappJid';

function getEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.length > 0 ? value : null;
}

function extractNumber(jidOrNumber: string): string {
  const digits = jidOrNumber.split('@')[0]?.replace(/\D/g, '') ?? '';
  return digits;
}

export type SendTextArgs = {
  instance: string;
  to: string;
  text: string;
  quoted?: {
    messageId: string;
    originalText?: string;
  };
};

export type SendTextResult = {
  messageId?: string;
  status?: string;
  raw: unknown;
};

export type FetchMediaResult = {
  base64: string;
  mimeType?: string;
  fileName?: string;
};

function findMessageRecords(payload: unknown): Array<Record<string, any>> {
  if (typeof payload !== 'object' || payload === null) return [];
  const root = payload as Record<string, any>;
  const records = root.messages?.records ?? root.records;
  return Array.isArray(records)
    ? records.filter((record): record is Record<string, any> => {
        return typeof record === 'object' && record !== null;
      })
    : [];
}

export function findAlternativeJid(payload: unknown, remoteJid: string): string | null {
  for (const record of findMessageRecords(payload)) {
    const key =
      typeof record.key === 'object' && record.key !== null
        ? (record.key as Record<string, any>)
        : null;
    if (key?.remoteJid !== remoteJid) continue;
    const alternative = typeof key.remoteJidAlt === 'string' ? key.remoteJidAlt : undefined;
    const canonical = canonicalWhatsAppJid(remoteJid, alternative);
    if (canonical !== remoteJid) return canonical;
  }
  return null;
}

async function resolveLidJid(args: {
  baseUrl: string;
  apiKey: string;
  instance: string;
  remoteJid: string;
}): Promise<string> {
  if (!args.remoteJid.endsWith('@lid')) return args.remoteJid;

  const url = `${args.baseUrl.replace(/\/$/, '')}/chat/findMessages/${encodeURIComponent(args.instance)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: args.apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      where: { key: { remoteJid: args.remoteJid } },
      limit: 100,
    }),
  });
  if (!response.ok) return args.remoteJid;

  try {
    return findAlternativeJid(await response.json(), args.remoteJid) ?? args.remoteJid;
  } catch {
    return args.remoteJid;
  }
}

export async function fetchMediaBase64(args: {
  instance: string;
  messageId: string;
  convertToMp4?: boolean;
}): Promise<FetchMediaResult> {
  const baseUrl = getEnv('EVOLUTION_API_BASE_URL');
  const apiKey = getEnv('EVOLUTION_API_KEY');
  if (!baseUrl) throw new Error('Evolution not configured: set EVOLUTION_API_BASE_URL');
  if (!apiKey) throw new Error('Evolution not configured: set EVOLUTION_API_KEY');

  const url = `${baseUrl.replace(/\/$/, '')}/chat/getBase64FromMediaMessage/${encodeURIComponent(args.instance)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      message: { key: { id: args.messageId } },
      convertToMp4: args.convertToMp4 ?? false,
    }),
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`Evolution fetchMediaBase64 failed (${response.status}): ${rawText}`);
  }

  let base64: string | undefined;
  let mimeType: string | undefined;
  let fileName: string | undefined;
  try {
    const parsed = JSON.parse(rawText) as Record<string, any>;
    base64 = typeof parsed.base64 === 'string' ? parsed.base64 : undefined;
    mimeType = typeof parsed.mimetype === 'string' ? parsed.mimetype : undefined;
    fileName = typeof parsed.fileName === 'string' ? parsed.fileName : undefined;
  } catch {
    base64 = rawText;
  }
  if (!base64) {
    throw new Error('Evolution fetchMediaBase64 returned no base64 payload');
  }
  return { base64, mimeType, fileName };
}

export type GroupInfo = {
  id: string;
  subject?: string;
  subjectOwner?: string;
  subjectTime?: number;
  pictureUrl?: string;
  size?: number;
  creation?: number;
  owner?: string;
  desc?: string;
  participants: Array<{ id: string; admin?: string }>;
};

export async function fetchGroupInfo(args: {
  instance: string;
  groupJid: string;
}): Promise<GroupInfo> {
  const baseUrl = getEnv('EVOLUTION_API_BASE_URL');
  const apiKey = getEnv('EVOLUTION_API_KEY');
  if (!baseUrl) throw new Error('Evolution not configured: set EVOLUTION_API_BASE_URL');
  if (!apiKey) throw new Error('Evolution not configured: set EVOLUTION_API_KEY');

  const url = new URL(
    `${baseUrl.replace(/\/$/, '')}/group/findGroupInfos/${encodeURIComponent(args.instance)}`,
  );
  url.searchParams.set('groupJid', args.groupJid);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { apikey: apiKey },
  });
  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`Evolution fetchGroupInfo failed (${response.status}): ${rawText}`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Evolution fetchGroupInfo returned invalid JSON: ${rawText.slice(0, 200)}`);
  }
  const participantsArray = Array.isArray(parsed?.participants) ? parsed.participants : [];
  return {
    id: typeof parsed?.id === 'string' ? parsed.id : args.groupJid,
    subject: typeof parsed?.subject === 'string' ? parsed.subject : undefined,
    subjectOwner: typeof parsed?.subjectOwner === 'string' ? parsed.subjectOwner : undefined,
    subjectTime: typeof parsed?.subjectTime === 'number' ? parsed.subjectTime : undefined,
    pictureUrl: typeof parsed?.pictureUrl === 'string' ? parsed.pictureUrl : undefined,
    size: typeof parsed?.size === 'number' ? parsed.size : undefined,
    creation: typeof parsed?.creation === 'number' ? parsed.creation : undefined,
    owner: typeof parsed?.owner === 'string' ? parsed.owner : undefined,
    desc: typeof parsed?.desc === 'string' ? parsed.desc : undefined,
    participants: participantsArray
      .filter((p: any) => p && typeof p.id === 'string')
      .map((p: any) => ({
        id: p.id as string,
        admin: typeof p.admin === 'string' ? (p.admin as string) : undefined,
      })),
  };
}

/**
 * Ask Evolution for a contact's current profile-picture URL.
 *
 * Returns null when the contact has no picture or hides it behind privacy
 * settings — a normal outcome, not an error. Evolution reports this
 * inconsistently across versions (null body, missing field, or a 4xx), so all
 * three are treated as "no picture".
 */
export async function fetchProfilePictureUrl(args: {
  instance: string;
  number: string;
}): Promise<string | null> {
  const baseUrl = getEnv('EVOLUTION_API_BASE_URL');
  const apiKey = getEnv('EVOLUTION_API_KEY');
  if (!baseUrl) throw new Error('Evolution not configured: set EVOLUTION_API_BASE_URL');
  if (!apiKey) throw new Error('Evolution not configured: set EVOLUTION_API_KEY');

  const url = `${baseUrl.replace(/\/$/, '')}/chat/fetchProfilePictureUrl/${encodeURIComponent(args.instance)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ number: args.number }),
  });

  const rawText = await response.text();
  if (!response.ok) {
    // 4xx here means "no picture for this number" far more often than it means
    // a real failure, so only surface 5xx as an error worth retrying.
    if (response.status >= 500) {
      throw new Error(`Evolution fetchProfilePictureUrl failed (${response.status}): ${rawText}`);
    }
    return null;
  }

  try {
    const parsed = JSON.parse(rawText) as Record<string, any>;
    const picture = parsed?.profilePictureUrl;
    return typeof picture === 'string' && picture.length > 0 ? picture : null;
  } catch {
    return null;
  }
}

/**
 * Check whether a cached picture URL still resolves.
 *
 * WhatsApp's pps.whatsapp.net URLs are signed and rotate, so a URL that worked
 * yesterday can 403 today. A HEAD is far cheaper than re-asking Evolution for
 * every contact, so it is used as the first-line check and the Evolution call is
 * reserved for URLs that have actually gone stale.
 *
 * Returns true on a network error: an unreachable CDN is not evidence that the
 * URL rotated, and re-fetching every avatar on a blip would be worse than
 * briefly keeping one that might be stale.
 */
export async function isProfilePictureAlive(pictureUrl: string): Promise<boolean> {
  try {
    const response = await fetch(pictureUrl, { method: 'HEAD' });
    return response.ok;
  } catch {
    return true;
  }
}

export async function sendText(args: SendTextArgs): Promise<SendTextResult> {
  const baseUrl = getEnv('EVOLUTION_API_BASE_URL');
  const apiKey = getEnv('EVOLUTION_API_KEY');
  if (!baseUrl) throw new Error('Evolution not configured: set EVOLUTION_API_BASE_URL');
  if (!apiKey) throw new Error('Evolution not configured: set EVOLUTION_API_KEY');

  const resolvedJid = await resolveLidJid({
    baseUrl,
    apiKey,
    instance: args.instance,
    remoteJid: args.to,
  });
  const number = resolvedJid.endsWith('@lid') ? resolvedJid : extractNumber(resolvedJid);
  if (!number) throw new Error(`Evolution sendText: could not derive number from "${args.to}"`);

  const url = `${baseUrl.replace(/\/$/, '')}/message/sendText/${encodeURIComponent(args.instance)}`;
  const body: Record<string, unknown> = {
    number,
    text: args.text,
  };
  if (args.quoted) {
    body.quoted = {
      key: { id: args.quoted.messageId },
      message: { conversation: args.quoted.originalText ?? '' },
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const rawText = await response.text();
  let parsed: unknown;
  try {
    parsed = rawText.length > 0 ? JSON.parse(rawText) : null;
  } catch {
    parsed = rawText;
  }

  if (!response.ok) {
    throw new Error(`Evolution sendText failed (${response.status}): ${rawText}`);
  }

  const obj = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, any>) : {};
  const key =
    typeof obj.key === 'object' && obj.key !== null ? (obj.key as Record<string, any>) : {};
  return {
    messageId: typeof key.id === 'string' ? key.id : undefined,
    status: typeof obj.status === 'string' ? obj.status : undefined,
    raw: parsed,
  };
}
