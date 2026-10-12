import { useMutation, useQuery } from 'convex/react';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { AppIcon } from '@/components/ui/app-icon';
import { Orb } from '@/components/voice/orb';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useInstance } from '@/lib/instance';
import { useVoiceSession, type VoiceMode } from '@/lib/speech/use-voice-session';
import type { TtsEngine } from '@/lib/speech/use-tts';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { toSpeakable } from '../../convex/voiceText';

const HINTS = [
  'Who needs a reply?',
  "What's urgent today?",
  'Reply to Alvin and say Friday works',
  'Check on my mum',
];

export default function VoiceScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const instance = useInstance();
  const params = useLocalSearchParams<{ threadId?: string }>();

  const prefs = useQuery(api.userPreferences.get, { instance });
  const createThread = useMutation(api.assistant.createThread);
  const setThreadVoice = useMutation(api.assistant.setThreadVoice);

  const [threadId, setThreadId] = useState<Id<'assistantThreads'> | null>(
    (params.threadId as Id<'assistantThreads'> | undefined) ?? null,
  );
  // Preferences load async, so the mode is derived from the saved default
  // until you flip the switch here; after that the in-session choice wins.
  const [modeOverride, setModeOverride] = useState<VoiceMode | null>(null);
  const mode: VoiceMode = modeOverride ?? prefs?.voiceMode ?? 'push_to_talk';
  const [conversationOpen, setConversationOpen] = useState(false);

  const engine: TtsEngine = prefs?.voiceTtsEngine ?? 'device';
  const locale = prefs?.voiceLocale ?? 'en-US';
  const autoSpeak = prefs?.voiceAutoSpeak ?? true;

  // Start (or adopt) a thread, and mark it as voice-driven so every entry
  // point — send, confirm, choose — keeps the spoken answer style.
  useEffect(() => {
    let cancelled = false;
    if (threadId) {
      void setThreadVoice({ threadId, voice: true });
      return;
    }
    void createThread({ instance }).then((id) => {
      if (cancelled) return;
      setThreadId(id);
      void setThreadVoice({ threadId: id, voice: true });
    });
    return () => {
      cancelled = true;
    };
  }, [createThread, instance, setThreadVoice, threadId]);

  const session = useVoiceSession({
    threadId,
    mode,
    engine,
    locale,
    autoSpeak,
  });

  const { setConversationalOpen, interrupt } = session;

  const close = useCallback(() => {
    setConversationalOpen(false);
    interrupt();
    // Leaving voice mode returns the thread to normal markdown answers.
    if (threadId) void setThreadVoice({ threadId, voice: false });
    router.back();
  }, [interrupt, setConversationalOpen, setThreadVoice, threadId]);

  const switchMode = useCallback(
    (next: VoiceMode) => {
      setConversationalOpen(false);
      setConversationOpen(false);
      setModeOverride(next);
    },
    [setConversationalOpen],
  );

  const toggleConversation = useCallback(() => {
    const next = !conversationOpen;
    setConversationOpen(next);
    setConversationalOpen(next);
  }, [conversationOpen, setConversationalOpen]);

  // What Bimi last said, for the transcript strip.
  const spokenReply = useMemo(() => {
    const row = [...session.messages]
      .reverse()
      .find((m) => m.role === 'assistant' && (m.content ?? '').length > 0);
    return row ? toSpeakable(row.content) : '';
  }, [session.messages]);

  const status = statusLabel(session, mode, conversationOpen);
  const busy = session.phase === 'thinking' || session.phase === 'speaking';

  return (
    <View style={[styles.root, { backgroundColor: theme.background, paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close voice mode"
          onPress={close}
          hitSlop={12}
          style={styles.iconBtn}
        >
          <AppIcon name="close" tintColor={theme.textSecondary} size={22} />
        </Pressable>
        <ModeSwitch mode={mode} onChange={switchMode} disabled={!session.supportsConversational} />
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.stage}>
        <Orb phase={session.phase} volume={session.volume} />
        <ThemedText type="smallBold" style={styles.status}>
          {status}
        </ThemedText>
      </View>

      <ScrollView
        style={styles.transcript}
        contentContainerStyle={styles.transcriptContent}
        showsVerticalScrollIndicator={false}
      >
        {session.error ? (
          <Text style={[styles.error, { color: theme.danger }]}>{session.error}</Text>
        ) : null}

        {session.partial.length > 0 ? (
          <Text style={[styles.you, { color: theme.textSecondary }]}>{session.partial}</Text>
        ) : session.lastUtterance.length > 0 ? (
          <Text style={[styles.you, { color: theme.textSecondary }]}>{session.lastUtterance}</Text>
        ) : null}

        {spokenReply.length > 0 ? (
          <Text style={[styles.bimi, { color: theme.text }]}>{spokenReply}</Text>
        ) : session.lastUtterance.length === 0 ? (
          <View style={styles.hints}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.hintsTitle}>
              Try saying
            </ThemedText>
            {HINTS.map((hint) => (
              <Text key={hint} style={[styles.hint, { color: theme.textSecondary }]}>
                “{hint}”
              </Text>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.controls, { paddingBottom: insets.bottom + 20 }]}>
        {!session.micAvailable ? (
          <Text style={[styles.unavailable, { color: theme.textSecondary }]}>
            This browser can&apos;t reach a microphone for Bimi. Try Chrome, or type in the
            Assistant tab.
          </Text>
        ) : session.phase === 'speaking' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tap to interrupt"
            onPress={interrupt}
            style={[
              styles.interrupt,
              { borderColor: theme.border, backgroundColor: theme.backgroundElement },
            ]}
          >
            <AppIcon name="stop" tintColor={theme.text} size={20} />
            <Text style={[styles.interruptText, { color: theme.text }]}>Tap to interrupt</Text>
          </Pressable>
        ) : mode === 'conversational' ? (
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: conversationOpen }}
            accessibilityLabel={
              conversationOpen ? 'Stop the conversation' : 'Start the conversation'
            }
            onPress={toggleConversation}
            style={[
              styles.mic,
              {
                backgroundColor: conversationOpen ? theme.primary : theme.backgroundElement,
                borderColor: conversationOpen ? theme.primary : theme.border,
              },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={conversationOpen ? theme.primaryText : theme.text} />
            ) : (
              <AppIcon
                name={conversationOpen ? 'waveform' : 'mic'}
                tintColor={conversationOpen ? theme.primaryText : theme.text}
                size={30}
              />
            )}
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Hold to talk"
            onPressIn={session.beginPushToTalk}
            onPressOut={session.endPushToTalk}
            disabled={busy}
            style={[
              styles.mic,
              {
                backgroundColor:
                  session.phase === 'listening' ? theme.primary : theme.backgroundElement,
                borderColor: session.phase === 'listening' ? theme.primary : theme.border,
              },
              busy && { opacity: 0.5 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={theme.text} />
            ) : (
              <AppIcon
                name="mic"
                tintColor={session.phase === 'listening' ? theme.primaryText : theme.text}
                size={30}
              />
            )}
          </Pressable>
        )}

        <ThemedText type="small" themeColor="textSecondary" style={styles.controlHint}>
          {controlHint(mode, session.phase, conversationOpen, session.usingFallbackStt)}
        </ThemedText>
      </View>
    </View>
  );
}

function ModeSwitch({
  mode,
  onChange,
  disabled,
}: {
  mode: VoiceMode;
  onChange: (mode: VoiceMode) => void;
  disabled: boolean;
}) {
  const theme = useTheme();
  const options: { value: VoiceMode; label: string }[] = [
    { value: 'push_to_talk', label: 'Hold' },
    { value: 'conversational', label: 'Conversation' },
  ];

  return (
    <View style={[styles.segment, { backgroundColor: theme.backgroundElement }]}>
      {options.map((option) => {
        const active = option.value === mode;
        const blocked = disabled && option.value === 'conversational';
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: blocked }}
            disabled={blocked}
            onPress={() => onChange(option.value)}
            style={[
              styles.segmentItem,
              active && { backgroundColor: theme.background },
              blocked && { opacity: 0.4 },
            ]}
          >
            <Text
              style={[styles.segmentText, { color: active ? theme.text : theme.textSecondary }]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function statusLabel(
  session: ReturnType<typeof useVoiceSession>,
  mode: VoiceMode,
  conversationOpen: boolean,
): string {
  switch (session.phase) {
    case 'listening':
      return 'Listening…';
    case 'thinking':
      return 'Thinking…';
    case 'speaking':
      return 'Speaking';
    default:
      if (mode === 'conversational' && !conversationOpen) return 'Tap to start talking';
      return 'Ready';
  }
}

function controlHint(
  mode: VoiceMode,
  phase: string,
  conversationOpen: boolean,
  usingFallback: boolean,
): string {
  if (phase === 'speaking') return 'Bimi is talking — tap to cut in';
  if (phase === 'thinking' && usingFallback) return 'Transcribing what you said…';
  if (mode === 'conversational') {
    return conversationOpen ? 'Mic is open — just talk' : 'Tap the mic to open a conversation';
  }
  return usingFallback
    ? 'Hold, speak, let go — transcribed after you release'
    : 'Hold the mic, speak, then let go';
}

const styles = StyleSheet.create({
  root: { flex: 1, maxWidth: 680, width: '100%', alignSelf: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  segment: { flexDirection: 'row', borderRadius: 999, padding: 3 },
  segmentItem: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
  segmentText: { fontSize: 13, fontFamily: Fonts.sansSemiBold },
  stage: { alignItems: 'center', justifyContent: 'center', paddingTop: 8 },
  status: { marginTop: -18 },
  transcript: { flex: 1 },
  transcriptContent: { paddingHorizontal: 28, paddingBottom: 12, gap: 10 },
  you: { fontSize: 15, textAlign: 'center', fontStyle: 'italic', fontFamily: Fonts.sans },
  bimi: { fontSize: 18, lineHeight: 26, textAlign: 'center', fontFamily: Fonts.sansSemiBold },
  error: { fontSize: 14, textAlign: 'center', fontFamily: Fonts.sans },
  hints: { alignItems: 'center', gap: 6, marginTop: 8 },
  hintsTitle: { marginBottom: 2 },
  hint: { fontSize: 15, textAlign: 'center', fontFamily: Fonts.sans },
  controls: { alignItems: 'center', gap: 12, paddingHorizontal: 24 },
  mic: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  interrupt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 22,
    paddingVertical: 18,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  interruptText: { fontSize: 16, fontFamily: Fonts.sansSemiBold },
  controlHint: { textAlign: 'center', fontFamily: Fonts.sans },
  unavailable: { fontSize: 14, textAlign: 'center', lineHeight: 20, fontFamily: Fonts.sans },
});
