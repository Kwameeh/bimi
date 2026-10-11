import { useAction, useMutation, useQuery } from 'convex/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/chat/avatar';
import { ToolStepRow } from '@/components/assistant/tool-step-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { useTheme } from '@/hooks/use-theme';
import { useInstance } from '@/lib/instance';
import { formatChatTimestamp } from '@/lib/format';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

type Tab = 'messages' | 'contacts';
type Mode = 'nl' | 'keyword';

export default function SearchScreen() {
  const theme = useTheme();
  const router = useRouter();
  const instance = useInstance();
  const params = useLocalSearchParams<{ contactId?: string }>();
  const scopedContactId = params.contactId ? (params.contactId as Id<'contacts'>) : undefined;

  const [tab, setTab] = useState<Tab>('messages');
  const [queryText, setQueryText] = useState('');
  const [mode, setMode] = useState<Mode>('nl');
  const [searchThreadId, setSearchThreadId] = useState<Id<'assistantThreads'> | null>(null);
  const [smartLoading, setSmartLoading] = useState(false);
  const trimmed = queryText.trim();

  const startSearchRun = useMutation(api.search.startSearchRun);
  const runSearch = useAction(api.search.runSearch);

  const keywordEnabled = mode === 'keyword' && trimmed.length > 0 && tab === 'messages';
  const messageResults = useQuery(
    api.messages.searchMessages,
    keywordEnabled
      ? { instance, queryText: trimmed, contactId: scopedContactId, limit: 50 }
      : 'skip',
  );

  // Live messages from the in-progress search thread (tool calls + assistant
  // streaming response).
  const searchMessages = useQuery(
    api.assistant.listMessages,
    searchThreadId ? { threadId: searchThreadId } : 'skip',
  );

  const serverBusy = useMemo(
    () => (searchMessages ?? []).some((m) => m.status === 'running'),
    [searchMessages],
  );
  const busy = smartLoading || serverBusy;

  const contactResults = useQuery(
    api.contacts.searchContacts,
    trimmed.length > 0 && tab === 'contacts' ? { instance, queryText: trimmed, limit: 50 } : 'skip',
  );

  const runSmart = async () => {
    if (trimmed.length === 0 || busy) return;
    setSmartLoading(true);
    try {
      const { threadId } = await startSearchRun({ instance, query: trimmed });
      setSearchThreadId(threadId);
      // Kick off the streaming run. Fire-and-forget — the reactive query
      // surfaces progress in real time.
      void runSearch({ threadId }).catch((err) => {
        Alert.alert('Search failed', err instanceof Error ? err.message : String(err));
      });
    } catch (err) {
      Alert.alert('Search failed', err instanceof Error ? err.message : String(err));
    } finally {
      setSmartLoading(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingContainer style={styles.safe}>
        <SafeAreaView style={styles.safe}>
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <ThemedText type="smallBold" style={{ color: theme.primary }}>
                Cancel
              </ThemedText>
            </Pressable>
            <ThemedText type="subtitle">Search</ThemedText>
            <View style={{ width: 50 }} />
          </View>
          <View style={[styles.inputWrap, { backgroundColor: theme.backgroundElement }]}>
            <TextInput
              autoFocus
              value={queryText}
              onChangeText={(t) => {
                setQueryText(t);
                if (mode === 'nl') setSearchThreadId(null);
              }}
              onSubmitEditing={mode === 'nl' && tab === 'messages' ? runSmart : undefined}
              placeholder={
                mode === 'nl'
                  ? 'Ask anything (e.g. "What did Alvin say about payment?")'
                  : scopedContactId
                    ? 'Search in this chat'
                    : 'Search'
              }
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text }]}
              returnKeyType={mode === 'nl' ? 'search' : 'default'}
            />
          </View>
          {tab === 'messages' ? (
            <View style={styles.modeRow}>
              <Pressable
                onPress={() => {
                  setMode('nl');
                  setSearchThreadId(null);
                }}
                style={[
                  styles.modeChip,
                  { borderColor: theme.border },
                  mode === 'nl' && {
                    backgroundColor: theme.primary,
                    borderColor: theme.primary,
                  },
                ]}
              >
                <Text
                  style={{
                    color: mode === 'nl' ? theme.primaryText : theme.text,
                    fontWeight: '600',
                    fontSize: 12,
                  }}
                >
                  Natural language
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setMode('keyword')}
                style={[
                  styles.modeChip,
                  { borderColor: theme.border },
                  mode === 'keyword' && {
                    backgroundColor: theme.primary,
                    borderColor: theme.primary,
                  },
                ]}
              >
                <Text
                  style={{
                    color: mode === 'keyword' ? theme.primaryText : theme.text,
                    fontWeight: '600',
                    fontSize: 12,
                  }}
                >
                  Keyword
                </Text>
              </Pressable>
              {mode === 'nl' ? (
                <Pressable
                  onPress={runSmart}
                  disabled={busy || trimmed.length === 0}
                  style={[
                    styles.askBtn,
                    { backgroundColor: theme.primary },
                    (busy || trimmed.length === 0) && { opacity: 0.5 },
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color={theme.primaryText} />
                  ) : (
                    <Text
                      style={{
                        color: theme.primaryText,
                        fontWeight: '700',
                        fontSize: 12,
                      }}
                    >
                      Ask
                    </Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <View style={styles.tabs}>
            <TabButton
              label="Messages"
              active={tab === 'messages'}
              onPress={() => setTab('messages')}
            />
            <TabButton
              label="Contacts"
              active={tab === 'contacts'}
              onPress={() => setTab('contacts')}
            />
          </View>

          {trimmed.length === 0 ? (
            <View style={styles.center}>
              <ThemedText type="small" themeColor="textSecondary">
                {mode === 'nl' && tab === 'messages'
                  ? 'Ask Bimi anything about your messages.'
                  : `Type to search ${tab}.`}
              </ThemedText>
            </View>
          ) : tab === 'messages' && mode === 'nl' ? (
            searchThreadId === null ? (
              <View style={styles.center}>
                {smartLoading ? (
                  <ActivityIndicator color={theme.primary} />
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">
                    Tap Ask to run a natural-language search.
                  </ThemedText>
                )}
              </View>
            ) : (
              <LiveSearchResult
                messages={searchMessages ?? []}
                onOpen={(contactId) =>
                  router.replace({
                    pathname: '/chat/[contactId]',
                    params: { contactId },
                  })
                }
              />
            )
          ) : tab === 'messages' ? (
            messageResults === undefined ? (
              <Centered>
                <ActivityIndicator color={theme.primary} />
              </Centered>
            ) : messageResults.length === 0 ? (
              <EmptyHint label="No matching messages." />
            ) : (
              <FlatList
                contentInsetAdjustmentBehavior="automatic"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                keyboardShouldPersistTaps="handled"
                data={messageResults}
                keyExtractor={(m) => m._id}
                ItemSeparatorComponent={() => (
                  <View style={[styles.separator, { backgroundColor: theme.border }]} />
                )}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() =>
                      router.replace({
                        pathname: '/chat/[contactId]',
                        params: { contactId: item.contactId },
                      })
                    }
                    style={({ pressed }) => [
                      styles.row,
                      pressed && { backgroundColor: theme.backgroundSelected },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <ThemedText type="small" numberOfLines={2}>
                        {item.text}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {item.fromMe ? 'You' : (item.pushName ?? item.remoteJid)} ·{' '}
                        {formatChatTimestamp(item.timestamp)}
                      </ThemedText>
                    </View>
                  </Pressable>
                )}
              />
            )
          ) : contactResults === undefined ? (
            <Centered>
              <ActivityIndicator color={theme.primary} />
            </Centered>
          ) : contactResults.length === 0 ? (
            <EmptyHint label="No matching contacts." />
          ) : (
            <FlatList
              contentInsetAdjustmentBehavior="automatic"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              keyboardShouldPersistTaps="handled"
              data={contactResults}
              keyExtractor={(c) => c._id}
              ItemSeparatorComponent={() => (
                <View style={[styles.separator, { backgroundColor: theme.border }]} />
              )}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() =>
                    router.replace({
                      pathname: '/chat/[contactId]',
                      params: { contactId: item._id },
                    })
                  }
                  style={({ pressed }) => [
                    styles.row,
                    pressed && { backgroundColor: theme.backgroundSelected },
                  ]}
                >
                  <Avatar
                    name={item.displayName}
                    isGroup={item.isGroup}
                    size={42}
                    imageUrl={item.avatarUrl ?? undefined}
                  />
                  <View style={{ flex: 1 }}>
                    <ThemedText type="smallBold">{item.displayName ?? item.remoteJid}</ThemedText>
                    {item.phoneNumber ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        {item.phoneNumber}
                      </ThemedText>
                    ) : null}
                  </View>
                </Pressable>
              )}
            />
          )}
        </SafeAreaView>
      </KeyboardAvoidingContainer>
    </ThemedView>
  );
}

