import { useAction, useMutation } from 'convex/react';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AppIcon, type AppIconName } from '@/components/ui/app-icon';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { useTheme } from '@/hooks/use-theme';
import { useInstance } from '@/lib/instance';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

type ActionKey =
  | 'summarize'
  | 'draftReply'
  | 'explain'
  | 'createTask'
  | 'addReminder'
  | 'markImportant'
  | 'askBimi';

const ACTIONS: { key: ActionKey; label: string; icon: AppIconName }[] = [
  { key: 'summarize', label: 'Summarize', icon: 'sparkles' },
  { key: 'draftReply', label: 'Draft Reply', icon: 'compose' },
  { key: 'explain', label: 'Explain', icon: 'document' },
  { key: 'createTask', label: 'Create Task', icon: 'check' },
  { key: 'addReminder', label: 'Add Reminder', icon: 'checklist' },
  { key: 'markImportant', label: 'Mark Important', icon: 'dot' },
  { key: 'askBimi', label: 'Ask Bimi', icon: 'chat' },
];

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function getOneHourFromNow(): number {
  return Date.now() + 60 * 60 * 1000;
}

type Props = {
  messageId: Id<'messages'> | null;
  visible: boolean;
  isImportant: boolean;
  messageType?: string;
  onClose: () => void;
};

type ViewMode =
  | { kind: 'menu' }
  | { kind: 'result'; title: string; body: string }
  | { kind: 'ask' };

