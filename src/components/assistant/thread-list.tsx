import { useMutation, useQuery } from 'convex/react';
import React, { useEffect, useMemo, useState } from 'react';
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

import { AppIcon } from '@/components/ui/app-icon';
import { useAlert } from '@/components/ui/custom-alert-dialog';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { Fonts } from '@/constants/theme';
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

type FilterTab = 'all' | 'pinned' | 'archived';

function formatRelativeDate(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function categorizeThreads(threads: Doc<'assistantThreads'>[]) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const last7DaysStart = todayStart - 6 * 86400000;

  const pinned: Doc<'assistantThreads'>[] = [];
  const today: Doc<'assistantThreads'>[] = [];
  const yesterday: Doc<'assistantThreads'>[] = [];
  const previous7Days: Doc<'assistantThreads'>[] = [];
  const older: Doc<'assistantThreads'>[] = [];

  for (const t of threads) {
    if (t.pinned) {
      pinned.push(t);
      continue;
    }
    const time = t.lastMessageAt;
    if (time >= todayStart) {
      today.push(t);
    } else if (time >= yesterdayStart) {
      yesterday.push(t);
    } else if (time >= last7DaysStart) {
      previous7Days.push(t);
    } else {
      older.push(t);
    }
  }

  return { pinned, today, yesterday, previous7Days, older };
}

