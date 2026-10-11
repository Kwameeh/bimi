import { useAction, useMutation, useQuery } from 'convex/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../../../convex/_generated/api';
import type { Doc, Id } from '../../../convex/_generated/dataModel';
import {
  describeConfirmationForSpeech,
  matchOption,
  matchVoiceIntent,
  nextSpeakableChunk,
  toSpeakable,
} from '../../../convex/voiceText';
import { useListener } from './use-listener';
import { useTts, type TtsEngine } from './use-tts';

export type VoiceMode = 'push_to_talk' | 'conversational';
export type VoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking';

/**
 * How long the interim transcript must stop changing before we treat the
 * utterance as finished in conversational mode. Short enough to feel
 * responsive, long enough to survive a mid-sentence breath.
 */
const SILENCE_MS = 1200;

type Options = {
  threadId: Id<'assistantThreads'> | null;
  mode: VoiceMode;
  engine: TtsEngine;
  locale: string;
  autoSpeak: boolean;
};

export type VoiceSession = {
  phase: VoicePhase;
  /** Live transcript of what you're saying right now. */
  partial: string;
  /** The last thing you said that was sent to Bimi. */
  lastUtterance: string;
  /** Mic level 0..1, for the orb. */
  volume: number;
  /** The assistant row currently streaming or awaiting an answer. */
  activeRow: Doc<'assistantMessages'> | null;
  messages: Doc<'assistantMessages'>[];
  error: string | null;
  micAvailable: boolean;
  supportsConversational: boolean;
  /** True when transcription runs server-side: slower, and no live text. */
  usingFallbackStt: boolean;

  /** Push-to-talk: begin capturing. */
  beginPushToTalk: () => void;
  /** Push-to-talk: stop capturing and send what was heard. */
  endPushToTalk: () => void;
  /** Conversational: open/close the mic for the whole session. */
  setConversationalOpen: (open: boolean) => void;
  /** Stop the voice, cancel the in-flight turn, and reopen the mic. */
  interrupt: () => void;
  /** Type instead of talk — same path, so approvals still work by voice. */
  sendText: (text: string) => void;
};

function isAwaiting(row: Doc<'assistantMessages'> | undefined | null): boolean {
  const status = row?.status;
  return (
    status === 'awaiting_confirmation' ||
    status === 'awaiting_choice' ||
    status === 'awaiting_questions'
  );
}

/**
 * The voice loop.
 *
 *   idle -> listening -> thinking -> speaking -+-> listening  (conversational)
 *                                              +-> idle       (push-to-talk)
 *
 * Half-duplex by design: the mic closes while Bimi speaks. On a phone speaker
 * an open mic hears Bimi's own voice and feeds it back as your next utterance,
 * so interrupting is a tap (`interrupt`) rather than talking over it.
 *
 * Everything downstream of `sendMessage` is the existing assistant pipeline —
 * this hook only decides when to listen, what to send, and what to say.
 */
