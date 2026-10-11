/**
 * Pure text helpers for voice mode.
 *
 * Lives in `convex/` (not `src/`) for two reasons: vitest is configured to
 * collect only `convex/**\/*.test.ts`, and the client already imports
 * non-generated Convex modules directly (see `src/app/(tabs)/assistant.tsx`
 * importing `convex/providers/models`). No Convex APIs are used here — this
 * is plain, side-effect-free logic shared by the app and the tests.
 */

/**
 * Turn an assistant reply into something worth hearing.
 *
 * The assistant is instructed to answer in markdown and to cite contacts and
 * messages as links with a custom scheme — `[Sarah](contact:k57abc)` — which
 * `CitationRenderer` in `src/components/assistant/assistant-markdown.tsx`
 * turns into tappable chips. Those links stay in the stored text so the
 * transcript keeps its chips; they are flattened to their label only here, on
 * the way to the speaker.
 */
export function toSpeakable(markdown: string): string {
  let s = markdown;

  // Fenced code blocks read as noise out loud.
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/`([^`]+)`/g, '$1');

  // Links: [label](href) -> label. Covers contact:/message: citations and
  // ordinary URLs alike; a spoken URL helps nobody.
  s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');

  // Emphasis and headings.
  s = s.replace(/(\*\*|__)(.*?)\1/g, '$2');
  s = s.replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, '$2');
  s = s.replace(/~~(.*?)~~/g, '$1');
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  s = s.replace(/^\s{0,3}>\s?/gm, '');

  // List markers become sentence breaks so the voice pauses between items
  // instead of running them together.
  s = s.replace(/^\s*[-*+]\s+/gm, '');
  s = s.replace(/^\s*\d+[.)]\s+/gm, '');

  // Horizontal rules and stray table pipes.
  s = s.replace(/^\s*([-*_]\s*){3,}$/gm, ' ');
  s = s.replace(/\|/g, ' ');

  // Collapse whitespace; a blank line becomes a sentence break.
  s = s.replace(/\r\n/g, '\n');
  s = s
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => (/[.!?:,;]$/.test(line) ? line : `${line}.`))
    .join(' ');

  return s.replace(/[ \t]+/g, ' ').trim();
}

const SENTENCE_END = /[.!?]["')\]]?\s/;

/**
 * Pull the next complete sentence out of a reply that is still streaming in.
 *
 * `assistantStream.ts` flushes token deltas into the message row every ~150ms,
 * so the text grows under us. Speaking only on a completed sentence boundary
 * keeps the device voice from reading half a word and then stopping. Returns
 * null while the tail is still mid-sentence; pass `flush` once the turn is
 * done to speak whatever remains.
 */
export function nextSpeakableChunk(
  full: string,
  spokenUpTo: number,
  flush = false,
): { chunk: string; nextIndex: number } | null {
  if (spokenUpTo >= full.length) return null;
  const rest = full.slice(spokenUpTo);

  const match = SENTENCE_END.exec(rest);
  if (!match) {
    if (!flush) return null;
    const chunk = rest.trim();
    if (chunk.length === 0) return null;
    return { chunk, nextIndex: full.length };
  }

  const end = match.index + match[0].length;
  const chunk = rest.slice(0, end).trim();
  if (chunk.length === 0) {
    return nextSpeakableChunk(full, spokenUpTo + end, flush);
  }
  return { chunk, nextIndex: spokenUpTo + end };
}

export type VoiceIntent = 'approve' | 'reject' | 'stop' | 'none';

function argString(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * What Bimi says out loud when a tool is waiting on approval.
 *
 * The on-screen equivalent is `DESTRUCTIVE_DESCRIPTION` in
 * `src/components/assistant/confirm-card.tsx`, but the two can't be shared:
 * the card shows the message body in a preview block beneath the sentence,
 * whereas out loud the body has to be read back inside the sentence itself —
 * hearing "Bimi wants to send a WhatsApp message to Alvin" tells you nothing
 * about what it is about to say on your behalf.
 */
export function describeConfirmationForSpeech(toolName: string, rawArgs: unknown): string {
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  const to = argString(args, 'contactName') ?? 'this contact';
  const text = argString(args, 'text');

  switch (toolName) {
    case 'sendWhatsappMessage':
      return text
        ? `I'll send this to ${to}: ${text}. Send it?`
        : `I'll send a message to ${to}. Send it?`;
    case 'draftReply':
      return text
        ? `I'll save this draft for ${to}: ${text}. Save it?`
        : `I'll save a draft reply for ${to}. Save it?`;
    case 'createTask': {
      const title = argString(args, 'title');
      return title ? `I'll add a task: ${title}. Add it?` : "I'll add a task. Add it?";
    }
    case 'markTaskDone':
      return "I'll mark that task as done. Go ahead?";
    case 'deleteTask':
      return "I'll delete that task. Go ahead?";
    case 'rejectDraft':
      return "I'll reject that draft and clear its needs-reply flag. Go ahead?";
    case 'dismissReminder':
      return "I'll dismiss that reminder for good. Go ahead?";
    case 'acceptMeeting':
      return "I'll accept that meeting. Go ahead?";
    case 'declineMeeting':
      return "I'll decline that meeting. Go ahead?";
    case 'markNeedsReply':
      return args.value === true
        ? "I'll flag that message as needing a reply. Go ahead?"
        : "I'll clear the needs-reply flag on that message. Go ahead?";
    case 'markActionPlanItemDone':
      return `I'll mark action plan item ${args.order ?? ''} as done. Go ahead?`.replace(
        /\s+/g,
        ' ',
      );
    case 'sendDraft':
      return text
        ? `I'll send the draft to ${to}: ${text}. Send it?`
        : `I'll send the queued draft to ${to}. Send it?`;
    case 'createReminder': {
      const reminder = argString(args, 'text');
      return reminder
        ? `I'll remind you: ${reminder}. Set it?`
        : "I'll set that reminder. Go ahead?";
    }
    case 'rememberThis': {
      const content = argString(args, 'content');
      const about =
        args.scope === 'contact' && argString(args, 'contactName')
          ? ` about ${argString(args, 'contactName')}`
          : '';
      return content
        ? `I'll remember this${about}: ${content}. Save it?`
        : `I'll remember that${about}. Save it?`;
    }
    case 'forgetMemory': {
      const content = argString(args, 'content');
      return content
        ? `I'll forget this for good: ${content}. Delete it?`
        : "I'll delete that memory for good. Go ahead?";
    }
    case 'saveKnowledge': {
      const title = argString(args, 'title');
      return title
        ? `I'll save this as ${title}. Save it?`
        : "I'll save that to your knowledge base. Go ahead?";
    }
    case 'updateChatSettings':
      return `I'll update how I handle ${to}. Go ahead?`;
    case 'createContactGoal': {
      const title = argString(args, 'title');
      const warning =
        args.mode === 'auto'
          ? " I'll send those messages myself, without asking each time."
          : ' Each message will come to you for approval first.';
      return title
        ? `I'll set up an ongoing goal for ${to}: ${title}.${warning} Set it up?`
        : `I'll set up an ongoing goal for ${to}.${warning} Set it up?`;
    }
    default:
      return 'I need your go-ahead for that. Should I?';
  }
}

