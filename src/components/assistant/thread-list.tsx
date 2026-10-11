import { useMutation, useQuery } from 'convex/react';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AppIcon } from '@/components/ui/app-icon';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { useTheme } from '@/hooks/use-theme';

import { api } from '../../../convex/_generated/api';
import type { Doc, Id } from '../../../convex/_generated/dataModel';

type Props = {
  instance: string;
  visible: boolean;
  activeThreadId: Id<'assistantThreads'> | null;
  onSelect: (threadId: Id<'assistantThreads'>) => void;
  onCreate: () => void;
  onClose: () => void;
};

export function ThreadList({
  instance,
  visible,
  activeThreadId,
  onSelect,
  onCreate,
  onClose,
}: Props) {
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);

  // Debounce search input by 220ms.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 220);
    return () => clearTimeout(t);
  }, [search]);

  const listed = useQuery(
    api.assistant.listThreads,
    debounced.length === 0
      ? { instance, limit: 50, includeArchived }
      : 'skip',
  );
  const found = useQuery(
    api.assistant.searchThreads,
    debounced.length > 0 ? { instance, query: debounced, limit: 50 } : 'skip',
  );

  const threads = useMemo<Doc<'assistantThreads'>[] | undefined>(() => {
    if (debounced.length > 0) return found;
    return listed;
  }, [debounced, listed, found]);

  const deleteThread = useMutation(api.assistant.deleteThread);
  const setPinned = useMutation(api.assistant.setThreadPinned);
  const setArchived = useMutation(api.assistant.setThreadArchived);

  const openLongPress = (t: Doc<'assistantThreads'>) => {
    const pinned = t.pinned === true;
    const archived = t.archived === true;
    Alert.alert(t.title ?? 'Untitled', undefined, [
      {
        text: pinned ? 'Unpin' : 'Pin',
        onPress: () => setPinned({ threadId: t._id, pinned: !pinned }),
      },
      {
        text: archived ? 'Unarchive' : 'Archive',
        onPress: () => setArchived({ threadId: t._id, archived: !archived }),
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteThread({ threadId: t._id }),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingContainer style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.border }]}
          onPress={(e) => e.stopPropagation()}>
          <View style={styles.headerRow}>
            <ThemedText type="smallBold">Conversations</ThemedText>
            <Pressable
              onPress={() => {
                onCreate();
                onClose();
              }}
              style={[styles.newBtn, { backgroundColor: theme.primary }]}>
              <Text style={{ color: theme.primaryText, fontWeight: '700' }}>+ New</Text>
            </Pressable>
          </View>

          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search conversations…"
            placeholderTextColor={theme.textSecondary}
            style={[
              styles.search,
              {
                color: theme.text,
                borderColor: theme.border,
                backgroundColor: theme.backgroundElement,
              },
            ]}
          />

          <ScrollView style={{ maxHeight: 420 }}>
            {threads === undefined ? (
              <ActivityIndicator color={theme.primary} />
            ) : threads.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={{ paddingVertical: 12 }}>
                {debounced.length > 0
                  ? 'No matches.'
                  : 'No conversations yet.'}
              </ThemedText>
            ) : (
              threads.map((t) => {
                const active = t._id === activeThreadId;
                const pinned = t.pinned === true;
                const archived = t.archived === true;
                return (
                  <Pressable
                    key={t._id}
                    onPress={() => {
                      onSelect(t._id);
                      onClose();
                    }}
                    onLongPress={() => openLongPress(t)}
                    style={({ pressed }) => [
                      styles.row,
                      { borderTopColor: theme.border },
                      active && { backgroundColor: theme.backgroundSelected },
                      pressed && { opacity: 0.7 },
                    ]}>
                    <View style={{ flex: 1 }}>
                      <View style={styles.titleRow}>
                        {pinned ? (
                          <AppIcon name="dot" tintColor={theme.primary} size={8} />
                        ) : null}
                        <Text
                          style={[
                            styles.title,
                            { color: archived ? theme.textSecondary : theme.text },
                          ]}
                          numberOfLines={1}>
                          {t.title ?? 'Untitled'}
                        </Text>
                      </View>
                      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                        {new Date(t.lastMessageAt).toLocaleString()}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() =>
                        Alert.alert('Delete conversation?', t.title ?? 'Untitled', [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: () => deleteThread({ threadId: t._id }),
                          },
                        ])
                      }
                      hitSlop={8}>
                      <Text style={{ color: theme.textSecondary, fontSize: 18 }}>×</Text>
                    </Pressable>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          {debounced.length === 0 ? (
            <View style={styles.archivedRow}>
              <Text style={[styles.archivedLabel, { color: theme.textSecondary }]}>
                Show archived
              </Text>
              <Switch
                value={includeArchived}
                onValueChange={setIncludeArchived}
              />
            </View>
          ) : null}
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  newBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  search: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 14,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 14, fontWeight: '600' },
  subtitle: { fontSize: 11, marginTop: 2 },
  archivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    paddingHorizontal: 4,
  },
  archivedLabel: { fontSize: 12, fontWeight: '600' },
});
