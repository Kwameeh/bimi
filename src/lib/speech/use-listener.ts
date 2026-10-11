import { useAction } from 'convex/react';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  useAudioRecorder,
} from 'expo-audio';
import { File } from 'expo-file-system';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { api } from '../../../convex/_generated/api';

export type ListenerStartOptions = {
  /** Keep the mic open across pauses. Android 13+ / iOS / Chrome only. */
  continuous?: boolean;
};

export type Listener = {
  start: (options?: ListenerStartOptions) => Promise<void>;
  stop: () => void;
  /** Drop the session without producing a final result. */
  abort: () => void;
  /** Live, still-changing transcript of the current utterance. */
  partial: string;
  /** Mic level, normalised to 0..1, for the orb. */
  volume: number;
  listening: boolean;
  /**
   * Whether the mic can be used at all. True on the recording fallback too —
   * only a device with neither a recogniser nor a microphone reports false.
   */
  available: boolean;
  /**
   * False on Android 12 and below, and on the recording fallback, where the
   * mic can't stay open and stream partial text.
   */
  supportsContinuous: boolean;
  /** True when running on the record-and-upload fallback rather than on-device. */
  usingFallback: boolean;
  error: string | null;
};

export type ListenerCallbacks = {
  /** A finished utterance. Fires on every pause in continuous mode. */
  onFinal: (text: string) => void;
  /** BCP-47 tag to recognise in, e.g. "en-US". */
  locale?: string;
};

/** `volumechange` reports roughly -2..10; map that onto 0..1 for the UI. */
function normalizeVolume(value: number): number {
  const clamped = Math.max(-2, Math.min(10, value));
  return (clamped + 2) / 12;
}

/**
 * The microphone.
 *
 * Primary path is on-device recognition via `expo-speech-recognition`: free,
 * streams interim results as you talk, and reports mic volume — all three are
 * what make conversational mode feel live rather than walkie-talkie.
 *
 * `available === false` means the device has no recogniser (an Android build
 * without Google's speech service, or Firefox/Safari on web). The voice screen
 * then falls back to recording audio and sending it to `api.voice.transcribe`,
 * which still supports push-to-talk but not conversational mode.
 */
export function useListener({ onFinal, locale = 'en-US' }: ListenerCallbacks): Listener {
  const [partial, setPartial] = useState('');
  const [volume, setVolume] = useState(0);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [onDeviceAvailable] = useState(() => {
    try {
      return ExpoSpeechRecognitionModule.isRecognitionAvailable();
    } catch {
      return false;
    }
  });

  // Fallback path: record with expo-audio and transcribe server-side through
  // AssemblyAI. No interim text and a few seconds of latency, so it only
  // supports push-to-talk — but it keeps voice working on Android builds
  // without Google's speech service, and in Firefox/Safari.
  const transcribe = useAction(api.voice.transcribe);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recordingRef = useRef(false);

  const available = onDeviceAvailable || Platform.OS !== 'web';

  // Android 12 and below cannot hold the mic open; we restart it on `end`
  // instead, which leaves a short audible gap between utterances.
  const supportsContinuous =
    onDeviceAvailable &&
    (Platform.OS !== 'android' || (Platform.Version as number) >= 33);

  const wantContinuousRef = useRef(false);
  const localeRef = useRef(locale);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);
  // Latest onFinal without making start/stop depend on it.
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const beginSession = useCallback((continuous: boolean) => {
    ExpoSpeechRecognitionModule.start({
      lang: localeRef.current,
      interimResults: true,
      continuous,
      // Prefer the on-device recogniser: no network hop, no cost, and it
      // keeps chat content off a speech vendor's servers.
      requiresOnDeviceRecognition: Platform.OS === 'android',
      volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
    });
  }, []);

  const startFallbackRecording = useCallback(async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setError('Microphone permission denied.');
      return;
    }
    setError(null);
    setPartial('');
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingRef.current = true;
      setListening(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [recorder]);

  const stopFallbackRecording = useCallback(
    async (discard: boolean) => {
      if (!recordingRef.current) return;
      recordingRef.current = false;
      setListening(false);
      try {
        await recorder.stop();
        const uri = recorder.uri;
        if (discard || !uri) return;
        const base64 = await new File(uri).base64();
        const text = (await transcribe({ base64 })).trim();
        if (text.length > 0) onFinalRef.current(text);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [recorder, transcribe],
  );

  const start = useCallback(
    async (options?: ListenerStartOptions) => {
      if (!onDeviceAvailable) {
        if (!available) {
          setError('Speech recognition is not available on this device.');
          return;
        }
        await startFallbackRecording();
        return;
      }
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setError('Microphone permission denied.');
        return;
      }

      const continuous = (options?.continuous ?? false) && supportsContinuous;
      wantContinuousRef.current = options?.continuous ?? false;
      setError(null);
      setPartial('');
      try {
        beginSession(continuous);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [available, beginSession, onDeviceAvailable, startFallbackRecording, supportsContinuous],
  );

  const stop = useCallback(() => {
    wantContinuousRef.current = false;
    if (recordingRef.current) {
      void stopFallbackRecording(false);
      return;
    }
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // Not running.
    }
  }, [stopFallbackRecording]);

  const abort = useCallback(() => {
    wantContinuousRef.current = false;
    if (recordingRef.current) {
      void stopFallbackRecording(true);
    }
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // Not running.
    }
    setPartial('');
    setVolume(0);
  }, [stopFallbackRecording]);

  useSpeechRecognitionEvent('start', () => {
    setListening(true);
  });

  useSpeechRecognitionEvent('end', () => {
    setListening(false);
    setVolume(0);
    // Android <13 drops the session after each utterance. Reopen it so a
    // conversation doesn't silently stop listening after one exchange.
    if (wantContinuousRef.current && !supportsContinuous) {
      try {
        beginSession(false);
      } catch {
        wantContinuousRef.current = false;
      }
    }
  });

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results[0]?.transcript ?? '';
    if (event.isFinal) {
      setPartial('');
      const trimmed = text.trim();
      if (trimmed.length > 0) onFinalRef.current(trimmed);
    } else {
      setPartial(text);
    }
  });

  useSpeechRecognitionEvent('volumechange', (event) => {
    setVolume(normalizeVolume(event.value));
  });

  useSpeechRecognitionEvent('error', (event) => {
    // "no-speech" just means a quiet moment — in conversational mode the
    // `end` handler restarts us, so surfacing it as an error is only noise.
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    setError(event.message || event.error);
    wantContinuousRef.current = false;
  });

  // Never leave the mic open behind us.
  useEffect(
    () => () => {
      wantContinuousRef.current = false;
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // Not running.
      }
    },
    [],
  );

  // Memoised: the voice session keeps this in effect dependency arrays, and a
  // fresh object every render would re-run the speak/silence effects
  // continuously while a reply streams in.
  return useMemo(
    () => ({
      start,
      stop,
      abort,
      partial,
      volume,
      listening,
      available,
      supportsContinuous,
      usingFallback: !onDeviceAvailable,
      error,
    }),
    [
      abort,
      available,
      error,
      listening,
      onDeviceAvailable,
      partial,
      start,
      stop,
      supportsContinuous,
      volume,
    ],
  );
}
