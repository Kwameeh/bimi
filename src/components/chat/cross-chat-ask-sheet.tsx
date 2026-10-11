import { useAction, useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
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

type LiveSections = {
  urgent: Array<{ messageId: Id<'messages'>; contactId: Id<'contacts'>; contactName?: string; preview: string }>;
  needsReply: Array<{ messageId: Id<'messages'>; contactId: Id<'contacts'>; contactName?: string; preview: string }>;
  meetings: Array<{ messageId: Id<'messages'>; contactId: Id<'contacts'>; contactName?: string; preview: string }>;
  documents: Array<{ messageId: Id<'messages'>; contactId: Id<'contacts'>; contactName?: string; fileName?: string }>;
  autoReplied: Array<{ messageId: Id<'messages'>; contactId: Id<'contacts'>; contactName?: string; preview: string }>;
  fyi: Array<{ messageId: Id<'messages'>; contactId: Id<'contacts'>; contactName?: string; preview: string }>;
};

type PresetKey = 'missed_today' | 'since_opened' | 'needs_reply' | 'deadlines' | 'trends';

const DAY_MS = 24 * 60 * 60 * 1000;

type Props = {
  instance: string;
  visible: boolean;
  onClose: () => void;
};

type ViewMode =
  | { kind: 'ask' }
  | { kind: 'sections'; title: string; data: LiveSections }
  | { kind: 'text'; title: string; answer: string };

export function CrossChatAskSheet({ instance, visible, onClose }: Props) {
  const theme = useTheme();
  const router = useRouter();
  const askMissed = useAction(api.summaries.askMissedSummary);
  const askAcross = useAction(api.summaries.askAcrossChats);
  const pref = useQuery(api.userPreferences.get, { instance });

  const [mode, setMode] = useState<ViewMode>({ kind: 'ask' });
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const close = useCallback(() => {
    setMode({ kind: 'ask' });
    setQuestion('');
    setBusy(null);
    onClose();
  }, [onClose]);

  const openChat = (contactId: Id<'contacts'>) => {
    close();
    router.push({ pathname: '/chat/[contactId]', params: { contactId } });
  };

  const runPreset = async (key: PresetKey) => {
    if (busy) return;
    setBusy(key);
    try {
      if (key === 'missed_today') {
        const data = (await askMissed({
          instance,
          sinceMs: Date.now() - DAY_MS,
        })) as LiveSections;
        setMode({ kind: 'sections', title: "What you missed today", data });
      } else if (key === 'since_opened') {
        const sinceMs = pref?.lastOpenedAt ?? Date.now() - DAY_MS;
        const data = (await askMissed({ instance, sinceMs })) as LiveSections;
        setMode({ kind: 'sections', title: 'Since you last opened', data });
      } else if (key === 'needs_reply') {
        const data = (await askMissed({
          instance,
          sinceMs: Date.now() - DAY_MS,
        })) as LiveSections;
        setMode({
          kind: 'sections',
          title: 'Needs your reply',
          data: {
            urgent: [],
            needsReply: data.needsReply,
            meetings: [],
            documents: [],
            autoReplied: [],
            fyi: [],
          },
        });
      } else if (key === 'deadlines') {
        const data = (await askMissed({
          instance,
          sinceMs: Date.now() - DAY_MS,
        })) as LiveSections;
        setMode({
          kind: 'sections',
          title: 'Deadlines today',
          data: {
            urgent: data.urgent,
            needsReply: [],
            meetings: data.meetings,
            documents: [],
            autoReplied: [],
            fyi: [],
          },
        });
      } else if (key === 'trends') {
        const { answer } = await askAcross({
          instance,
          question: 'What patterns or recurring topics do you notice in recent messages?',
        });
        setMode({ kind: 'text', title: 'Trends in recent messages', answer });
      }
    } catch (err) {
      Alert.alert('Ask Bimi failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const submitQuestion = async () => {
    const q = question.trim();
    if (q.length === 0 || busy) return;
    setBusy('free');
    try {
      const { answer } = await askAcross({ instance, question: q });
      setMode({ kind: 'text', title: q, answer });
      setQuestion('');
    } catch (err) {
      Alert.alert('Ask Bimi failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const renderSections = (data: LiveSections) => {
    const groups: Array<{ title: string; rows: LiveSections['needsReply'] | LiveSections['documents'] }> = [
      { title: 'Urgent', rows: data.urgent },
      { title: 'Needs reply', rows: data.needsReply },
      { title: 'Meetings', rows: data.meetings },
      { title: 'Documents', rows: data.documents },
      { title: 'Auto-replied', rows: data.autoReplied },
      { title: 'FYI', rows: data.fyi },
    ];
    const nonEmpty = groups.filter((g) => g.rows.length > 0);
    if (nonEmpty.length === 0) {
      return (
        <ThemedText type="small" themeColor="textSecondary" style={{ paddingVertical: 12 }}>
          Nothing in this window.
        </ThemedText>
      );
    }
    return (
      <View style={{ gap: 14 }}>
        {nonEmpty.map((g) => (
          <View key={g.title} style={{ gap: 6 }}>
            <ThemedText type="smallBold">{`${g.title} · ${g.rows.length}`}</ThemedText>
            {g.rows.map((r) => (
              <Pressable
                key={r.messageId}
                onPress={() => openChat(r.contactId)}
                style={({ pressed }) => [
                  styles.row,
                  { borderTopColor: theme.border, opacity: pressed ? 0.7 : 1 },
                ]}>
                <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
                  {r.contactName ?? 'Unknown'}
                </Text>
                <Text
                  style={[styles.rowSubtitle, { color: theme.textSecondary }]}
                  numberOfLines={2}>
                  {'preview' in r ? r.preview : r.fileName}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}
      </View>
    );
  };

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
                Ask Bimi about all your chats
              </ThemedText>
              <View style={styles.chipRow}>
                {[
                  { key: 'missed_today' as const, label: 'What did I miss today?' },
                  { key: 'since_opened' as const, label: 'Since I last opened' },
                  { key: 'needs_reply' as const, label: 'What needs my reply?' },
                  { key: 'deadlines' as const, label: 'Deadlines today' },
                  { key: 'trends' as const, label: 'Trends' },
                ].map((p) => (
                  <Pressable
                    key={p.key}
                    onPress={() => runPreset(p.key)}
                    disabled={busy !== null}
                    style={[
                      styles.chip,
                      { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                      busy && { opacity: 0.5 },
                    ]}>
                    {busy === p.key ? (
                      <ActivityIndicator size="small" color={theme.text} />
                    ) : (
                      <Text style={[styles.chipText, { color: theme.text }]}>{p.label}</Text>
                    )}
                  </Pressable>
                ))}
              </View>
              <TextInput
                placeholder="Or ask anything about recent messages…"
                placeholderTextColor={theme.textSecondary}
                value={question}
                onChangeText={setQuestion}
                multiline
                style={[
                  styles.input,
                  {
                    color: theme.text,
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                  },
                ]}
                autoFocus
              />
              <View style={styles.actionsRow}>
                <Pressable
                  onPress={close}
                  style={[styles.btn, { borderColor: theme.border }]}>
                  <Text style={{ color: theme.text }}>Close</Text>
                </Pressable>
                <Pressable
                  onPress={submitQuestion}
                  disabled={busy !== null || question.trim().length === 0}
                  style={[
                    styles.btn,
                    styles.btnPrimary,
                    { backgroundColor: theme.primary },
                    (busy !== null || question.trim().length === 0) && { opacity: 0.5 },
                  ]}>
                  {busy === 'free' ? (
                    <ActivityIndicator color={theme.primaryText} size="small" />
                  ) : (
                    <Text style={{ color: theme.primaryText, fontWeight: '700' }}>Ask</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold" style={styles.title}>
                {mode.title}
              </ThemedText>
              <ScrollView style={styles.resultScroll}>
                {mode.kind === 'text' ? (
                  <Text style={[styles.resultBody, { color: theme.text }]}>{mode.answer}</Text>
                ) : (
                  renderSections(mode.data)
                )}
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
    maxHeight: '85%',
  },
  title: { marginBottom: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 12, fontWeight: '600' },
  input: {
    minHeight: 80,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    textAlignVertical: 'top',
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
  resultScroll: { maxHeight: 460 },
  resultBody: { fontSize: 15, lineHeight: 22 },
  row: {
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  rowSubtitle: { fontSize: 12, marginTop: 2 },
});