export function useVoiceSession({
  threadId,
  mode,
  engine,
  locale,
  autoSpeak,
}: Options): VoiceSession {
  const sendMessage = useAction(api.assistant.sendMessage);
  const requestCancelTurn = useMutation(api.assistant.requestCancelTurn);
  const resolveConfirmation = useAction(api.assistant.resolveConfirmation);
  const submitChoice = useAction(api.assistant.submitChoice);
  const submitAnswers = useAction(api.assistant.submitAnswers);

  const messages = useQuery(
    api.assistant.listMessages,
    threadId ? { threadId } : 'skip',
  );

  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [lastUtterance, setLastUtterance] = useState('');
  const [error, setError] = useState<string | null>(null);

  const tts = useTts(engine, locale);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const conversationalOpenRef = useRef(false);
  // Set while we're waiting for the assistant row that answers our utterance,
  // so a stale trailing row from a previous turn doesn't get spoken twice.
  const awaitingReplyRef = useRef(false);

  const rows = useMemo(() => messages ?? [], [messages]);

  const pendingRow = useMemo(
    () => [...rows].reverse().find((r) => isAwaiting(r)) ?? null,
    [rows],
  );

  const runningRow = useMemo(
    () =>
      [...rows]
        .reverse()
        .find((r) => r.role === 'assistant' && r.status === 'running') ?? null,
    [rows],
  );

  const lastAssistantRow = useMemo(
    () => [...rows].reverse().find((r) => r.role === 'assistant') ?? null,
    [rows],
  );

  // ---------------------------------------------------------------- sending

  const send = useCallback(
    async (text: string) => {
      if (!threadId) return;
      const trimmed = text.trim();
      if (trimmed.length === 0) return;

      setLastUtterance(trimmed);
      setPhase('thinking');
      awaitingReplyRef.current = true;
      try {
        await sendMessage({ threadId, content: trimmed });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        awaitingReplyRef.current = false;
        setPhase(conversationalOpenRef.current ? 'listening' : 'idle');
      }
    },
    [sendMessage, threadId],
  );

  /**
   * Route a finished utterance. When a tool is waiting on an answer, the
   * utterance is first read as a yes/no or an option pick; anything that isn't
   * clearly one of those is forwarded to the assistant as an ordinary message
   * so it can re-ask, rather than being guessed at. Approving a WhatsApp send
   * on a mis-heard "yes" is the one mistake worth designing hardest against.
   */
  const handleUtterance = useCallback(
    async (text: string) => {
      const row = pendingRow;
      if (!row) {
        await send(text);
        return;
      }

      const intent = matchVoiceIntent(text);
      if (intent === 'stop') {
        tts.stop();
        return;
      }

      try {
        if (row.status === 'awaiting_confirmation') {
          if (intent === 'approve' || intent === 'reject') {
            setPhase('thinking');
            setLastUtterance(text);
            await resolveConfirmation({
              confirmationMessageId: row._id,
              approved: intent === 'approve',
            });
            return;
          }
          await send(text);
          return;
        }

        if (row.status === 'awaiting_choice') {
          const args = (row.toolArgs ?? {}) as { options?: string[] };
          const options = Array.isArray(args.options) ? args.options : [];
          const index = matchOption(text, options);
          if (index !== null) {
            setPhase('thinking');
            setLastUtterance(text);
            await submitChoice({ choiceMessageId: row._id, choice: options[index] });
            return;
          }
          await send(text);
          return;
        }

        if (row.status === 'awaiting_questions') {
          const args = (row.toolArgs ?? {}) as {
            questions?: {
              header?: string;
              options?: { label?: string }[];
            }[];
          };
          const questions = Array.isArray(args.questions) ? args.questions : [];
          // Only single-question prompts can be answered in one breath;
          // anything richer is left to the on-screen card.
          if (questions.length === 1) {
            const question = questions[0];
            const labels = (question.options ?? [])
              .map((o) => o.label)
              .filter((l): l is string => typeof l === 'string');
            const index = matchOption(text, labels);
            setPhase('thinking');
            setLastUtterance(text);
            await submitAnswers({
              questionMessageId: row._id,
              answers: [
                index !== null
                  ? { header: question.header ?? '', selected: [labels[index]] }
                  : { header: question.header ?? '', selected: [], other: text },
              ],
            });
            return;
          }
          await send(text);
          return;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase(conversationalOpenRef.current ? 'listening' : 'idle');
      }
    },
    [pendingRow, resolveConfirmation, send, submitAnswers, submitChoice, tts],
  );

  const handleUtteranceRef = useRef(handleUtterance);
  handleUtteranceRef.current = handleUtterance;

  const onFinal = useCallback((text: string) => {
    void handleUtteranceRef.current(text);
  }, []);

  const listener = useListener({ onFinal, locale });

  // ------------------------------------------------- conversational silence

  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partialRef = useRef('');

  useEffect(() => {
    if (modeRef.current !== 'conversational') return;
    if (!listener.listening) return;
    if (listener.partial === partialRef.current) return;

    partialRef.current = listener.partial;
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (listener.partial.trim().length === 0) return;

    // The recogniser only emits a final result when it decides you're done,
    // which on some devices takes several seconds. Committing on our own
    // silence timer keeps the back-and-forth quick.
    silenceTimerRef.current = setTimeout(() => {
      const text = partialRef.current.trim();
      partialRef.current = '';
      if (text.length > 0) {
        listener.stop();
        void handleUtteranceRef.current(text);
      }
    }, SILENCE_MS);
  }, [listener, listener.partial, listener.listening]);

  useEffect(
    () => () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    },
    [],
  );

  // ------------------------------------------------------------- speaking

  // How far into the current assistant row we have already spoken.
  const spokenUpToRef = useRef(0);
  const speakingRowRef = useRef<string | null>(null);
  const speakQueueRef = useRef<Promise<void>>(Promise.resolve());

  const enqueueSpeech = useCallback(
    (text: string) => {
      speakQueueRef.current = speakQueueRef.current
        .then(() => tts.speak(text))
        .catch(() => {});
      return speakQueueRef.current;
    },
    [tts],
  );

  const finishSpeaking = useCallback(() => {
    if (modeRef.current === 'conversational' && conversationalOpenRef.current) {
      setPhase('listening');
      void listener.start({ continuous: true });
    } else {
      setPhase('idle');
    }
  }, [listener]);

  // Speak the assistant's answer as it arrives. With the device voice this
  // runs sentence-by-sentence while the reply is still streaming; MeloTTS
  // costs a round-trip per call, so it waits for the finished row.
  useEffect(() => {
    if (!autoSpeak) return;
    const row = runningRow ?? lastAssistantRow;
    if (!row) return;

    if (speakingRowRef.current !== row._id) {
      speakingRowRef.current = row._id;
      spokenUpToRef.current = 0;
    }

    const done = row.status !== 'running';
    if (!done && !tts.supportsStreaming) return;

    const speakable = toSpeakable(row.content ?? '');
    if (speakable.length === 0) {
      if (done && awaitingReplyRef.current) {
        awaitingReplyRef.current = false;
        finishSpeaking();
      }
      return;
    }

    let produced = false;
    for (;;) {
      const next = nextSpeakableChunk(speakable, spokenUpToRef.current, done);
      if (!next) break;
      spokenUpToRef.current = next.nextIndex;
      produced = true;
      setPhase('speaking');
      listener.stop();
      void enqueueSpeech(next.chunk);
    }

    if (done && awaitingReplyRef.current) {
      awaitingReplyRef.current = false;
      if (produced) {
        void speakQueueRef.current.then(finishSpeaking);
      } else {
        finishSpeaking();
      }
    }
  }, [
    autoSpeak,
    enqueueSpeech,
    finishSpeaking,
    lastAssistantRow,
    listener,
    runningRow,
    tts.supportsStreaming,
  ]);

  // Read an approval prompt out loud, once, when it appears.
  const spokenPromptRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoSpeak || !pendingRow) return;
    if (spokenPromptRef.current === pendingRow._id) return;
    spokenPromptRef.current = pendingRow._id;
    awaitingReplyRef.current = false;

    const prompt =
      pendingRow.status === 'awaiting_confirmation'
        ? describeConfirmationForSpeech(pendingRow.toolName ?? '', pendingRow.toolArgs)
        : spokenQuestion(pendingRow);
    if (prompt.length === 0) return;

    // Read the prompt, then hand the mic back so the answer can be spoken.
    void (async () => {
      setPhase('speaking');
      listener.stop();
      await enqueueSpeech(prompt);
      finishSpeaking();
    })();
  }, [autoSpeak, enqueueSpeech, finishSpeaking, listener, pendingRow]);

  // ------------------------------------------------------------- controls

  const beginPushToTalk = useCallback(() => {
    setError(null);
    tts.stop();
    setPhase('listening');
    void listener.start({ continuous: false });
  }, [listener, tts]);

  const endPushToTalk = useCallback(() => {
    // A trailing interim with no final result still counts as speech.
    const trailing = listener.partial.trim();
    listener.stop();
    if (trailing.length > 0) {
      partialRef.current = '';
      void handleUtteranceRef.current(trailing);
    } else if (listener.usingFallback) {
      // The fallback has no interim text: stop() kicks off an upload and
      // transcription that lands on `onFinal` seconds later. Show progress
      // rather than dropping straight back to idle.
      setPhase('thinking');
    } else {
      setPhase('idle');
    }
  }, [listener]);

  const setConversationalOpen = useCallback(
    (open: boolean) => {
      conversationalOpenRef.current = open;
      if (open) {
        setError(null);
        tts.stop();
        setPhase('listening');
        void listener.start({ continuous: true });
      } else {
        listener.abort();
        tts.stop();
        setPhase('idle');
      }
    },
    [listener, tts],
  );

  const interrupt = useCallback(() => {
    tts.stop();
    speakQueueRef.current = Promise.resolve();
    // Skip the rest of this row so it isn't picked up again on the next tick.
    spokenUpToRef.current = Number.MAX_SAFE_INTEGER;
    awaitingReplyRef.current = false;
    if (runningRow) {
      void requestCancelTurn({ messageId: runningRow._id }).catch(() => {});
    }
    finishSpeaking();
  }, [finishSpeaking, requestCancelTurn, runningRow, tts]);

  const sendText = useCallback(
    (text: string) => {
      void handleUtteranceRef.current(text);
    },
    [],
  );

  // Close the mic when the screen goes away.
  useEffect(
    () => () => {
      conversationalOpenRef.current = false;
    },
    [],
  );

  return {
    phase,
    partial: listener.partial,
    lastUtterance,
    volume: listener.volume,
    activeRow: pendingRow ?? runningRow,
    messages: rows,
    error: error ?? listener.error,
    micAvailable: listener.available,
    supportsConversational: listener.available && listener.supportsContinuous,
    usingFallbackStt: listener.usingFallback,
    beginPushToTalk,
    endPushToTalk,
    setConversationalOpen,
    interrupt,
    sendText,
  };
}

/** Read a choice/question prompt aloud, including its options. */
function spokenQuestion(row: Doc<'assistantMessages'>): string {
  const args = (row.toolArgs ?? {}) as {
    question?: string;
    options?: string[];
    questions?: { question?: string; options?: { label?: string }[] }[];
  };

  if (row.status === 'awaiting_choice') {
    const options = Array.isArray(args.options) ? args.options : [];
    const question = args.question ?? 'Which one?';
    return options.length > 0 ? `${question} ${options.join(', or ')}?` : question;
  }

  const questions = Array.isArray(args.questions) ? args.questions : [];
  if (questions.length === 0) return '';
  if (questions.length > 1) {
    return `${questions.length} questions for you — they're on screen.`;
  }
  const first = questions[0];
  const labels = (first.options ?? [])
    .map((o) => o.label)
    .filter((l): l is string => typeof l === 'string');
  const question = first.question ?? 'Which one?';
  return labels.length > 0 ? `${question} ${labels.join(', or ')}?` : question;
}