export function MessageActionSheet({
  messageId,
  visible,
  isImportant,
  messageType,
  onClose,
}: Props) {
  const theme = useTheme();
  const instance = useInstance();
  const [mode, setMode] = useState<ViewMode>({ kind: 'menu' });
  const [busy, setBusy] = useState<ActionKey | null>(null);
  const [reactingEmoji, setReactingEmoji] = useState<string | null>(null);
  const [askText, setAskText] = useState('');

  const summarize = useAction(api.messageActions.summarize);
  const explain = useAction(api.messageActions.explain);
  const draftReply = useAction(api.messageActions.draftReplyForMessage);
  const createTask = useAction(api.messageActions.createTaskFromMessage);
  const askBimi = useAction(api.messageActions.askBimi);
  const reactToMessage = useAction(api.messages.react);
  const markImportant = useMutation(api.messageActions.markImportant);
  const createReminder = useMutation(api.reminders.create);

  const close = useCallback(() => {
    setMode({ kind: 'menu' });
    setBusy(null);
    setReactingEmoji(null);
    setAskText('');
    onClose();
  }, [onClose]);

  const handleQuickReaction = async (emoji: string) => {
    if (!messageId || reactingEmoji) return;
    setReactingEmoji(emoji);
    try {
      await reactToMessage({ messageId, emoji });
      close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('Reaction failed', msg);
    } finally {
      setReactingEmoji(null);
    }
  };

  const handleAction = async (key: ActionKey) => {
    if (busy || !messageId) return;
    setBusy(key);
    try {
      switch (key) {
        case 'summarize': {
          const { summary } = await summarize({ messageId });
          setMode({ kind: 'result', title: 'Summary', body: summary });
          break;
        }
        case 'explain': {
          const { explanation } = await explain({ messageId });
          setMode({ kind: 'result', title: 'Explanation', body: explanation });
          break;
        }
        case 'draftReply': {
          const { text } = await draftReply({ messageId });
          setMode({
            kind: 'result',
            title: 'Draft reply saved',
            body: text + '\n\nView and send from the chat header.',
          });
          break;
        }
        case 'createTask': {
          const { title } = await createTask({ messageId });
          setMode({
            kind: 'result',
            title: title ? 'Task created' : 'No task found',
            body: title || 'Bimi could not extract a task from this message.',
          });
          break;
        }
        case 'addReminder': {
          const remindAt = getOneHourFromNow();
          await createReminder({
            instance,
            sourceMessageId: messageId,
            text: 'Follow up on this message',
            remindAt,
          });
          setMode({
            kind: 'result',
            title: 'Reminder added',
            body: 'You will be reminded in 1 hour.',
          });
          break;
        }
        case 'markImportant': {
          await markImportant({ messageId, isImportant: !isImportant });
          close();
          break;
        }
        case 'askBimi': {
          if (messageType === 'documentMessage' && askText.length === 0) {
            setAskText('Summarize the key points and any deadlines in this document.');
          }
          setMode({ kind: 'ask' });
          break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('Action failed', msg);
    } finally {
      setBusy(null);
    }
  };

  const handleSubmitAsk = async () => {
    const q = askText.trim();
    if (q.length === 0 || !messageId) return;
    setBusy('askBimi');
    try {
      const { answer } = await askBimi({ messageId, question: q });
      setMode({ kind: 'result', title: 'Bimi says', body: answer });
      setAskText('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('Ask Bimi failed', msg);
    } finally {
      setBusy(null);
    }
  };

  if (!messageId) return null;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingContainer style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.border }]}
            onPress={(e) => e.stopPropagation()}
          >
            {mode.kind === 'menu' ? (
              <View>
                <ThemedText type="smallBold" style={styles.title}>
                  Quick reaction
                </ThemedText>
                <View style={styles.quickReactionsRow}>
                  {QUICK_EMOJIS.map((emoji) => (
                    <Pressable
                      key={emoji}
                      accessibilityRole="button"
                      accessibilityLabel={`React with ${emoji}`}
                      onPress={() => handleQuickReaction(emoji)}
                      disabled={reactingEmoji !== null}
                      style={({ pressed }) => [
                        styles.quickReactionBtn,
                        {
                          backgroundColor: theme.backgroundElement,
                          borderColor: theme.border,
                          opacity: pressed || reactingEmoji ? 0.6 : 1,
                        },
                      ]}
                    >
                      <Text style={styles.quickReactionEmoji}>{emoji}</Text>
                    </Pressable>
                  ))}
                </View>
                <ThemedText type="smallBold" style={[styles.title, { marginTop: 8 }]}>
                  Message actions
                </ThemedText>
                {ACTIONS.map((a) => (
                  <Pressable
                    key={a.key}
                    onPress={() => handleAction(a.key)}
                    disabled={busy !== null}
                    style={({ pressed }) => [
                      styles.row,
                      { borderTopColor: theme.border },
                      pressed && { backgroundColor: theme.backgroundSelected },
                    ]}
                  >
                    <View style={styles.iconWrap}>
                      <AppIcon name={a.icon} tintColor={theme.aiAccent} size={18} />
                    </View>
                    <Text style={[styles.label, { color: theme.text }]}>
                      {a.key === 'markImportant' && isImportant ? 'Unmark Important' : a.label}
                    </Text>
                    {busy === a.key ? (
                      <ActivityIndicator size="small" color={theme.aiAccent} />
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : mode.kind === 'ask' ? (
              <View>
                <ThemedText type="smallBold" style={styles.title}>
                  Ask Bimi about this message
                </ThemedText>
                <TextInput
                  placeholder="e.g. What is this person actually asking?"
                  placeholderTextColor={theme.textSecondary}
                  value={askText}
                  onChangeText={setAskText}
                  style={[
                    styles.input,
                    {
                      color: theme.text,
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.border,
                    },
                  ]}
                  multiline
                  autoFocus
                />
                <View style={styles.actionsRow}>
                  <Pressable
                    onPress={() => setMode({ kind: 'menu' })}
                    style={[styles.btn, { borderColor: theme.border }]}
                  >
                    <Text style={{ color: theme.text }}>Back</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleSubmitAsk}
                    disabled={busy === 'askBimi' || askText.trim().length === 0}
                    style={[
                      styles.btn,
                      styles.btnPrimary,
                      { backgroundColor: theme.primary },
                      (busy === 'askBimi' || askText.trim().length === 0) && { opacity: 0.5 },
                    ]}
                  >
                    {busy === 'askBimi' ? (
                      <ActivityIndicator color={theme.primaryText} size="small" />
                    ) : (
                      <Text style={{ color: theme.primaryText, fontWeight: '700' }}>Ask</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : (
              <View>
                <ThemedText type="smallBold" style={styles.title}>
                  {mode.title}
                </ThemedText>
                <ScrollView style={styles.resultScroll}>
                  <Text style={[styles.resultBody, { color: theme.text }]}>{mode.body}</Text>
                </ScrollView>
                <Pressable
                  onPress={close}
                  style={[
                    styles.btn,
                    styles.btnPrimary,
                    { backgroundColor: theme.primary, marginTop: 12 },
                  ]}
                >
                  <Text style={{ color: theme.primaryText, fontWeight: '700' }}>Done</Text>
                </Pressable>
              </View>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingContainer>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 28,
    maxHeight: '70%',
  },
  title: { marginBottom: 8 },
  quickReactionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    marginBottom: 6,
  },
  quickReactionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickReactionEmoji: {
    fontSize: 22,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: { width: 24, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 22, textAlign: 'center', fontSize: 16 },
  label: { flex: 1, fontSize: 15 },
  input: {
    minHeight: 88,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    textAlignVertical: 'top',
    marginTop: 4,
  },
  actionsRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { borderWidth: 0 },
  resultScroll: { maxHeight: 320 },
  resultBody: { fontSize: 15, lineHeight: 22 },
});
