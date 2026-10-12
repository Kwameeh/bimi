import { FlashList, type FlashListRef } from '@shopify/flash-list';
import * as Clipboard from 'expo-clipboard';
import { useAction, useMutation, useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { AppIcon, type AppIconName } from '@/components/ui/app-icon';
import { useAlert } from '@/components/ui/custom-alert-dialog';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { ThemedView } from '@/components/themed-view';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useInstance } from '@/lib/instance';

import { api } from '../../../convex/_generated/api';
import type { Doc, Id } from '../../../convex/_generated/dataModel';

const PRESET_CARDS: {
  title: string;
  prompt: string;
  icon: AppIconName;
  desc: string;
}[] = [
  {
    title: "Today's Plan",
    prompt: "What's my plan for today?",
    icon: 'checklist',
    desc: 'Action items, meetings & reminders',
  },
  {
    title: 'Replies Needed',
    prompt: 'Who needs my reply today?',
    icon: 'chat',
    desc: 'Unread and urgent conversations',
  },
  {
    title: 'Top Chats Update',
    prompt: "What's happening in my top chats?",
    icon: 'sparkles',
    desc: 'Key highlights across active chats',
  },
  {
    title: 'WhatsApp Briefing',
    prompt: 'Summarize my WhatsApp today.',
    icon: 'newspaper',
    desc: 'Complete overview of your day',
  },
];

const NEAR_BOTTOM_PX = 80;

type RowDoc = Doc<'assistantMessages'>;