const APPROVE_WORDS = [
  'yes',
  'yeah',
  'yep',
  'yup',
  'sure',
  'ok',
  'okay',
  'confirm',
  'confirmed',
  'approve',
  'approved',
  'send',
  'send it',
  'go ahead',
  'do it',
  'please do',
  'correct',
  'perfect',
  'sounds good',
  'looks good',
  'that works',
];

const REJECT_WORDS = [
  'no',
  'nope',
  'nah',
  'cancel',
  'reject',
  'deny',
  'discard',
  'delete',
  "don't",
  'do not',
  'dont',
  'never mind',
  'nevermind',
  'forget it',
  'not yet',
  'hold on',
  'wait',
];

const STOP_WORDS = [
  'stop',
  'stop talking',
  'be quiet',
  'shut up',
  'quiet',
  'enough',
  'nevermind stop',
];

const phraseMatcherCache = new Map<string, RegExp>();

/**
 * Word-boundary matcher, mirroring `keywordMatcher` in `replyRules.ts`.
 * Substring matching would fire "no" inside "notify" and "ok" inside "broke",
 * which on the approval path means sending a WhatsApp message the user never
 * agreed to.
 */
function phraseMatcher(phrase: string): RegExp {
  const cached = phraseMatcherCache.get(phrase);
  if (cached) return cached;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(`\\b${escaped.replace(/\s+/g, '\\s+')}\\b`, 'i');
  phraseMatcherCache.set(phrase, matcher);
  return matcher;
}

