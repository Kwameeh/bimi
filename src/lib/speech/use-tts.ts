import { useAction } from 'convex/react';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { api } from '../../../convex/_generated/api';

export type TtsEngine = 'device' | 'bimi';

export type Tts = {
  /** Speak `text`. Resolves when playback finishes, is interrupted, or fails. */
  speak: (text: string) => Promise<void>;
  /** Cut off whatever is being spoken right now. */
  stop: () => void;
  isSpeaking: boolean;
  /**
   * Whether this engine is cheap enough to feed one sentence at a time while
   * the reply is still streaming. The device voice is local, so it can start
   * talking on the first finished sentence; MeloTTS costs a network round-trip
   * per call, so the caller waits for the whole reply and speaks it once.
   */
  supportsStreaming: boolean;
};

/** Nothing sensible plays past this; MeloTTS also rejects very long inputs. */
const MAX_UTTERANCE_CHARS = 1800;

function base64ToPlayableUri(base64: string, mimeType: string): string {
  if (Platform.OS === 'web') {
    return `data:${mimeType};base64,${base64}`;
  }
  // Android's ExoPlayer does not reliably accept data: URIs, so land the clip
  // in the cache directory and play it from there. One reused filename keeps
  // the cache from growing across a long conversation.
  const file = new File(Paths.cache, 'bimi-tts.mp3');
  if (file.exists) file.delete();
  file.create();
  file.write(base64, { encoding: 'base64' });
  return file.uri;
}

/**
 * Bimi's voice.
 *
 * `device` uses the platform speech synthesiser (`expo-speech`): free, offline,
 * starts instantly and — importantly for the interrupt button — stops
 * instantly. `bimi` uses Workers AI MeloTTS through `api.voice.speak` for a
 * consistent, nicer voice at the cost of a round-trip.
 *
 * Any failure on the `bimi` path silently falls back to the device voice, so a
 * Workers AI outage degrades the voice rather than muting Bimi.
 */
export function useTts(engine: TtsEngine, locale = 'en-US'): Tts {
  const synthesize = useAction(api.voice.speak);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const playerRef = useRef<AudioPlayer | null>(null);
  // Bumped by stop(); an in-flight utterance whose token is stale resolves
  // without playing, so a cancelled request can never talk over the next one.
  const tokenRef = useRef(0);

  const releasePlayer = useCallback(() => {
    const player = playerRef.current;
    playerRef.current = null;
    if (!player) return;
    try {
      player.remove();
    } catch {
      // Already released.
    }
  }, []);

  const stop = useCallback(() => {
    tokenRef.current += 1;
    Speech.stop();
    releasePlayer();
    setIsSpeaking(false);
  }, [releasePlayer]);

  // Never leave a voice talking after the screen goes away.
  useEffect(() => stop, [stop]);

  const speakOnDevice = useCallback(
    (text: string, token: number) =>
      new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        Speech.speak(text, {
          language: locale,
          onDone: finish,
          onStopped: finish,
          onError: finish,
        });
        // Guard against a synthesiser that never fires a callback (happens on
        // some Android TTS engines) — the session would hang in `speaking`.
        const timeoutMs = 4000 + text.length * 120;
        setTimeout(() => {
          if (settled) return;
          if (tokenRef.current === token) Speech.stop();
          finish();
        }, timeoutMs);
      }),
    [locale],
  );

  const speakWithBimiVoice = useCallback(
    async (text: string, token: number): Promise<boolean> => {
      const audio = await synthesize({ text, lang: locale.slice(0, 2) });
      if (!audio) return false;
      if (tokenRef.current !== token) return true;

      const uri = base64ToPlayableUri(audio.base64, audio.mimeType);
      const player = createAudioPlayer({ uri });
      playerRef.current = player;

      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          subscription?.remove?.();
          resolve();
        };
        const subscription = player.addListener('playbackStatusUpdate', (status) => {
          if (
            status.didJustFinish ||
            (status.isLoaded &&
              !status.playing &&
              status.currentTime > 0 &&
              status.duration > 0 &&
              status.currentTime >= status.duration)
          ) {
            finish();
          }
        });
        try {
          player.play();
        } catch {
          finish();
        }
      });

      if (playerRef.current === player) releasePlayer();
      return true;
    },
    [locale, releasePlayer, synthesize],
  );

  const speak = useCallback(
    async (raw: string) => {
      const text = raw.trim().slice(0, MAX_UTTERANCE_CHARS);
      if (text.length === 0) return;

      tokenRef.current += 1;
      const token = tokenRef.current;
      setIsSpeaking(true);

      try {
        if (engine === 'bimi') {
          const played = await speakWithBimiVoice(text, token);
          if (played) return;
          // Synthesis unavailable — fall through to the device voice.
        }
        if (tokenRef.current !== token) return;
        await speakOnDevice(text, token);
      } catch (err) {
        console.warn('[tts] speak failed', err);
        if (engine === 'bimi' && tokenRef.current === token) {
          try {
            await speakOnDevice(text, token);
          } catch {
            // Give up quietly; the transcript is still on screen.
          }
        }
      } finally {
        if (tokenRef.current === token) setIsSpeaking(false);
      }
    },
    [engine, speakOnDevice, speakWithBimiVoice],
  );

  // Keep Bimi audible when the phone is on silent, and duck rather than stop
  // other audio. Best-effort: an unsupported platform just keeps its default.
  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
    }).catch(() => {});
  }, []);

  // Memoised for the same reason as the listener: this object lands in the
  // voice session's effect dependencies.
  return useMemo(
    () => ({ speak, stop, isSpeaking, supportsStreaming: engine === 'device' }),
    [engine, isSpeaking, speak, stop],
  );
}