function LiveSearchResult({
  messages,
  onOpen,
}: {
  messages: {
    _id: Id<'assistantMessages'>;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    toolName?: string;
    toolArgs?: unknown;
    toolResult?: unknown;
    toolCallId?: string;
    status?:
      | 'running'
      | 'done'
      | 'error'
      | 'awaiting_confirmation'
      | 'awaiting_choice'
      | 'awaiting_questions'
      | 'cancelled';
    citedMessageIds?: Id<'messages'>[];
    citedContactIds?: Id<'contacts'>[];
    threadId: Id<'assistantThreads'>;
    _creationTime: number;
  }[];
  onOpen: (contactId: Id<'contacts'>) => void;
}) {
  const theme = useTheme();

  // Drop the seed user message — it's just the query that's already in the input.
  const rows = messages.filter((m) => m.role !== 'user');

  if (rows.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.primary} />
        <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: 8 }}>
          Bimi is thinking…
        </ThemedText>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.liveScroll}>
      {rows.map((m) => {
        if (m.role === 'tool') {
          return <ToolStepRow key={m._id} row={m as any} onOpenContact={onOpen} />;
        }
        const isRunning = m.status === 'running';
        const isEmpty = !m.content || m.content.length === 0;
        return (
          <View
            key={m._id}
            style={[
              styles.answerCard,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
              },
            ]}
          >
            <ThemedText type="small" themeColor="textSecondary" style={styles.answerLabel}>
              BIMI
            </ThemedText>
            {isRunning && isEmpty ? (
              <View style={styles.thinkingRow}>
                <ActivityIndicator size="small" color={theme.textSecondary} />
                <ThemedText type="small" themeColor="textSecondary">
                  Thinking…
                </ThemedText>
              </View>
            ) : (
              <ThemedText type="small" style={{ marginTop: 4 }}>
                {m.content}
                {isRunning ? <Text style={{ color: theme.textSecondary }}>▍</Text> : null}
              </ThemedText>
            )}
            {m.citedMessageIds && m.citedMessageIds.length > 0 && !isRunning ? (
              <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: 6 }}>
                {m.citedMessageIds.length} cited message
                {m.citedMessageIds.length === 1 ? '' : 's'}.
              </ThemedText>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tabButton, { borderBottomColor: active ? theme.primary : 'transparent' }]}
    >
      <ThemedText type="smallBold" style={{ color: active ? theme.primary : theme.textSecondary }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.center}>{children}</View>;
}

function EmptyHint({ label }: { label: string }) {
  return (
    <View style={styles.center}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inputWrap: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  input: { paddingVertical: 12, fontSize: 16 },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  modeChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  askBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    marginLeft: 'auto',
    minWidth: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerCard: {
    marginHorizontal: 16,
    marginVertical: 4,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  answerLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  liveScroll: { paddingHorizontal: 4, paddingVertical: 4, gap: 4 },
  tabs: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 4 },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 6,
  },
});
