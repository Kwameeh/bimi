import { FlashList, type FlashListRef } from '@shopify/flash-list';
import * as Clipboard from 'expo-clipboard';
import { useAction, useMutation, useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AssistantMarkdown } from '@/components/assistant/assistant-markdown';
import { FollowUps } from '@/components/assistant/follow-ups';
import { KnowledgeSheet } from '@/components/assistant/knowledge-sheet';
import {
  MessageActionsSheet,
  type MessageAction,
} from '@/components/assistant/message-actions-sheet';
import { ModelPicker, modelLabelFor } from '@/components/assistant/model-picker';
import { PreferencesSheet } from '@/components/assistant/preferences-sheet';
import { ReasoningBlock } from '@/components/assistant/reasoning-block';
import { ScrollToBottomPill } from '@/components/assistant/scroll-to-bottom-pill';
import { ThreadList } from '@/components/assistant/thread-list';
import { ToolResultCard } from '@/components/assistant/tool-result-card';
import { ToolStepRow } from '@/components/assistant/tool-step-row';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { ThemedView } from '@/components/themed-view';
import { AppIcon } from '@/components/ui/app-icon';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useInstance } from '@/lib/instance';

import { api } from '../../../convex/_generated/api';
import type { Doc, Id } from '../../../convex/_generated/dataModel';

const PRESETS = [
  "What's my plan for today?",
  'Who needs my reply today?',
  "What's happening in my top chats?",
  'Summarize my WhatsApp today.',
  'What is urgent right now?',
  'Any meetings to handle?',
];

const NEAR_BOTTOM_PX = 80;

type RowDoc = Doc<'assistantMessages'>;

