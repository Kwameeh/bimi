import { useMutation, useQuery } from 'convex/react';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { AppIcon } from '@/components/ui/app-icon';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { Orb } from '@/components/voice/orb';
import { VoiceActionCard } from '@/components/voice/voice-action-card';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useInstance } from '@/lib/instance';
import { useVoiceSession, type VoiceMode } from '@/lib/speech/use-voice-session';
import type { TtsEngine } from '@/lib/speech/use-tts';

import { api } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import { toSpeakable } from '../../convex/voiceText';

const QUICK_PROMPTS = [
  'Who needs a reply?',
  "What's urgent today?",
  'Reply to Alvin and say Friday works',
  'Summarize today’s chats',
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
  const [modeOverride, setModeOverride] = useState<VoiceMode | null>(null);
  const mode: VoiceMode = modeOverride ?? prefs?.voiceMode ?? 'push_to_talk';
  const [conversationOpen, setConversationOpen] = useState(false);

  // Sheets state
  const [textModalVisible, setTextModalVisible] = useState(false);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [draftText, setDraftText] = useState('');

  const engine: TtsEngine = prefs?.voiceTtsEngine ?? 'device';
  const locale = prefs?.voiceLocale ?? 'en-US';
  const autoSpeak = prefs?.voiceAutoSpeak ?? true;

  // Start (or adopt) a thread, marking it voice-enabled
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

  const { setConversationalOpen, interrupt, pendingRow, resolveApproval, selectChoice, sendText } =
    session;

  const close = useCallback(() => {
    setConversationalOpen(false);
    interrupt();
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

  // Orb tap behavior: interrupt when speaking, or toggle when conversational
  const handleOrbPress = useCallback(() => {
    if (session.phase === 'speaking') {
      interrupt();
    } else if (mode === 'conversational') {
      toggleConversation();
    }
  }, [interrupt, mode, session.phase, toggleConversation]);

  // Handle typing submission
  const handleSubmitText = useCallback(() => {
    const trimmed = draftText.trim();
    if (!trimmed) return;
    sendText(trimmed);
    setDraftText('');
    setTextModalVisible(false);
  }, [draftText, sendText]);

  // What Bimi last said for the subtitle banner
  const spokenReply = useMemo(() => {
    const row = [...session.messages]
      .reverse()
      .find((m) => m.role === 'assistant' && (m.content ?? '').length > 0);
    return row ? toSpeakable(row.content) : '';
  }, [session.messages]);

  const busy = session.phase === 'thinking' || session.phase === 'speaking';
  const hasPendingApproval = Boolean(pendingRow);

  return (
    <View style={[styles.root, { backgroundColor: theme.background, paddingTop: insets.top + 8 }]}>
      {/* Top Header */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close voice mode"
          onPress={close}
          hitSlop={12}
          style={[styles.headerIconBtn, { backgroundColor: theme.backgroundElement }]}
        >
          <AppIcon name="close" tintColor={theme.text} size={20} />
        </Pressable>

        <ModeSwitch mode={mode} onChange={switchMode} disabled={!session.supportsConversational} />

        <View style={styles.headerRight}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View transcript history"
            onPress={() => setHistoryModalVisible(true)}
            hitSlop={12}
            style={[styles.headerIconBtn, { backgroundColor: theme.backgroundElement }]}
          >
            <AppIcon name="chat" tintColor={theme.text} size={18} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Type text instead of speaking"
            onPress={() => setTextModalVisible(true)}
            hitSlop={12}
            style={[styles.headerIconBtn, { backgroundColor: theme.backgroundElement }]}
          >
            <AppIcon name="compose" tintColor={theme.text} size={18} />
          </Pressable>
        </View>
      </View>

      {/* Center Stage: Orb and Status */}
      <View style={styles.stage}>
        <Orb
          phase={session.phase}
          volume={session.volume}
          hasPendingApproval={hasPendingApproval}
          onPress={handleOrbPress}
        />

        <VoiceStatusPill
          phase={session.phase}
          mode={mode}
          conversationOpen={conversationOpen}
          hasPendingApproval={hasPendingApproval}
          volume={session.volume}
        />
      </View>

      {/* Subtitle / Spoken Transcript Strip */}
      <ScrollView
        style={styles.transcriptScroll}
        contentContainerStyle={styles.transcriptContent}
        showsVerticalScrollIndicator={false}
      >
        {session.error ? (
          <View style={[styles.errorBox, { backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}>
            <AppIcon name="error" tintColor={theme.danger} size={16} />
            <Text style={[styles.errorText, { color: theme.danger }]}>{session.error}</Text>
          </View>
        ) : null}

        {/* Live speech feedback */}
        {session.partial.length > 0 ? (
          <Animated.View entering={FadeIn.duration(150)} style={styles.liveSpeechRow}>
            <Text style={[styles.youPartial, { color: theme.primary }]}>“{session.partial}”</Text>
          </Animated.View>
        ) : session.lastUtterance.length > 0 ? (
          <Text style={[styles.youLast, { color: theme.textSecondary }]}>
            “{session.lastUtterance}”
          </Text>
        ) : null}

        {/* Spoken reply from Bimi */}
        {spokenReply.length > 0 ? (
          <Animated.View entering={FadeInDown.duration(200)} style={styles.replyBox}>
            <Text style={[styles.bimiReply, { color: theme.text }]}>{spokenReply}</Text>
          </Animated.View>
        ) : session.lastUtterance.length === 0 ? (
          <View style={styles.promptsContainer}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.promptsTitle}>
              Tap or say to ask Bimi:
            </ThemedText>
            <View style={styles.promptChips}>
              {QUICK_PROMPTS.map((prompt) => (
                <Pressable
                  key={prompt}
                  onPress={() => sendText(prompt)}
                  accessibilityRole="button"
                  accessibilityLabel={prompt}
                  style={[
                    styles.promptChip,
                    { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                  ]}
                >
                  <AppIcon name="sparkles" tintColor={theme.primary} size={13} />
                  <Text style={[styles.promptText, { color: theme.text }]}>“{prompt}”</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* Floating Action Approval Card if pending action exists */}
      {pendingRow ? (
        <View style={styles.actionCardWrap}>
          <VoiceActionCard
            row={pendingRow}
            onApprove={() => resolveApproval(true)}
            onDeny={() => resolveApproval(false)}
            onSelectChoice={(choice) => selectChoice(choice)}
          />
        </View>
      ) : null}

      {/* Bottom Controls */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + 20 }]}>
        {!session.micAvailable ? (
          <Text style={[styles.unavailable, { color: theme.textSecondary }]}>
            This browser cannot reach a microphone. Try Chrome or type text above.
          </Text>
        ) : session.phase === 'speaking' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tap to interrupt"
            onPress={interrupt}
            style={[
              styles.interruptBtn,
              { borderColor: theme.border, backgroundColor: theme.backgroundElement },
            ]}
          >
            <AppIcon name="stop" tintColor={theme.danger} size={18} />
            <Text style={[styles.interruptText, { color: theme.text }]}>Tap to cut in</Text>
          </Pressable>
        ) : mode === 'conversational' ? (
          <View style={styles.micWrap}>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: conversationOpen }}
              accessibilityLabel={
                conversationOpen ? 'Stop the conversation' : 'Start the conversation'
              }
              onPress={toggleConversation}
              style={[
                styles.mainMicBtn,
                {
                  backgroundColor: conversationOpen ? theme.primary : theme.backgroundElement,
                  borderColor: conversationOpen ? theme.primary : theme.border,
                  shadowColor: conversationOpen ? theme.primary : 'transparent',
                },
              ]}
            >
              {busy ? (
                <ActivityIndicator color={conversationOpen ? theme.primaryText : theme.text} />
              ) : (
                <AppIcon
                  name={conversationOpen ? 'waveform' : 'mic'}
                  tintColor={conversationOpen ? theme.primaryText : theme.text}
                  size={32}
                />
              )}
            </Pressable>
            {conversationOpen ? (
              <Animated.View
                entering={FadeIn.duration(200)}
                exiting={FadeOut.duration(200)}
                style={[styles.micActiveIndicator, { backgroundColor: '#10B981' }]}
              />
            ) : null}
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Hold to talk"
            onPressIn={session.beginPushToTalk}
            onPressOut={session.endPushToTalk}
            disabled={busy}
            style={[
              styles.mainMicBtn,
              {
                backgroundColor:
                  session.phase === 'listening' ? theme.primary : theme.backgroundElement,
                borderColor: session.phase === 'listening' ? theme.primary : theme.border,
                shadowColor: session.phase === 'listening' ? theme.primary : 'transparent',
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
                size={32}
              />
            )}
          </Pressable>
        )}

        <Text style={[styles.controlHint, { color: theme.textSecondary }]}>
          {controlHint(
            mode,
            session.phase,
            conversationOpen,
            session.usingFallbackStt,
            hasPendingApproval,
          )}
        </Text>
      </View>

      {/* Text Fallback Modal Sheet */}
      <Modal
        visible={textModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setTextModalVisible(false)}
      >
        <KeyboardAvoidingContainer style={styles.modalBackdrop}>
          <Pressable style={styles.modalDismissArea} onPress={() => setTextModalVisible(false)} />
          <View
            style={[
              styles.modalSheet,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Type to Bimi</Text>
              <Pressable onPress={() => setTextModalVisible(false)} hitSlop={12}>
                <AppIcon name="close" tintColor={theme.textSecondary} size={20} />
              </Pressable>
            </View>
            <TextInput
              value={draftText}
              onChangeText={setDraftText}
              placeholder="Ask anything or respond to an action…"
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.modalInput,
                {
                  color: theme.text,
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
              autoFocus
              returnKeyType="send"
              onSubmitEditing={handleSubmitText}
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={handleSubmitText}
                disabled={draftText.trim().length === 0}
                style={[
                  styles.modalSendBtn,
                  { backgroundColor: theme.primary },
                  draftText.trim().length === 0 && { opacity: 0.5 },
                ]}
              >
                <AppIcon name="send" tintColor={theme.primaryText} size={16} />
                <Text style={[styles.modalSendText, { color: theme.primaryText }]}>
                  Send to Voice
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingContainer>
      </Modal>

      {/* Transcript History Modal Sheet */}
      <Modal
        visible={historyModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setHistoryModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={styles.modalDismissArea}
            onPress={() => setHistoryModalVisible(false)}
          />
          <View
            style={[
              styles.modalSheet,
              styles.historySheet,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Session Transcript</Text>
              <Pressable onPress={() => setHistoryModalVisible(false)} hitSlop={12}>
                <AppIcon name="close" tintColor={theme.textSecondary} size={20} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.historyList}
              contentContainerStyle={styles.historyListContent}
            >
              {session.messages.length === 0 ? (
                <Text style={[styles.historyEmpty, { color: theme.textSecondary }]}>
                  No spoken messages yet in this session.
                </Text>
              ) : (
                session.messages.map((m: Doc<'assistantMessages'>) => (
                  <View
                    key={m._id}
                    style={[
                      styles.historyMessageRow,
                      m.role === 'user' ? styles.historyUserRow : styles.historyBimiRow,
                    ]}
                  >
                    <View
                      style={[
                        styles.historyBubble,
                        m.role === 'user'
                          ? { backgroundColor: theme.primary }
                          : { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                      ]}
                    >
                      <Text
                        style={[
                          styles.historyText,
                          { color: m.role === 'user' ? theme.primaryText : theme.text },
                        ]}
                      >
                        {m.content}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** Dynamic Equalizer / Status Pill */
function VoiceStatusPill({
  phase,
  mode,
  conversationOpen,
  hasPendingApproval,
  volume,
}: {
  phase: string;
  mode: VoiceMode;
  conversationOpen: boolean;
  hasPendingApproval: boolean;
  volume: number;
}) {
  const theme = useTheme();

  const config = useMemo(() => {
    if (hasPendingApproval) {
      return {
        label: 'Approval Needed',
        color: '#D97706',
        bg: 'rgba(245, 158, 11, 0.14)',
        border: 'rgba(245, 158, 11, 0.4)',
        icon: 'sparkles' as const,
      };
    }
    switch (phase) {
      case 'listening':
        return {
          label: 'Listening…',
          color: theme.primary,
          bg: `${theme.primary}18`,
          border: `${theme.primary}40`,
          icon: 'waveform' as const,
        };
      case 'thinking':
        return {
          label: 'Thinking…',
          color: '#8B5CF6',
          bg: 'rgba(139, 92, 246, 0.16)',
          border: 'rgba(139, 92, 246, 0.4)',
          icon: 'sparkles' as const,
        };
      case 'speaking':
        return {
          label: 'Speaking • Tap to cut in',
          color: theme.aiAccent,
          bg: `${theme.aiAccent}18`,
          border: `${theme.aiAccent}40`,
          icon: 'waveform' as const,
        };
      default:
        return {
          label: mode === 'conversational' && !conversationOpen ? 'Tap mic to connect' : 'Ready',
          color: theme.textSecondary,
          bg: theme.backgroundElement,
          border: theme.border,
          icon: 'dot' as const,
        };
    }
  }, [conversationOpen, hasPendingApproval, mode, phase, theme]);

  return (
    <View style={[styles.statusPill, { backgroundColor: config.bg, borderColor: config.border }]}>
      {phase === 'listening' ? (
        <SoundWaveBars volume={volume} color={config.color} />
      ) : (
        <AppIcon name={config.icon} tintColor={config.color} size={14} />
      )}
      <Text style={[styles.statusText, { color: config.color }]}>{config.label}</Text>
    </View>
  );
}

/** Animated 4-bar equalizer */
function SoundWaveBars({ volume, color }: { volume: number; color: string }) {
  const bar1 = useSharedValue(0.4);
  const bar2 = useSharedValue(0.7);
  const bar3 = useSharedValue(0.5);

  useEffect(() => {
    bar1.value = withRepeat(
      withSequence(
        withTiming(0.9, { duration: 240, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.3, { duration: 240, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
    bar2.value = withRepeat(
      withSequence(
        withTiming(0.2, { duration: 320, easing: Easing.inOut(Easing.sin) }),
        withTiming(1.0, { duration: 320, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
    bar3.value = withRepeat(
      withSequence(
        withTiming(0.8, { duration: 280, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.4, { duration: 280, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
  }, [bar1, bar2, bar3]);

  const style1 = useAnimatedStyle(() => ({
    height: Math.max(4, bar1.value * 14 * (0.6 + volume * 0.8)),
  }));
  const style2 = useAnimatedStyle(() => ({
    height: Math.max(4, bar2.value * 16 * (0.6 + volume * 0.8)),
  }));
  const style3 = useAnimatedStyle(() => ({
    height: Math.max(4, bar3.value * 12 * (0.6 + volume * 0.8)),
  }));

  return (
    <View style={styles.equalizerWrap}>
      <Animated.View style={[styles.eqBar, { backgroundColor: color }, style1]} />
      <Animated.View style={[styles.eqBar, { backgroundColor: color }, style2]} />
      <Animated.View style={[styles.eqBar, { backgroundColor: color }, style3]} />
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
    { value: 'push_to_talk', label: 'Push to Talk' },
    { value: 'conversational', label: 'Hands-Free' },
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
              style={[
                styles.segmentText,
                { color: active ? theme.text : theme.textSecondary },
                active && { fontFamily: Fonts.sansBold },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function controlHint(
  mode: VoiceMode,
  phase: string,
  conversationOpen: boolean,
  usingFallback: boolean,
  hasPendingApproval: boolean,
): string {
  if (hasPendingApproval) return 'Say “Approve” or “Deny” to resolve';
  if (phase === 'speaking') return 'Bimi is speaking — tap anywhere to interrupt';
  if (phase === 'thinking' && usingFallback) return 'Transcribing what you said…';
  if (mode === 'conversational') {
    return conversationOpen
      ? 'Hands-free mic is live — just speak'
      : 'Tap the mic to open hands-free mode';
  }
  return usingFallback
    ? 'Hold, speak, let go — transcribed upon release'
    : 'Hold the mic to speak, release when finished';
}

const styles = StyleSheet.create({
  root: { flex: 1, maxWidth: 680, width: '100%', alignSelf: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 48,
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  segment: { flexDirection: 'row', borderRadius: 999, padding: 3 },
  segmentItem: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
  segmentText: { fontSize: 13, fontFamily: Fonts.sansMedium },
  stage: { alignItems: 'center', justifyContent: 'center', paddingTop: 8, paddingBottom: 4 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: -16,
  },
  statusText: {
    fontSize: 13,
    fontFamily: Fonts.sansSemiBold,
  },
  equalizerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2.5,
    height: 14,
  },
  eqBar: {
    width: 2.5,
    borderRadius: 2,
  },
  transcriptScroll: { flex: 1 },
  transcriptContent: { paddingHorizontal: 24, paddingVertical: 12, gap: 12 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 10,
  },
  errorText: { fontSize: 13, fontFamily: Fonts.sansMedium, flex: 1 },
  liveSpeechRow: {
    alignItems: 'center',
  },
  youPartial: {
    fontSize: 16,
    fontFamily: Fonts.sansMedium,
    textAlign: 'center',
    lineHeight: 22,
  },
  youLast: {
    fontSize: 15,
    fontFamily: Fonts.sans,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  replyBox: {
    paddingHorizontal: 8,
  },
  bimiReply: {
    fontSize: 19,
    lineHeight: 28,
    textAlign: 'center',
    fontFamily: Fonts.sansSemiBold,
  },
  promptsContainer: {
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
  },
  promptsTitle: {
    textAlign: 'center',
  },
  promptChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  promptChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  promptText: {
    fontSize: 13,
    fontFamily: Fonts.sansMedium,
  },
  actionCardWrap: {
    marginBottom: 8,
  },
  controls: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  micWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainMicBtn: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 8,
  },
  micActiveIndicator: {
    position: 'absolute',
    bottom: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  interruptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  interruptText: {
    fontSize: 15,
    fontFamily: Fonts.sansSemiBold,
  },
  controlHint: {
    fontSize: 13,
    fontFamily: Fonts.sans,
    textAlign: 'center',
  },
  unavailable: {
    fontSize: 14,
    fontFamily: Fonts.sans,
    textAlign: 'center',
    lineHeight: 20,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalDismissArea: {
    flex: 1,
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    padding: 20,
    gap: 16,
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
  },
  historySheet: {
    maxHeight: '75%',
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: 17,
    fontFamily: Fonts.sansBold,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: Fonts.sans,
    minHeight: 52,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  modalSendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
  },
  modalSendText: {
    fontSize: 14,
    fontFamily: Fonts.sansBold,
  },
  historyList: {
    flex: 1,
  },
  historyListContent: {
    gap: 10,
    paddingVertical: 8,
  },
  historyEmpty: {
    textAlign: 'center',
    paddingVertical: 32,
    fontFamily: Fonts.sans,
  },
  historyMessageRow: {
    flexDirection: 'row',
  },
  historyUserRow: {
    justifyContent: 'flex-end',
  },
  historyBimiRow: {
    justifyContent: 'flex-start',
  },
  historyBubble: {
    maxWidth: '82%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  historyText: {
    fontSize: 14,
    fontFamily: Fonts.sans,
    lineHeight: 20,
  },
});