export function ThreadList({
  instance,
  visible,
  activeThreadId,
  onSelect,
  onCreate,
  onClose,
}: Props) {
  const theme = useTheme();
  const { showConfirm } = useAlert();

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<FilterTab>('all');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 200);
    return () => clearTimeout(t);
  }, [search]);

  const listed = useQuery(
    api.assistant.listThreads,
    debounced.length === 0
      ? { instance, limit: 60, includeArchived: filter === 'archived' }
      : 'skip',
  );

  const found = useQuery(
    api.assistant.searchThreads,
    debounced.length > 0 ? { instance, query: debounced, limit: 50 } : 'skip',
  );

  const allThreads = useMemo<Doc<'assistantThreads'>[] | undefined>(() => {
    if (debounced.length > 0) return found;
    return listed;
  }, [debounced, listed, found]);

  const filteredThreads = useMemo(() => {
    if (!allThreads) return undefined;
    if (debounced.length > 0) return allThreads;
    if (filter === 'pinned') return allThreads.filter((t) => t.pinned === true);
    if (filter === 'archived') return allThreads.filter((t) => t.archived === true);
    return allThreads.filter((t) => !t.archived);
  }, [allThreads, debounced, filter]);

  const deleteThread = useMutation(api.assistant.deleteThread);
  const setPinned = useMutation(api.assistant.setThreadPinned);
  const setArchived = useMutation(api.assistant.setThreadArchived);

  const handleDelete = async (t: Doc<'assistantThreads'>) => {
    const confirmed = await showConfirm({
      title: 'Delete Conversation?',
      message: `Are you sure you want to delete "${t.title ?? 'Untitled'}"? This action cannot be undone.`,
      confirmText: 'Delete',
      destructive: true,
      icon: 'error',
    });
    if (confirmed) {
      await deleteThread({ threadId: t._id });
    }
  };

  const handleTogglePin = async (t: Doc<'assistantThreads'>) => {
    await setPinned({ threadId: t._id, pinned: !t.pinned });
  };

  const handleToggleArchive = async (t: Doc<'assistantThreads'>) => {
    await setArchived({ threadId: t._id, archived: !t.archived });
  };

  const groups = useMemo(() => {
    if (!filteredThreads || debounced.length > 0) return null;
    return categorizeThreads(filteredThreads);
  }, [filteredThreads, debounced]);

  const renderThreadRow = (t: Doc<'assistantThreads'>) => {
    const active = t._id === activeThreadId;
    const isPinned = t.pinned === true;

    return (
      <Pressable
        key={t._id}
        onPress={() => {
          onSelect(t._id);
          onClose();
        }}
        style={({ pressed }) => [
          styles.row,
          {
            backgroundColor: active
              ? theme.backgroundSelected
              : pressed
                ? theme.backgroundElement
                : 'transparent',
            borderColor: active ? `${theme.primary}40` : 'transparent',
          },
        ]}
      >
        <View style={styles.rowMain}>
          <View style={styles.titleLine}>
            {active ? (
              <View style={[styles.activeIndicator, { backgroundColor: theme.primary }]} />
            ) : null}
            {isPinned ? (
              <AppIcon name="sparkles" tintColor={theme.aiAccent} size={13} />
            ) : (
              <AppIcon name="chat" tintColor={theme.textSecondary} size={14} />
            )}
            <Text
              style={[
                styles.rowTitle,
                {
                  color: t.archived ? theme.textSecondary : theme.text,
                  fontWeight: active ? '700' : '600',
                },
              ]}
              numberOfLines={1}
            >
              {t.title ?? 'Untitled conversation'}
            </Text>
          </View>

          <Text style={[styles.rowTime, { color: theme.textSecondary }]}>
            {formatRelativeDate(t.lastMessageAt)}
          </Text>
        </View>

        {/* Quick action buttons */}
        <View style={styles.rowActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isPinned ? 'Unpin' : 'Pin'}
            onPress={() => handleTogglePin(t)}
            hitSlop={6}
            style={({ pressed }) => [styles.actionBtn, { opacity: pressed ? 0.6 : 0.8 }]}
          >
            <AppIcon
              name="sparkles"
              tintColor={isPinned ? theme.aiAccent : theme.textSecondary}
              size={14}
            />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.archived ? 'Unarchive' : 'Archive'}
            onPress={() => handleToggleArchive(t)}
            hitSlop={6}
            style={({ pressed }) => [styles.actionBtn, { opacity: pressed ? 0.6 : 0.8 }]}
          >
            <AppIcon
              name="document"
              tintColor={t.archived ? theme.primary : theme.textSecondary}
              size={14}
            />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete"
            onPress={() => handleDelete(t)}
            hitSlop={6}
            style={({ pressed }) => [styles.actionBtn, { opacity: pressed ? 0.6 : 0.8 }]}
          >
            <AppIcon name="close" tintColor={theme.textSecondary} size={15} />
          </Pressable>
        </View>
      </Pressable>
    );
  };

  const renderSection = (title: string, items: Doc<'assistantThreads'>[]) => {
    if (items.length === 0) return null;
    return (
      <View key={title} style={styles.sectionWrap}>
        <Text style={[styles.sectionHeader, { color: theme.textSecondary }]}>{title}</Text>
        <View style={styles.sectionList}>{items.map(renderThreadRow)}</View>
      </View>
    );
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingContainer style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable
            style={[
              styles.sheet,
              {
                backgroundColor: theme.background,
                borderColor: theme.border,
              },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            {/* Top Bar */}
            <View style={styles.header}>
              <View style={styles.headerTitleRow}>
                <AppIcon name="chat" tintColor={theme.primary} size={20} />
                <Text style={[styles.sheetTitle, { color: theme.text }]}>Conversations</Text>
              </View>

              <View style={styles.headerRight}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="New conversation"
                  onPress={() => {
                    onCreate();
                    onClose();
                  }}
                  style={({ pressed }) => [
                    styles.newChatBtn,
                    {
                      backgroundColor: theme.primary,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <AppIcon name="add" tintColor={theme.primaryText} size={16} />
                  <Text style={[styles.newChatText, { color: theme.primaryText }]}>New Chat</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  onPress={onClose}
                  hitSlop={8}
                  style={styles.closeBtn}
                >
                  <AppIcon name="close" tintColor={theme.textSecondary} size={18} />
                </Pressable>
              </View>
            </View>

            {/* Search Input */}
            <View
              style={[
                styles.searchBox,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            >
              <AppIcon name="search" tintColor={theme.textSecondary} size={16} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search conversations…"
                placeholderTextColor={theme.textSecondary}
                style={[styles.searchInput, { color: theme.text }]}
              />
              {search.length > 0 ? (
                <Pressable onPress={() => setSearch('')} hitSlop={6}>
                  <AppIcon name="close" tintColor={theme.textSecondary} size={14} />
                </Pressable>
              ) : null}
            </View>

            {/* Filter Tabs (when not searching) */}
            {debounced.length === 0 ? (
              <View style={styles.filterRow}>
                {(['all', 'pinned', 'archived'] as FilterTab[]).map((tab) => (
                  <Pressable
                    key={tab}
                    onPress={() => setFilter(tab)}
                    style={[
                      styles.filterTab,
                      filter === tab && {
                        backgroundColor: theme.backgroundElement,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterTabText,
                        {
                          color: filter === tab ? theme.text : theme.textSecondary,
                          fontWeight: filter === tab ? '700' : '500',
                        },
                      ]}
                    >
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {/* List Body */}
            <ScrollView
              style={styles.scrollList}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {filteredThreads === undefined ? (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator color={theme.primary} />
                </View>
              ) : filteredThreads.length === 0 ? (
                <View style={styles.emptyWrap}>
                  <AppIcon name="chat" tintColor={theme.textSecondary} size={32} />
                  <Text style={[styles.emptyTitle, { color: theme.text }]}>
                    {debounced.length > 0 ? 'No matching conversations' : 'No conversations yet'}
                  </Text>
                  <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
                    {debounced.length > 0
                      ? 'Try searching with another keyword'
                      : 'Ask Bimi a question to start your first chat'}
                  </Text>
                </View>
              ) : groups ? (
                <>
                  {renderSection('Pinned', groups.pinned)}
                  {renderSection('Today', groups.today)}
                  {renderSection('Yesterday', groups.yesterday)}
                  {renderSection('Previous 7 Days', groups.previous7Days)}
                  {renderSection('Older', groups.older)}
                </>
              ) : (
                <View style={styles.sectionList}>{filteredThreads.map(renderThreadRow)}</View>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingContainer>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 32,
    maxHeight: '85%',
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sheetTitle: {
    fontSize: 18,
    fontFamily: Fonts.sansBold,
    letterSpacing: -0.2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  newChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
  },
  newChatText: {
    fontSize: 13,
    fontFamily: Fonts.sansBold,
  },
  closeBtn: {
    padding: 6,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 42,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: Fonts.sans,
    paddingVertical: 0,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterTab: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  filterTabText: {
    fontSize: 12,
    fontFamily: Fonts.sans,
  },
  scrollList: {
    maxHeight: 460,
  },
  scrollContent: {
    paddingBottom: 16,
    gap: 12,
  },
  sectionWrap: {
    gap: 4,
  },
  sectionHeader: {
    fontSize: 11,
    fontFamily: Fonts.sansBold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: 6,
    paddingTop: 8,
    paddingBottom: 2,
  },
  sectionList: {
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowMain: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  activeIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  rowTitle: {
    fontSize: 14,
    fontFamily: Fonts.sans,
    flex: 1,
  },
  rowTime: {
    fontSize: 11,
    fontFamily: Fonts.sans,
    paddingLeft: 22,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 8,
  },
  actionBtn: {
    padding: 6,
  },
  loadingWrap: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyWrap: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontFamily: Fonts.sansSemiBold,
    marginTop: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    fontFamily: Fonts.sans,
    textAlign: 'center',
    maxWidth: 240,
  },
});