function hasAny(text: string, phrases: readonly string[]): boolean {
  return phrases.some((p) => phraseMatcher(p).test(text));
}

/**
 * Classify a spoken utterance answering an approval prompt.
 *
 * Deliberately conservative: anything that isn't clearly an answer returns
 * "none", and the caller forwards it to the assistant as an ordinary message
 * rather than guessing. Rejection is checked before approval so "no, don't
 * send it" is a reject rather than an approve on the trailing "send it".
 */
export function matchVoiceIntent(utterance: string): VoiceIntent {
  const text = utterance
    .trim()
    .toLowerCase()
    .replace(/[.,!?]+$/g, '');
  if (text.length === 0) return 'none';
  if (hasAny(text, STOP_WORDS)) return 'stop';
  if (hasAny(text, REJECT_WORDS)) return 'reject';
  if (hasAny(text, APPROVE_WORDS)) return 'approve';
  return 'none';
}

function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ORDINALS = [
  ['first', 'one', '1'],
  ['second', 'two', '2'],
  ['third', 'three', '3'],
  ['fourth', 'four', '4'],
];

/**
 * Pick which of `labels` a spoken utterance refers to, for `askUserForChoice`
 * and `askUserQuestion`. Returns null when nothing matches confidently, so the
 * utterance falls through to the assistant instead of selecting at random.
 */
export function matchOption(utterance: string, labels: string[]): number | null {
  const said = normalizeForCompare(utterance);
  if (said.length === 0 || labels.length === 0) return null;

  const normalized = labels.map(normalizeForCompare);

  const exact = normalized.findIndex((label) => label.length > 0 && label === said);
  if (exact >= 0) return exact;

  const contained = normalized.findIndex(
    (label) => label.length > 0 && (said.includes(label) || label.includes(said)),
  );
  if (contained >= 0) return contained;

  // "the first one", "number two"
  for (let i = 0; i < ORDINALS.length && i < labels.length; i++) {
    if (hasAny(said, ORDINALS[i])) return i;
  }

  // Fall back to distinctive word overlap. Requires a clear winner so
  // "send it to them" doesn't arbitrarily pick between two similar labels.
  const saidWords = new Set(said.split(' ').filter((w) => w.length > 2));
  if (saidWords.size === 0) return null;

  let bestIndex = -1;
  let bestScore = 0;
  let tied = false;
  normalized.forEach((label, i) => {
    const labelWords = label.split(' ').filter((w) => w.length > 2);
    if (labelWords.length === 0) return;
    const overlap = labelWords.filter((w) => saidWords.has(w)).length;
    const score = overlap / labelWords.length;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
      tied = false;
    } else if (score === bestScore && score > 0) {
      tied = true;
    }
  });

  if (bestIndex < 0 || tied || bestScore < 0.5) return null;
  return bestIndex;
}