export default function AssistantScreen() {
  const theme = useTheme();
  const router = useRouter();
  const instance = useInstance();
  const { showAlert } = useAlert();

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

  const threads = useQuery(api.assistant.listThreads, { instance, limit: 30 });
  const activeThreadId = threadId ?? threads?.[0]?._id ?? null;
  const messages = useQuery(
    api.assistant.listMessages,
    activeThreadId ? { threadId: activeThreadId } : 'skip',
  );
  const currentThread = useMemo(
    () => threads?.find((t) => t._id === activeThreadId) ?? null,
    [threads, activeThreadId],
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
        const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 30);
        return () => clearTimeout(t);
      }
    } else {
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
      showAlert({
        title: 'Error',
        message: err instanceof Error ? err.message : String(err),
        icon: 'error',
      });
    } finally {
      setSending(false);
    }
  };

  const onSubmitComposer = async () => {
    const text = composer.trim();
    if (text.length === 0 || busy) return;
    if (!activeThreadId) {
      void startNewThread(text);
      return;
    }
    void send(activeThreadId, text);
  };

  const onPressStop = async () => {
    if (!runningAssistantMessage) return;
    try {
      await requestCancelTurn({ messageId: runningAssistantMessage._id });
    } catch (err) {
      showAlert({
        title: 'Error',
        message: err instanceof Error ? err.message : String(err),
        icon: 'error',
      });
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
      showAlert({
        title: 'Failed to update',
        message: err instanceof Error ? err.message : String(err),
        icon: 'error',
      });
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await Clipboard.setStringAsync(text);
    } catch {
      showAlert({ title: 'Copy failed', icon: 'error' });
    }
  };

  const handleRegenerate = async () => {
    if (!activeThreadId || busy) return;
    try {
      await regenerateLastTurn({ threadId: activeThreadId });
    } catch (err) {
      showAlert({
        title: 'Failed to regenerate',
        message: err instanceof Error ? err.message : String(err),
        icon: 'error',
      });
    }
  };

  const onPickAction = async (action: MessageAction) => {
    const target = actionTarget;
    if (!target) return;
    setActionTarget(null);

    if (action.kind === 'copy') {
      await handleCopy(target.content ?? '');
      return;
    }
    if (action.kind === 'regenerate' && activeThreadId) {
      await handleRegenerate();
      return;
    }
    if (action.kind === 'retry' && activeThreadId) {
      const arr = messages ?? [];
      const idx = arr.findIndex((m) => m._id === target._id);
      if (idx < 0) return;
      let userIdx = idx - 1;
      while (userIdx >= 0 && arr[userIdx].role !== 'user') userIdx--;
      if (userIdx < 0) {
        showAlert({
          title: 'Cannot Retry',
          message: 'No user message above this to retry from.',
          icon: 'error',
        });
        return;
      }
      const userRow = arr[userIdx];
      try {
        await editUserMessageAndRetry({
          messageId: userRow._id,
          content: userRow.content,
        });
      } catch (err) {
        showAlert({
          title: 'Failed to retry',
          message: err instanceof Error ? err.message : String(err),
          icon: 'error',
        });
      }
      return;
    }
    if (action.kind === 'edit' && target.role === 'user') {
      setEditingMessage(target);
      setEditingDraft(target.content);
      return;
    }
  };

  const visibleMessages = (messages ?? []).filter((m) => {
    if (m.role !== 'tool') return true;
    const rs = (m.toolResult as { status?: unknown } | null | undefined)?.status;
    return !(typeof rs === 'string' && rs.startsWith('pending_'));
  });

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingContainer style={styles.safe}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <View style={styles.headerTop}>
              <View style={styles.headerLeft}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open conversation history"
                  onPress={() => setShowThreadList(true)}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.iconBtn,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.border,
                      opacity: pressed ? 0.65 : 1,
                    },
                  ]}
                >
                  <AppIcon name="menu" tintColor={theme.text} size={18} />
                </Pressable>

                <View style={styles.headerTitleWrap}>
                  <Text style={[styles.headerTitle, { color: theme.text }]}>
                    {currentThread?.title ?? 'Assistant'}
                  </Text>
                  <View style={[styles.aiBadge, { backgroundColor: `${theme.aiAccent}1A` }]}>
                    <AppIcon name="sparkles" tintColor={theme.aiAccent} size={11} />
                    <Text style={[styles.aiBadgeText, { color: theme.aiAccent }]}>AI</Text>
                  </View>
                </View>
              </View>

              <View style={styles.headerActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Start a new conversation"
                  onPress={() => startNewThread()}
                  hitSlop={6}
                  style={({ pressed }) => [
                    styles.newChatBtn,
                    {
                      backgroundColor: theme.primary,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <AppIcon name="add" tintColor={theme.primaryText} size={16} />
                  <Text style={[styles.newChatText, { color: theme.primaryText }]}>New</Text>
                </Pressable>
              </View>
            </View>

            {/* Quick Actions Scroll */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.headerTools}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Choose assistant model"
                onPress={() => activeThreadId && setShowModelPicker(true)}
                disabled={!activeThreadId}
                hitSlop={6}
                style={[
                  styles.modelChip,
                  {
                    borderColor: theme.border,
                    backgroundColor: theme.backgroundElement,
                  },
                  !activeThreadId && { opacity: 0.5 },
                ]}
              >
                <AppIcon name="sparkles" tintColor={theme.primary} size={12} />
                <Text style={[styles.modelChipText, { color: theme.text }]} numberOfLines={1}>
                  {modelLabelFor(currentModelId)}
                </Text>
                <AppIcon name="chevronDown" tintColor={theme.textSecondary} size={12} />
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open knowledge base"
                onPress={() => setShowKnowledge(true)}
                hitSlop={6}
                style={[
                  styles.toolChip,
                  { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                ]}
              >
                <AppIcon name="knowledge" tintColor={theme.textSecondary} size={14} />
                <Text style={[styles.toolChipText, { color: theme.text }]}>Knowledge</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open assistant preferences"
                onPress={() => setShowPreferences(true)}
                hitSlop={6}
                style={[
                  styles.toolChip,
                  { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                ]}
              >
                <AppIcon name="settings" tintColor={theme.textSecondary} size={14} />
                <Text style={[styles.toolChipText, { color: theme.text }]}>Preferences</Text>
              </Pressable>
            </ScrollView>
          </View>

          {/* Chat List Area */}
          <View style={styles.listArea}>
            {activeThreadId === null ? (
              <EmptyIntro presets={PRESET_CARDS} onPick={(p) => startNewThread(p)} />
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
                      onCopy={() => handleCopy(item.content ?? '')}
                      onEdit={() => {
                        setEditingMessage(item);
                        setEditingDraft(item.content ?? '');
                      }}
                      onRegenerate={handleRegenerate}
                      followUps={
                        item._id === lastAssistantMessage?._id && item.status === 'done'
                          ? (item.suggestedFollowUps ?? [])
                          : []
                      }
                      onPickFollowUp={(s) => {
                        if (activeThreadId && !busy) void send(activeThreadId, s);
                      }}
                      busy={busy}
                    />
                  )}
                  ListEmptyComponent={
                    <EmptyIntro presets={PRESET_CARDS} onPick={(p) => send(activeThreadId, p)} />
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

          {/* Edit user message bar */}
          {editingMessage ? (
            <View
              style={[
                styles.editBar,
                {
                  borderTopColor: theme.border,
                  backgroundColor: theme.backgroundElement,
                },
              ]}
            >
              <Text style={[styles.editLabel, { color: theme.textSecondary }]}>
                Editing your prompt — resending will regenerate the answer.
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
                  style={[styles.editBtn, { borderColor: theme.border }]}
                >
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
                  ]}
                >
                  <Text style={{ color: theme.primaryText, fontWeight: '700' }}>Resend</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {/* Composer */}
          <View
            style={[
              styles.composerWrap,
              {
                borderTopColor: theme.border,
                backgroundColor: theme.background,
              },
            ]}
          >
            <View
              style={[
                styles.composerInputRow,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Talk to Bimi"
                onPress={() =>
                  router.push(
                    activeThreadId
                      ? { pathname: '/voice', params: { threadId: activeThreadId } }
                      : '/voice',
                  )
                }
                style={styles.micBtn}
              >
                <AppIcon name="mic" tintColor={theme.textSecondary} size={19} />
              </Pressable>

              <TextInput
                value={composer}
                onChangeText={setComposer}
                placeholder="Ask Bimi anything…"
                placeholderTextColor={theme.textSecondary}
                multiline
                editable
                style={[styles.input, { color: theme.text }]}
              />

              {busy && runningAssistantMessage ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Stop generating"
                  onPress={onPressStop}
                  style={[styles.sendBtn, { backgroundColor: theme.text }]}
                >
                  <AppIcon name="stop" tintColor={theme.background} size={16} />
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Send message"
                  onPress={onSubmitComposer}
                  disabled={busy || composer.trim().length === 0}
                  style={[
                    styles.sendBtn,
                    {
                      backgroundColor:
                        composer.trim().length > 0 ? theme.primary : `${theme.textSecondary}33`,
                    },
                    busy && { opacity: 0.5 },
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator color={theme.primaryText} size="small" />
                  ) : (
                    <AppIcon
                      name="send"
                      tintColor={
                        composer.trim().length > 0 ? theme.primaryText : theme.textSecondary
                      }
                      size={18}
                    />
                  )}
                </Pressable>
              )}
            </View>
          </View>

          {/* Modals & Sheets */}
          <ThreadList
            instance={instance}
            visible={showThreadList}
            activeThreadId={activeThreadId}
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
                const selectedThreadId = activeThreadId ?? (await createThread({ instance }));
                await setThreadModel({ threadId: selectedThreadId, modelId: id });
                setThreadId(selectedThreadId);
              } catch (err) {
                showAlert({
                  title: 'Could not change model',
                  message: err instanceof Error ? err.message : String(err),
                  icon: 'error',
                });
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
  presets,
  onPick,
}: {
  presets: typeof PRESET_CARDS;
  onPick: (preset: string) => void;
}) {
  const theme = useTheme();
  return (
    <ScrollView contentContainerStyle={styles.introScroll} showsVerticalScrollIndicator={false}>
      <View style={styles.intro}>
        <View
          style={[
            styles.introOrb,
            {
              backgroundColor: `${theme.aiAccent}1A`,
              borderColor: `${theme.aiAccent}33`,
            },
          ]}
        >
          <AppIcon name="sparkles" tintColor={theme.aiAccent} size={28} />
        </View>

        <Text style={[styles.introTitle, { color: theme.text }]}>How can I help you today?</Text>
        <Text style={[styles.introSubtitle, { color: theme.textSecondary }]}>
          Search messages, prepare replies, manage tasks and track meetings across WhatsApp.
        </Text>

        <View style={styles.cardGrid}>
          {presets.map((item) => (
            <Pressable
              key={item.title}
              onPress={() => onPick(item.prompt)}
              style={({ pressed }) => [
                styles.presetCard,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <View style={styles.presetCardHeader}>
                <View style={[styles.presetIconWrap, { backgroundColor: `${theme.primary}15` }]}>
                  <AppIcon name={item.icon} tintColor={theme.primary} size={16} />
                </View>
                <AppIcon name="arrowUpRight" tintColor={theme.textSecondary} size={14} />
              </View>
              <Text style={[styles.presetCardTitle, { color: theme.text }]}>{item.title}</Text>
              <Text
                style={[styles.presetCardDesc, { color: theme.textSecondary }]}
                numberOfLines={2}
              >
                {item.desc}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

function MessageRow({
  message,
  onOpenContact,
  onLongPress,
  onCopy,
  onEdit,
  onRegenerate,
  followUps,
  onPickFollowUp,
  busy,
}: {
  message: RowDoc;
  onOpenContact: (contactId: Id<'contacts'>) => void;
  onLongPress: () => void;
  onCopy: () => void;
  onEdit?: () => void;
  onRegenerate?: () => void;
  followUps: string[];
  onPickFollowUp: (s: string) => void;
  busy: boolean;
}) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  if (message.role === 'tool') {
    return <ToolStepRow row={message} onOpenContact={onOpenContact} />;
  }

  const isUser = message.role === 'user';
  const isRunning = message.status === 'running';
  const isEmpty = !message.content || message.content.length === 0;
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

  const handleCopyPress = () => {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View style={[styles.bubbleWrap, isUser ? styles.bubbleRight : styles.bubbleLeft]}>
      {/* Assistant Header Badge */}
      {!isUser ? (
        <View style={styles.assistantMetaRow}>
          <View
            style={[
              styles.avatarWrap,
              {
                backgroundColor: `${theme.aiAccent}1A`,
                borderColor: `${theme.aiAccent}33`,
              },
            ]}
          >
            <AppIcon name="sparkles" tintColor={theme.aiAccent} size={13} />
          </View>
          <Text style={[styles.assistantName, { color: theme.text }]}>Bimi</Text>
          {isRunning ? (
            <View style={styles.activePill}>
              <ActivityIndicator size="small" color={theme.aiAccent} />
              <Text style={[styles.activePillText, { color: theme.aiAccent }]}>Generating…</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Reasoning Block */}
      {!isUser && showReasoning ? (
        <View style={styles.assistantContent}>
          <ReasoningBlock reasoning={message.reasoning ?? ''} isStreaming={isRunning} />
        </View>
      ) : null}

      {/* Message Bubble */}
      <Pressable
        onLongPress={onLongPress}
        delayLongPress={300}
        style={[
          styles.bubble,
          isUser
            ? [
                styles.userBubble,
                {
                  backgroundColor: theme.bubbleSent,
                },
              ]
            : styles.assistantBubble,
        ]}
      >
        {!isUser && isRunning && isEmpty ? (
          <View style={styles.thinkingRow}>
            <ActivityIndicator size="small" color={theme.textSecondary} />
            <Text style={[styles.thinkingText, { color: theme.textSecondary }]}>Thinking…</Text>
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

      {/* Citations Card */}
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

      {/* Assistant Action Bar (Copy / Regenerate / More) */}
      {!isUser && !isRunning && !isEmpty ? (
        <View style={styles.actionToolbar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copied ? 'Copied to clipboard' : 'Copy answer'}
            onPress={handleCopyPress}
            hitSlop={6}
            style={({ pressed }) => [
              styles.actionPill,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <AppIcon
              name={copied ? 'check' : 'compose'}
              tintColor={copied ? '#10B981' : theme.textSecondary}
              size={13}
            />
            <Text
              style={[styles.actionPillText, { color: copied ? '#10B981' : theme.textSecondary }]}
            >
              {copied ? 'Copied' : 'Copy'}
            </Text>
          </Pressable>

          {onRegenerate ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Regenerate answer"
              onPress={onRegenerate}
              disabled={busy}
              hitSlop={6}
              style={({ pressed }) => [
                styles.actionPill,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                  opacity: pressed || busy ? 0.6 : 1,
                },
              ]}
            >
              <AppIcon name="waveform" tintColor={theme.textSecondary} size={13} />
              <Text style={[styles.actionPillText, { color: theme.textSecondary }]}>
                Regenerate
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More actions"
            onPress={onLongPress}
            hitSlop={6}
            style={({ pressed }) => [
              styles.actionPill,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <AppIcon name="settings" tintColor={theme.textSecondary} size={13} />
          </Pressable>
        </View>
      ) : null}

      {/* User Quick Actions (Edit) */}
      {isUser && onEdit ? (
        <View style={styles.userActionToolbar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit prompt"
            onPress={onEdit}
            hitSlop={6}
            style={({ pressed }) => [styles.userActionBtn, { opacity: pressed ? 0.6 : 0.8 }]}
          >
            <AppIcon name="compose" tintColor={theme.textSecondary} size={13} />
            <Text style={[styles.userActionText, { color: theme.textSecondary }]}>Edit</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Suggested Follow-Ups */}
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
  safe: { flex: 1, maxWidth: 960, width: '100%', alignSelf: 'center' },
  listArea: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.three,
    paddingTop: 10,
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
    gap: 10,
    flexShrink: 1,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: Fonts.sansBold,
    letterSpacing: -0.2,
  },
  aiBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  aiBadgeText: {
    fontSize: 10,
    fontFamily: Fonts.sansBold,
    letterSpacing: 0.3,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  newChatText: {
    fontSize: 13,
    fontFamily: Fonts.sansBold,
  },
  headerTools: {
    gap: 8,
    paddingRight: 4,
  },
  modelChip: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modelChipText: {
    fontSize: 11,
    fontFamily: Fonts.sansSemiBold,
    maxWidth: 130,
  },
  toolChip: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toolChipText: {
    fontSize: 11,
    fontFamily: Fonts.sansSemiBold,
  },
  introScroll: {
    paddingBottom: 40,
  },
  intro: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
    alignItems: 'center',
  },
  introOrb: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  introTitle: {
    fontSize: 22,
    fontFamily: Fonts.sansBold,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  introSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 380,
    fontFamily: Fonts.sans,
  },
  cardGrid: {
    width: '100%',
    marginTop: 24,
    gap: 10,
  },
  presetCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 6,
  },
  presetCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  presetIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetCardTitle: {
    fontSize: 15,
    fontFamily: Fonts.sansBold,
  },
  presetCardDesc: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    lineHeight: 16,
  },
  listContent: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
    gap: 14,
  },
  bubbleWrap: {
    width: '100%',
    maxWidth: 760,
    minWidth: 0,
    alignSelf: 'center',
    marginVertical: 2,
  },
  bubbleRight: {
    alignItems: 'flex-end',
  },
  bubbleLeft: {
    alignItems: 'flex-start',
  },
  assistantMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  avatarWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assistantName: {
    fontSize: 13,
    fontFamily: Fonts.sansBold,
    letterSpacing: -0.1,
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginLeft: 6,
  },
  activePillText: {
    fontSize: 11,
    fontFamily: Fonts.sansMedium,
  },
  assistantContent: {
    width: '100%',
    minWidth: 0,
    maxWidth: 720,
  },
  bubble: {
    minWidth: 0,
    maxWidth: '100%',
  },
  assistantBubble: {
    backgroundColor: 'transparent',
    paddingLeft: 2,
  },
  userBubble: {
    maxWidth: 620,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    borderBottomRightRadius: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: Fonts.sans,
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  thinkingText: {
    fontSize: 13,
    fontStyle: 'italic',
    fontFamily: Fonts.sans,
  },
  actionToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingLeft: 2,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionPillText: {
    fontSize: 11,
    fontFamily: Fonts.sansSemiBold,
  },
  userActionToolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 4,
    marginRight: 4,
  },
  userActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  userActionText: {
    fontSize: 11,
    fontFamily: Fonts.sansMedium,
  },
  editBar: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  editLabel: {
    fontSize: 11,
    fontFamily: Fonts.sansSemiBold,
  },
  editInput: {
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: Fonts.sans,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  editBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerWrap: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composerInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 6,
  },
  input: {
    flex: 1,
    minHeight: 38,
    maxHeight: 120,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 15,
    fontFamily: Fonts.sans,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  micBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
});