export default function AssistantScreen() {
  const theme = useTheme();
  const router = useRouter();
  const instance = useInstance();

  const [threadId, setThreadId] = useState<Id<'assistantThreads'> | null>(null);
  const [showThreadList, setShowThreadList] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [showKnowledge, setShowKnowledge] = useState(false);
  const [composer, setComposer] = useState('');
  const [sending, setSending] = useState(false);
  const [actionTarget, setActionTarget] = useState<RowDoc | null>(null);
  const [editingMessage, setEditingMessage] = useState<RowDoc | null>(null);
  const [editingDraft, setEditingDraft] = useState('');

  const createThread = useMutation(api.assistant.createThread);
  const sendMessage = useAction(api.assistant.sendMessage);
  const setThreadModel = useMutation(api.assistant.setThreadModel);
  const requestCancelTurn = useMutation(api.assistant.requestCancelTurn);
  const regenerateLastTurn = useAction(api.assistant.regenerateLastTurn);
  const editUserMessageAndRetry = useAction(api.assistant.editUserMessageAndRetry);

  const messages = useQuery(api.assistant.listMessages, threadId ? { threadId } : 'skip');
  const threads = useQuery(api.assistant.listThreads, { instance, limit: 5 });
  const currentThread = useMemo(
    () => threads?.find((t) => t._id === threadId) ?? null,
    [threads, threadId],
  );
  const currentModelId = currentThread?.modelId ?? null;

  const runningAssistantMessage = useMemo<RowDoc | null>(
    () => (messages ?? []).find((m) => m.role === 'assistant' && m.status === 'running') ?? null,
    [messages],
  );
  const serverRunning = useMemo(
    () => (messages ?? []).some((m) => m.status === 'running'),
    [messages],
  );
  const busy = sending || serverRunning;

  // The last assistant message that we might decorate with follow-ups.
  const lastAssistantMessage = useMemo<RowDoc | null>(() => {
    const arr = messages ?? [];
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].role === 'user') return null;
      if (arr[i].role === 'assistant') return arr[i];
    }
    return null;
  }, [messages]);

  // Auto-select most recent thread on first load
  useEffect(() => {
    if (!threadId && threads && threads.length > 0) {
      setThreadId(threads[0]._id);
    }
  }, [threadId, threads]);

  // Scroll state
  const listRef = useRef<FlashListRef<RowDoc>>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);
  const lastMessageCountRef = useRef(0);

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
    setUnseenCount(0);
  }, []);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distance = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const near = distance <= NEAR_BOTTOM_PX;
    setAtBottom(near);
    if (near) setUnseenCount(0);
  }, []);

  // Auto-stick when at bottom and new content lands.
  useEffect(() => {
    const arr = messages ?? [];
    if (atBottom) {
      if (arr.length > 0) {
        // queueMicrotask so the list lays out the new row first
        const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 30);
        return () => clearTimeout(t);
      }
    } else {
      // not at bottom — track new messages since the last seen
      if (arr.length > lastMessageCountRef.current) {
        setUnseenCount((n) => n + (arr.length - lastMessageCountRef.current));
      }
    }
    lastMessageCountRef.current = arr.length;
    return undefined;
  }, [messages, atBottom]);

  // Stick during streaming deltas too.
  const streamingTailLen = runningAssistantMessage?.content?.length ?? 0;
  useEffect(() => {
    if (atBottom && streamingTailLen > 0) {
      const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 30);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [streamingTailLen, atBottom]);

  const openChat = useCallback(
    (contactId: Id<'contacts'>) => {
      router.push({ pathname: '/chat/[contactId]', params: { contactId } });
    },
    [router],
  );

  const startNewThread = async (content?: string) => {
    const newId = await createThread({ instance, title: undefined });
    setThreadId(newId);
    if (content) void send(newId, content);
  };

  const send = async (tId: Id<'assistantThreads'>, content: string) => {
    setSending(true);
    setComposer('');
    try {
      await sendMessage({ threadId: tId, content });
    } catch (err) {
      Alert.alert('Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const onSubmitComposer = async () => {
    const text = composer.trim();
    if (text.length === 0 || busy) return;
    if (!threadId) {
      void startNewThread(text);
      return;
    }
    void send(threadId, text);
  };

  const onPressStop = async () => {
    if (!runningAssistantMessage) return;
    try {
      await requestCancelTurn({ messageId: runningAssistantMessage._id });
    } catch (err) {
      Alert.alert('Failed', err instanceof Error ? err.message : String(err));
    }
  };

  const onSubmitEdit = async () => {
    if (!editingMessage) return;
    const trimmed = editingDraft.trim();
    if (trimmed.length === 0) return;
    const target = editingMessage;
    setEditingMessage(null);
    setEditingDraft('');
    try {
      await editUserMessageAndRetry({
        messageId: target._id,
        content: trimmed,
      });
    } catch (err) {
      Alert.alert('Failed', err instanceof Error ? err.message : String(err));
    }
  };

  const onPickAction = async (action: MessageAction) => {
    const target = actionTarget;
    if (!target) return;
    setActionTarget(null);

    if (action.kind === 'copy') {
      try {
        await Clipboard.setStringAsync(target.content ?? '');
      } catch {
        Alert.alert('Copy failed');
      }
      return;
    }
    if (action.kind === 'regenerate' && threadId) {
      try {
        await regenerateLastTurn({ threadId });
      } catch (err) {
        Alert.alert('Failed', err instanceof Error ? err.message : String(err));
      }
      return;
    }
    if (action.kind === 'retry' && threadId) {
      // 'retry from here' on an assistant bubble → walk back to the user
      // message that preceded it, then editUserMessageAndRetry with the same
      // text (acts as: drop everything after, re-stream from there).
      const arr = messages ?? [];
      const idx = arr.findIndex((m) => m._id === target._id);
      if (idx < 0) return;
      let userIdx = idx - 1;
      while (userIdx >= 0 && arr[userIdx].role !== 'user') userIdx--;
      if (userIdx < 0) {
        Alert.alert('No user message above this to retry from.');
        return;
      }
      const userRow = arr[userIdx];
      try {
        await editUserMessageAndRetry({
          messageId: userRow._id,
          content: userRow.content,
        });
      } catch (err) {
        Alert.alert('Failed', err instanceof Error ? err.message : String(err));
      }
      return;
    }
    if (action.kind === 'edit' && target.role === 'user') {
      setEditingMessage(target);
      setEditingDraft(target.content);
      return;
    }
  };

  // Hide stream bookkeeping rows for tools that queue their own interactive
  // row (choice/question/confirmation) — the interactive row is the real one.
  const visibleMessages = (messages ?? []).filter((m) => {
    if (m.role !== 'tool') return true;
    const rs = (m.toolResult as { status?: unknown } | null | undefined)?.status;
    return !(typeof rs === 'string' && rs.startsWith('pending_'));
  });

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingContainer style={styles.safe}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <View style={styles.headerTop}>
              <View style={styles.headerLeft}>
                <Text style={[styles.headerTitle, { color: theme.text }]}>Assistant</Text>
                <View style={[styles.aiBadge, { backgroundColor: theme.backgroundElement }]}>
                  <AppIcon name="sparkles" tintColor={theme.aiAccent} size={13} />
                  <Text style={[styles.aiBadgeText, { color: theme.textSecondary }]}>AI</Text>
                </View>
              </View>
              <View style={styles.headerActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open conversation history"
                  onPress={() => setShowThreadList(true)}
                  hitSlop={6}
                  style={({ pressed }) => [
                    styles.iconBtn,
                    { borderColor: theme.border, opacity: pressed ? 0.65 : 1 },
                  ]}>
                  <AppIcon name="menu" tintColor={theme.text} size={20} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Start a new conversation"
                  onPress={() => startNewThread()}
                  hitSlop={6}
                  style={({ pressed }) => [
                    styles.iconBtn,
                    {
                      backgroundColor: theme.primary,
                      borderColor: theme.primary,
                      opacity: pressed ? 0.78 : 1,
                    },
                  ]}>
                  <AppIcon name="add" tintColor={theme.primaryText} size={22} />
                </Pressable>
              </View>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.headerTools}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Choose assistant model"
                onPress={() => threadId && setShowModelPicker(true)}
                disabled={!threadId}
                hitSlop={6}
                style={[
                  styles.modelChip,
                  {
                    borderColor: theme.border,
                    backgroundColor: theme.backgroundElement,
                  },
                  !threadId && { opacity: 0.5 },
                ]}>
                <Text
                  style={{
                    color: theme.textSecondary,
                    fontWeight: '600',
                    fontSize: 10,
                  }}
                  numberOfLines={1}>
                  {modelLabelFor(currentModelId)}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open knowledge"
                onPress={() => setShowKnowledge(true)}
                hitSlop={6}
                style={[styles.toolChip, { borderColor: theme.border }]}>
                <AppIcon name="knowledge" tintColor={theme.textSecondary} size={16} />
                <Text style={[styles.toolChipText, { color: theme.text }]}>Knowledge</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open assistant preferences"
                onPress={() => setShowPreferences(true)}
                hitSlop={6}
                style={[styles.toolChip, { borderColor: theme.border }]}>
                <AppIcon name="settings" tintColor={theme.textSecondary} size={16} />
                <Text style={[styles.toolChipText, { color: theme.text }]}>Preferences</Text>
              </Pressable>
            </ScrollView>
          </View>

          <View style={styles.listArea}>
            {threadId === null ? (
              <EmptyIntro
                title="Ask Bimi anything"
                subtitle="Urgency, replies, tasks, meetings, trends — across all your chats."
                presets={PRESETS}
                onPick={(p) => startNewThread(p)}
              />
            ) : (
              <>
                <FlashList
                  ref={listRef}
                  data={visibleMessages}
                  keyExtractor={(m) => m._id}
                  onScroll={onScroll}
                  scrollEventThrottle={50}
                  keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.listContent}
                  renderItem={({ item }) => (
                    <MessageRow
                      message={item}
                      onOpenContact={openChat}
                      onLongPress={() => setActionTarget(item)}
                      followUps={
                        item._id === lastAssistantMessage?._id && item.status === 'done'
                          ? (item.suggestedFollowUps ?? [])
                          : []
                      }
                      onPickFollowUp={(s) => {
                        if (threadId && !busy) void send(threadId, s);
                      }}
                      busy={busy}
                    />
                  )}
                  ListEmptyComponent={
                    <EmptyIntro
                      title="Start this conversation"
                      subtitle="Tap a prompt or type your own below."
                      presets={PRESETS}
                      onPick={(p) => send(threadId, p)}
                    />
                  }
                />
                <ScrollToBottomPill
                  visible={!atBottom}
                  newMessageCount={unseenCount}
                  onPress={scrollToBottom}
                />
              </>
            )}
          </View>

          {editingMessage ? (
            <View
              style={[
                styles.editBar,
                {
                  borderTopColor: theme.border,
                  backgroundColor: theme.backgroundElement,
                },
              ]}>
              <Text style={[styles.editLabel, { color: theme.textSecondary }]}>
                Editing your message — sending replaces the AI&apos;s answer.
              </Text>
              <TextInput
                value={editingDraft}
                onChangeText={setEditingDraft}
                multiline
                autoFocus
                style={[
                  styles.editInput,
                  {
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.background,
                  },
                ]}
              />
              <View style={styles.editActions}>
                <Pressable
                  onPress={() => {
                    setEditingMessage(null);
                    setEditingDraft('');
                  }}
                  style={[styles.editBtn, { borderColor: theme.border }]}>
                  <Text style={{ color: theme.text, fontWeight: '600' }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={onSubmitEdit}
                  disabled={editingDraft.trim().length === 0 || busy}
                  style={[
                    styles.editBtn,
                    { backgroundColor: theme.primary, borderWidth: 0 },
                    (editingDraft.trim().length === 0 || busy) && {
                      opacity: 0.5,
                    },
                  ]}>
                  <Text style={{ color: theme.primaryText, fontWeight: '700' }}>Resend</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          <View
            style={[
              styles.composer,
              {
                borderTopColor: theme.border,
                backgroundColor: theme.background,
              },
            ]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Talk to Bimi"
              onPress={() =>
                router.push(
                  threadId ? { pathname: '/voice', params: { threadId } } : '/voice',
                )
              }
              style={[styles.micBtn, { borderColor: theme.border }]}>
              <AppIcon name="mic" tintColor={theme.textSecondary} size={20} />
            </Pressable>
            <TextInput
              value={composer}
              onChangeText={setComposer}
              placeholder="Ask Bimi…"
              placeholderTextColor={theme.textSecondary}
              multiline
              editable
              style={[
                styles.input,
                {
                  color: theme.text,
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            />
            {busy && runningAssistantMessage ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Stop generating"
                onPress={onPressStop}
                style={[styles.sendBtn, { backgroundColor: theme.text }]}>
                <AppIcon name="stop" tintColor={theme.background} size={18} />
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                onPress={onSubmitComposer}
                disabled={busy || composer.trim().length === 0}
                style={[
                  styles.sendBtn,
                  { backgroundColor: theme.primary },
                  (busy || composer.trim().length === 0) && { opacity: 0.5 },
                ]}>
                {busy ? (
                  <ActivityIndicator color={theme.primaryText} size="small" />
                ) : (
                  <AppIcon name="send" tintColor={theme.primaryText} size={20} />
                )}
              </Pressable>
            )}
          </View>

          <ThreadList
            instance={instance}
            visible={showThreadList}
            activeThreadId={threadId}
            onSelect={(id) => setThreadId(id)}
            onCreate={() => {
              void startNewThread();
            }}
            onClose={() => setShowThreadList(false)}
          />

          <ModelPicker
            visible={showModelPicker}
            currentModelId={currentModelId}
            onSelect={async (id: string) => {
              try {
                const selectedThreadId = threadId ?? await createThread({ instance });
                await setThreadModel({ threadId: selectedThreadId, modelId: id });
                setThreadId(selectedThreadId);
              } catch (err) {
                Alert.alert('Could not change model', err instanceof Error ? err.message : String(err));
              }
            }}
            onClose={() => setShowModelPicker(false)}
          />

          <PreferencesSheet
            instance={instance}
            visible={showPreferences}
            onClose={() => setShowPreferences(false)}
          />

          <KnowledgeSheet
            instance={instance}
            visible={showKnowledge}
            onClose={() => setShowKnowledge(false)}
          />

          <MessageActionsSheet
            visible={!!actionTarget}
            role={(actionTarget?.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant'}
            onSelect={onPickAction}
            onClose={() => setActionTarget(null)}
          />
        </SafeAreaView>
      </KeyboardAvoidingContainer>
    </ThemedView>
  );
}

function EmptyIntro({
  title,
  subtitle,
  presets,
  onPick,
}: {
  title: string;
  subtitle: string;
  presets: string[];
  onPick: (preset: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.intro}>
      <View
        style={[
          styles.introBadge,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
          },
        ]}>
        <AppIcon name="sparkles" tintColor={theme.primary} size={22} />
      </View>
      <Text style={[styles.introTitle, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.introSubtitle, { color: theme.textSecondary }]}>{subtitle}</Text>
      <View style={styles.suggestionList}>
        {presets.map((p) => (
          <Pressable
            key={p}
            onPress={() => onPick(p)}
            style={({ pressed }) => [
              styles.suggestionRow,
              {
                borderColor: theme.border,
                backgroundColor: theme.backgroundElement,
              },
              pressed && { opacity: 0.6 },
            ]}>
            <Text style={[styles.suggestionText, { color: theme.text }]} numberOfLines={1}>
              {p}
            </Text>
            <AppIcon name="arrowUpRight" tintColor={theme.textSecondary} size={15} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function MessageRow({
  message,
  onOpenContact,
  onLongPress,
  followUps,
  onPickFollowUp,
  busy,
}: {
  message: RowDoc;
  onOpenContact: (contactId: Id<'contacts'>) => void;
  onLongPress: () => void;
  followUps: string[];
  onPickFollowUp: (s: string) => void;
  busy: boolean;
}) {
  const theme = useTheme();

  if (message.role === 'tool') {
    return <ToolStepRow row={message} onOpenContact={onOpenContact} />;
  }

  const isUser = message.role === 'user';
  const isRunning = message.status === 'running';
  const isEmpty = !message.content || message.content.length === 0;
  // Show the block whenever there is reasoning at all. It used to appear only
  // past 140 characters, which meant a short run rendered the block while
  // streaming and then made it disappear the instant it finished — reading as
  // the panel slamming shut on its own. It stays collapsed by default, so a
  // one-line header is the whole cost of keeping it stable.
  const reasoningText = (message.reasoning ?? '').trim();
  const showReasoning = reasoningText.length > 0;
  const cited = (message.citedMessageIds ?? []).map((mid, idx) => ({
    messageId: mid,
    contactId:
      (message.citedContactIds?.[idx] as Id<'contacts'> | undefined) ??
      (mid as unknown as Id<'contacts'>),
    contactName: null,
    preview: '',
  }));

  return (
    <View style={[styles.bubbleWrap, isUser ? styles.bubbleRight : styles.bubbleLeft]}>
      {!isUser && showReasoning ? (
        <View style={styles.assistantContent}>
          <ReasoningBlock reasoning={message.reasoning ?? ''} isStreaming={isRunning} />
        </View>
      ) : null}

      <Pressable
        onLongPress={onLongPress}
        delayLongPress={300}
        style={[
          styles.bubble,
          isUser
            ? [styles.userBubble, { backgroundColor: theme.bubbleSent }]
            : {
                backgroundColor: 'transparent',
              },
        ]}>
        {!isUser && isRunning && isEmpty ? (
          <View style={styles.thinkingRow}>
            <ActivityIndicator size="small" color={theme.textSecondary} />
            <Text
              style={[styles.bubbleText, { color: theme.bubbleReceivedText, fontStyle: 'italic' }]}>
              Thinking…
            </Text>
          </View>
        ) : isUser ? (
          <Text style={[styles.bubbleText, { color: theme.bubbleSentText }]}>
            {message.content}
          </Text>
        ) : (
          <AssistantMarkdown
            text={message.content || ''}
            variant="assistant"
            isStreaming={isRunning && !isEmpty}
            onOpenContact={onOpenContact}
          />
        )}
      </Pressable>

      {!isUser && cited.length > 0 ? (
        <ToolResultCard
          rows={cited.map((r) => ({
            messageId: r.messageId,
            contactId: r.contactId,
            contactName: null,
            preview: '',
          }))}
          onOpen={onOpenContact}
        />
      ) : null}

      {!isUser && followUps.length > 0 ? (
        <View style={{ width: '100%' }}>
          <FollowUps suggestions={followUps} onPick={onPickFollowUp} disabled={busy} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  listArea: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.three,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  headerActions: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  aiBadge: {
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  aiBadgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelChip: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 150,
  },
  headerTools: { gap: 8, paddingRight: 4 },
  toolChip: {
    height: 36,
    paddingHorizontal: 11,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toolChipText: { fontSize: 12, fontWeight: '600' },
  intro: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: Spacing.five,
    paddingTop: Spacing.six,
    alignItems: 'center',
  },
  introBadge: {
    width: 52,
    height: 52,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  introBadgeText: { fontSize: 24 },
  introTitle: { fontSize: 18, fontWeight: '700' },
  introSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 300,
  },
  suggestionList: { width: '100%', marginTop: 20, gap: 8 },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  suggestionText: { fontSize: 14, fontWeight: '600', flex: 1 },
  suggestionArrow: { fontSize: 14, fontWeight: '700' },
  listContent: {
    width: '100%',
    maxWidth: 800,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    gap: 10,
  },
  bubbleWrap: {
    width: '100%',
    maxWidth: 800,
    minWidth: 0,
    alignSelf: 'center',
    marginVertical: 2,
  },
  bubbleRight: { alignItems: 'flex-end' },
  bubbleLeft: { alignItems: 'flex-start' },
  assistantContent: { width: '100%', minWidth: 0, maxWidth: 720 },
  bubble: { minWidth: 0, maxWidth: '100%', borderRadius: 18 },
  userBubble: {
    maxWidth: 720,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomRightRadius: 5,
  },
  bubbleText: { fontSize: 15, lineHeight: 21, flexShrink: 1 },
  thinkingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editBar: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  editLabel: { fontSize: 11, fontWeight: '600' },
  editInput: {
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  editBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 15,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
