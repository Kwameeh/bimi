import { useAction } from 'convex/react';
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
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { useTheme } from '@/hooks/use-theme';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

const PRESETS: Array<{ label: string; question: string }> = [
  { label: 'Summarize this chat', question: 'Summarize this entire conversation in 3-4 sentences.' },
  { label: 'Pending tasks', question: 'What are the pending tasks or open action items from this conversation?' },
  { label: 'What did I promise?', question: 'What have I promised to do, send, or follow up on in this conversation?' },
  { label: 'Find payment mention', question: 'Find the message where payment, money, or invoices were discussed and quote it.' },
];

const GROUP_PRESETS: Array<{ label: string; question: string }> = [
  {
    label: 'Action items for me',
    question:
      "From the conversation, list ONLY the specific action items that are assigned to me or that I was @-mentioned about. Skip anything assigned to other people. If there are none, say so.",
  },
];

type Props = {
  contactId: Id<'contacts'> | null;
  isGroup?: boolean;
  visible: boolean;
  onClose: () => void;
};

type ViewMode =
  | { kind: 'ask' }
  | { kind: 'result'; question: string; answer: string };

export function ChatAssistantSheet({ contactId, isGroup, visible, onClose }: Props) {
  const theme = useTheme();
  const askChat = useAction(api.messageActions.askBimiAboutChat);
  const [mode, setMode] = useState<ViewMode>({ kind: 'ask' });
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);

  const close = useCallback(() => {
    setMode({ kind: 'ask' });
    setQuestion('');
    setBusy(false);
    onClose();
  }, [onClose]);

  const submit = async (q: string) => {
    if (!contactId) return;
    const trimmed = q.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    try {
      const { answer } = await askChat({ contactId, question: trimmed });
      setMode({ kind: 'result', question: trimmed, answer });
      setQuestion('');
    } catch (err) {
      Alert.alert('Ask Bimi failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!contactId) return null;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingContainer style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={close}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.border }]}
          onPress={(e) => e.stopPropagation()}>
          {mode.kind === 'ask' ? (
            <View>
              <ThemedText type="smallBold" style={styles.title}>
                Ask Bimi about this chat
              </ThemedText>
              <View style={styles.chipRow}>
                {[...(isGroup ? GROUP_PRESETS : []), ...PRESETS].map((p) => (
                  <Pressable
                    key={p.label}
                    onPress={() => submit(p.question)}
                    disabled={busy}
                    style={[
                      styles.chip,
                      { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                      busy && { opacity: 0.5 },
                    ]}>
                    <Text style={[styles.chipText, { color: theme.text }]}>{p.label}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                placeholder="Or ask anything about this conversation..."
                placeholderTextColor={theme.textSecondary}
                value={question}
                onChangeText={setQuestion}
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
                  onPress={close}
                  style={[styles.btn, { borderColor: theme.border }]}>
                  <Text style={{ color: theme.text }}>Close</Text>
                </Pressable>
                <Pressable
                  onPress={() => submit(question)}
                  disabled={busy || question.trim().length === 0}
                  style={[
                    styles.btn,
                    styles.btnPrimary,
                    { backgroundColor: theme.primary },
                    (busy || question.trim().length === 0) && { opacity: 0.5 },
                  ]}>
                  {busy ? (
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
                {mode.question}
              </ThemedText>
              <ScrollView style={styles.resultScroll}>
                <Text style={[styles.resultBody, { color: theme.text }]}>{mode.answer}</Text>
              </ScrollView>
              <View style={styles.actionsRow}>
                <Pressable
                  onPress={() => setMode({ kind: 'ask' })}
                  style={[styles.btn, { borderColor: theme.border }]}>
                  <Text style={{ color: theme.text }}>Ask again</Text>
                </Pressable>
                <Pressable
                  onPress={close}
                  style={[
                    styles.btn,
                    styles.btnPrimary,
                    { backgroundColor: theme.primary },
                  ]}>
                  <Text style={{ color: theme.primaryText, fontWeight: '700' }}>Done</Text>
                </Pressable>
              </View>
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
    maxHeight: '75%',
  },
  title: { marginBottom: 10 },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 12, fontWeight: '600' },
  input: {
    minHeight: 88,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    textAlignVertical: 'top',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
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
  resultScroll: { maxHeight: 360 },
  resultBody: { fontSize: 15, lineHeight: 22 },
});
