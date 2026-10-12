import { FlashList } from '@shopify/flash-list';
import { useMutation, useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AppIcon } from '@/components/ui/app-icon';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { SelectButton, SelectionBar, SelectionCheck } from '@/components/ui/selection-bar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteInChunks, useSelection } from '@/hooks/use-selection';
import { useInstance } from '@/lib/instance';

import { api } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';

type SubTab = 'mine' | 'contacts' | 'chats' | 'pending';
type MemType = 'fact' | 'preference' | 'commitment' | 'ongoing' | 'relationship';

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'mine', label: 'Mine' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'chats', label: 'Chats' },
  { id: 'pending', label: 'Pending' },
];

const TYPES: MemType[] = ['fact', 'preference', 'commitment', 'ongoing', 'relationship'];

const TYPE_COLOR: Record<MemType, string> = {
  fact: '#2563EB',
  preference: '#7C3AED',
  commitment: '#DC2626',
  ongoing: '#0891B2',
  relationship: '#16A34A',
};

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return new Date(ms).toLocaleDateString();
}

export default function MemoryScreen() {
  const theme = useTheme();
  const instance = useInstance();
  const router = useRouter();

  const [subTab, setSubTab] = useState<SubTab>('mine');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [typeFilter, setTypeFilter] = useState<MemType | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<
    Doc<'memories'> | { _new: true; scope: 'user' | 'contact' | 'chat' } | null
  >(null);
  const [actionTarget, setActionTarget] = useState<Doc<'memories'> | null>(null);
  const removeMany = useMutation(api.memories.removeMany);
  const selection = useSelection<Id<'memories'>>();
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 220);
    return () => clearTimeout(t);
  }, [search]);

  const scopeFor: Record<SubTab, 'user' | 'contact' | 'chat' | undefined> = {
    mine: 'user',
    contacts: 'contact',
    chats: 'chat',
    pending: undefined,
  };

  const listed = useQuery(
    api.memories.list,
    subTab !== 'pending'
      ? {
          instance,
          scope: scopeFor[subTab],
          status: 'active',
          type: typeFilter ?? undefined,
          query: debounced.length > 0 ? debounced : undefined,
          limit: 100,
        }
      : 'skip',
  );
  const pending = useQuery(
    api.memories.listPending,
    subTab === 'pending' ? { instance, limit: 100 } : 'skip',
  );
  const rows = subTab === 'pending' ? pending : listed;

  // Contact-name lookup table for Contacts/Chats tabs.
  const topChats = useQuery(
    api.contacts.listChats,
    subTab === 'contacts' || subTab === 'chats' || subTab === 'pending'
      ? { instance, limit: 200 }
      : 'skip',
  );
  const contactNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of topChats ?? []) {
      const name = c.contact.displayName ?? c.contact.remoteJid;
      map.set(c.contact._id as string, name);
    }
    return map;
  }, [topChats]);

  const onRefresh = async () => {
    // Convex is reactive; this is mostly a UX affordance.
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 600);
  };

  const visibleIds = (rows ?? []).map((r) => r._id as Id<'memories'>);

  const deleteSelected = async () => {
    setDeleting(true);
    try {
      await deleteInChunks(selection.selected, (memoryIds) => removeMany({ memoryIds }));
      selection.exit();
    } finally {
      setDeleting(false);
    }
  };

  // Switching tab or filter changes what "select all" would mean, so the
  // selection is abandoned rather than silently carried into a different list.
  const leaveSelection = () => {
    if (selection.active) selection.exit();
  };

  const startAdd = () =>
    setEditing({
      _new: true,
      scope: subTab === 'pending' ? 'user' : (scopeFor[subTab] as 'user' | 'contact' | 'chat'),
    });

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={[styles.header, styles.headerRow]}>
          <View style={styles.headerTitleGroup}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={() => router.back()}
              hitSlop={12}
              style={styles.backBtn}
            >
              <AppIcon name="back" tintColor={theme.primary} size={22} />
            </Pressable>
            <ThemedText type="title">Memory</ThemedText>
          </View>
          {!selection.active && visibleIds.length > 0 ? (
            <SelectButton onPress={selection.enter} />
          ) : null}
        </View>

        {selection.active ? (
          <SelectionBar
            count={selection.count}
            total={visibleIds.length}
            noun="memory"
            busy={deleting}
            onSelectAll={() => selection.setAll(visibleIds)}
            onDelete={() => void deleteSelected()}
            onCancel={selection.exit}
          />
        ) : null}

        {/* Segmented sub-tabs — equal width, big touch target */}
        <View style={[styles.segments, { borderColor: theme.border }]}>
          {SUB_TABS.map((t) => {
            const active = t.id === subTab;
            return (
              <Pressable
                key={t.id}
                onPress={() => {
                  leaveSelection();
                  setSubTab(t.id);
                }}
                style={[styles.segment, active && { backgroundColor: theme.primary }]}
              >
                <Text
                  style={{
                    color: active ? theme.primaryText : theme.text,
                    fontSize: 13,
                    fontWeight: '600',
                  }}
                >
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {subTab !== 'pending' ? (
          <View style={styles.searchRow}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search memory…"
              placeholderTextColor={theme.textSecondary}
              returnKeyType="search"
              style={[
                styles.search,
                {
                  color: theme.text,
                  borderColor: theme.border,
                  backgroundColor: theme.backgroundElement,
                },
              ]}
            />
            {search.length > 0 ? (
              <Pressable onPress={() => setSearch('')} hitSlop={10} style={styles.searchClear}>
                <Text style={{ color: theme.textSecondary, fontSize: 18 }}>×</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {subTab !== 'pending' ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.typeRow}
          >
            <Pressable
              onPress={() => {
                leaveSelection();
                setTypeFilter(null);
              }}
              style={[
                styles.typeChip,
                { borderColor: theme.border },
                typeFilter === null && {
                  backgroundColor: theme.backgroundSelected,
                },
              ]}
            >
              <Text style={{ color: theme.text, fontSize: 12, fontWeight: '600' }}>All</Text>
            </Pressable>
            {TYPES.map((t) => (
              <Pressable
                key={t}
                onPress={() => {
                  leaveSelection();
                  setTypeFilter(t);
                }}
                style={[
                  styles.typeChip,
                  { borderColor: theme.border },
                  typeFilter === t && { backgroundColor: theme.backgroundSelected },
                ]}
              >
                <View style={[styles.typeDot, { backgroundColor: TYPE_COLOR[t] }]} />
                <Text style={{ color: theme.text, fontSize: 12, fontWeight: '600' }}>{t}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {!rows ? (
          <ActivityIndicator color={theme.primary} style={{ marginTop: 30 }} />
        ) : rows.length === 0 ? (
          <ScrollView
            contentContainerStyle={styles.emptyWrap}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.primary}
              />
            }
          >
            <Text style={styles.emptyIcon}>🧠</Text>
            <ThemedText type="smallBold" style={{ marginTop: 8 }}>
              {subTab === 'pending' ? 'No proposals waiting' : 'Nothing here yet'}
            </ThemedText>
            <ThemedText
              type="small"
              themeColor="textSecondary"
              style={{ textAlign: 'center', marginTop: 4, paddingHorizontal: 28 }}
            >
              {subTab === 'pending'
                ? "Bimi will queue proposals here when it isn't confident enough to write directly."
                : 'Bimi will fill this in as you chat. You can also tap + to add an entry yourself.'}
            </ThemedText>
          </ScrollView>
        ) : (
          <FlashList
            data={rows}
            keyExtractor={(r) => r._id}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.primary}
              />
            }
            renderItem={({ item }) => (
              <MemoryCard
                row={item}
                contactName={
                  item.contactId ? contactNameById.get(item.contactId as string) : undefined
                }
                selectMode={selection.active}
                selected={selection.isSelected(item._id)}
                onTap={() => (selection.active ? selection.toggle(item._id) : setEditing(item))}
                onLongPress={() =>
                  selection.active ? selection.toggle(item._id) : setActionTarget(item)
                }
                onOpenChat={(cid) =>
                  router.push({
                    pathname: '/chat/[contactId]',
                    params: { contactId: cid },
                  })
                }
              />
            )}
          />
        )}

        {/* FAB — thumb-reachable add button */}
        <Pressable
          onPress={startAdd}
          style={({ pressed }) => [
            styles.fab,
            { backgroundColor: theme.primary, shadowColor: theme.text },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={[styles.fabPlus, { color: theme.primaryText }]}>+</Text>
        </Pressable>

        <MemoryActionsSheet
          row={actionTarget}
          onClose={() => setActionTarget(null)}
          onEdit={(r) => {
            setActionTarget(null);
            setEditing(r);
          }}
        />

        {editing ? (
          <MemoryEditor
            key={'_id' in editing ? editing._id : `new-${editing.scope}`}
            instance={instance}
            entry={editing}
            onClose={() => setEditing(null)}
          />
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}

function MemoryCard({
  row,
  contactName,
  selectMode,
  selected,
  onTap,
  onLongPress,
  onOpenChat,
}: {
  row: Doc<'memories'>;
  contactName?: string;
  selectMode?: boolean;
  selected?: boolean;
  onTap: () => void;
  onLongPress: () => void;
  onOpenChat: (id: Id<'contacts'>) => void;
}) {
  const theme = useTheme();
  const approve = useMutation(api.memories.approve);
  const reject = useMutation(api.memories.reject);

  const isPending = row.status === 'proposed';
  const typeColor = TYPE_COLOR[row.type as MemType] ?? theme.textSecondary;
  const conf = Math.round(row.confidence * 100);

  return (
    <Pressable
      onPress={onTap}
      onLongPress={isPending && !selectMode ? undefined : onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.card,
        { borderColor: theme.border, backgroundColor: theme.backgroundElement },
        selectMode &&
          selected === true && {
            borderColor: theme.primary,
            backgroundColor: theme.backgroundSelected,
          },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={styles.cardTop}>
        {selectMode ? (
          <View style={{ marginRight: 2 }}>
            <SelectionCheck checked={selected === true} />
          </View>
        ) : null}
        <View style={[styles.typePill, { backgroundColor: typeColor }]}>
          <Text style={styles.typePillText}>{row.type}</Text>
        </View>
        {row.pinned ? <Text style={styles.pinIcon}>📌</Text> : null}
        {contactName ? (
          <Text style={[styles.contactName, { color: theme.text }]} numberOfLines={1}>
            {contactName}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        <Text style={[styles.metaLabel, { color: theme.textSecondary }]}>
          {conf}% · {relativeTime(row.updatedAt)}
        </Text>
      </View>

      <Text style={[styles.cardBody, { color: theme.text }]}>{row.content}</Text>

      {row.contactId && !selectMode ? (
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            onOpenChat(row.contactId!);
          }}
          hitSlop={8}
          style={({ pressed }) => [styles.openChatRow, pressed && { opacity: 0.6 }]}
        >
          <Text style={[styles.openChatText, { color: theme.primary }]}>↗ Open chat</Text>
        </Pressable>
      ) : null}

      {isPending && !selectMode ? (
        <View style={styles.pendingRow}>
          <Pressable
            onPress={() =>
              reject({ memoryId: row._id }).catch((e) => Alert.alert('Failed', String(e)))
            }
            style={[styles.pendingBtn, { borderColor: theme.border }]}
          >
            <Text style={{ color: theme.text, fontWeight: '600' }}>Reject</Text>
          </Pressable>
          <Pressable onPress={onTap} style={[styles.pendingBtn, { borderColor: theme.border }]}>
            <Text style={{ color: theme.text, fontWeight: '600' }}>Edit</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              approve({ memoryId: row._id }).catch((e) => Alert.alert('Failed', String(e)))
            }
            style={[
              styles.pendingBtn,
              styles.pendingBtnPrimary,
              { backgroundColor: theme.primary },
            ]}
          >
            <Text style={{ color: theme.primaryText, fontWeight: '700' }}>Approve</Text>
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

function MemoryActionsSheet({
  row,
  onClose,
  onEdit,
}: {
  row: Doc<'memories'> | null;
  onClose: () => void;
  onEdit: (row: Doc<'memories'>) => void;
}) {
  const theme = useTheme();
  const pin = useMutation(api.memories.pin);
  const dismiss = useMutation(api.memories.dismiss);
  const remove = useMutation(api.memories.remove);

  if (!row) return null;

  const items: { label: string; sub?: string; onPress: () => void; danger?: boolean }[] = [
    {
      label: 'Edit',
      sub: 'Change content or type',
      onPress: () => onEdit(row),
    },
    {
      label: row.pinned ? 'Unpin' : 'Pin',
      sub: row.pinned ? 'Allow expiry to apply again' : 'Prevent decay and load into every prompt',
      onPress: () => {
        void pin({ memoryId: row._id, pinned: !row.pinned });
        onClose();
      },
    },
    {
      label: 'Dismiss',
      sub: 'Hide from retrieval — keep in audit log',
      onPress: () => {
        void dismiss({ memoryId: row._id });
        onClose();
      },
    },
    {
      label: 'Delete forever',
      sub: 'Hard delete — cannot be undone',
      danger: true,
      onPress: () => {
        Alert.alert('Delete permanently?', row.content, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              void remove({ memoryId: row._id });
              onClose();
            },
          },
        ]);
      },
    },
  ];

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.actionsSheet,
            { backgroundColor: theme.background, borderColor: theme.border },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text
            style={[styles.actionsSheetTitle, { color: theme.textSecondary }]}
            numberOfLines={2}
          >
            {row.content}
          </Text>
          {items.map((it, i) => (
            <Pressable
              key={it.label}
              onPress={it.onPress}
              style={({ pressed }) => [
                styles.actionRow,
                i < items.length - 1 && {
                  borderBottomColor: theme.border,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                },
                pressed && { opacity: 0.6 },
              ]}
            >
              <Text style={[styles.actionLabel, { color: it.danger ? '#B91C1C' : theme.text }]}>
                {it.label}
              </Text>
              {it.sub ? (
                <Text style={[styles.actionSub, { color: theme.textSecondary }]}>{it.sub}</Text>
              ) : null}
            </Pressable>
          ))}
          <Pressable
            onPress={onClose}
            style={[styles.cancelBtn, { backgroundColor: theme.backgroundElement }]}
          >
            <Text style={{ color: theme.text, fontWeight: '600' }}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MemoryEditor({
  instance,
  entry,
  onClose,
}: {
  instance: string;
  entry: Doc<'memories'> | { _new: true; scope: 'user' | 'contact' | 'chat' };
  onClose: () => void;
}) {
  const theme = useTheme();
  const create = useMutation(api.memories.create);
  const update = useMutation(api.memories.update);
  const approve = useMutation(api.memories.approve);

  const isNew = '_new' in entry;
  const isPending = !isNew && entry.status === 'proposed';
  const [type, setType] = useState<MemType>(isNew ? 'fact' : (entry.type as MemType));
  const [content, setContent] = useState(isNew ? '' : entry.content);
  const [pinned, setPinned] = useState(isNew ? false : entry.pinned === true);
  const [busy, setBusy] = useState(false);

  const onSave = async () => {
    if (busy) return;
    const c = content.trim();
    if (c.length === 0) {
      Alert.alert('Content required');
      return;
    }
    setBusy(true);
    try {
      if (isNew) {
        await create({
          instance,
          scope: entry.scope,
          type,
          content: c,
          pinned,
        });
      } else {
        await update({
          memoryId: entry._id,
          content: c,
          type,
          pinned,
        });
      }
      onClose();
    } catch (err) {
      Alert.alert('Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onEditAndApprove = async () => {
    if (busy) return;
    if (isNew || !isPending) return;
    const c = content.trim();
    if (c.length === 0) return;
    setBusy(true);
    try {
      await update({ memoryId: entry._id, content: c, type, pinned });
      await approve({ memoryId: entry._id });
      onClose();
    } catch (err) {
      Alert.alert('Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingContainer style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable
            style={[
              styles.editorSheet,
              { backgroundColor: theme.background, borderColor: theme.border },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.editorGrabber} />
            <ThemedText type="smallBold">
              {isNew ? 'New memory' : isPending ? 'Review proposal' : 'Edit memory'}
            </ThemedText>

            <Text style={[styles.editorLabel, { color: theme.textSecondary }]}>Type</Text>
            <View style={styles.typeGrid}>
              {TYPES.map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setType(t)}
                  style={[
                    styles.typeChipBig,
                    { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                    type === t && {
                      backgroundColor: theme.primary,
                      borderColor: theme.primary,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.typeDot,
                      { backgroundColor: type === t ? theme.primaryText : TYPE_COLOR[t] },
                    ]}
                  />
                  <Text
                    style={{
                      color: type === t ? theme.primaryText : theme.text,
                      fontSize: 13,
                      fontWeight: '600',
                    }}
                  >
                    {t}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.editorLabel, { color: theme.textSecondary }]}>Memory</Text>
            <TextInput
              value={content}
              onChangeText={setContent}
              placeholder="One short sentence — e.g. 'Sarah works at Wartech as the backend lead.'"
              placeholderTextColor={theme.textSecondary}
              multiline
              autoFocus={isNew}
              style={[
                styles.editorInput,
                {
                  color: theme.text,
                  borderColor: theme.border,
                  backgroundColor: theme.backgroundElement,
                },
              ]}
            />

            <Pressable
              onPress={() => setPinned((p) => !p)}
              style={[
                styles.pinToggle,
                { borderColor: theme.border },
                pinned && {
                  backgroundColor: theme.backgroundSelected,
                  borderColor: theme.primary,
                },
              ]}
            >
              <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>
                {pinned ? '📌 Pinned — loaded every turn' : '📍 Pin to load every turn'}
              </Text>
            </Pressable>

            <View style={styles.editorActions}>
              <Pressable onPress={onClose} style={[styles.bigBtn, { borderColor: theme.border }]}>
                <Text style={{ color: theme.text, fontWeight: '600' }}>Cancel</Text>
              </Pressable>
              {isPending ? (
                <Pressable
                  onPress={onEditAndApprove}
                  disabled={busy}
                  style={[
                    styles.bigBtn,
                    styles.bigBtnPrimary,
                    { backgroundColor: theme.primary },
                    busy && { opacity: 0.5 },
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator color={theme.primaryText} size="small" />
                  ) : (
                    <Text style={{ color: theme.primaryText, fontWeight: '700' }}>
                      Edit & approve
                    </Text>
                  )}
                </Pressable>
              ) : (
                <Pressable
                  onPress={onSave}
                  disabled={busy}
                  style={[
                    styles.bigBtn,
                    styles.bigBtnPrimary,
                    { backgroundColor: theme.primary },
                    busy && { opacity: 0.5 },
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator color={theme.primaryText} size="small" />
                  ) : (
                    <Text style={{ color: theme.primaryText, fontWeight: '700' }}>Save</Text>
                  )}
                </Pressable>
              )}
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingContainer>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: { padding: 4 },
  header: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  segments: {
    flexDirection: 'row',
    marginHorizontal: Spacing.three,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginBottom: 8,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.three,
    marginBottom: 6,
  },
  search: {
    flex: 1,
    height: 42,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 14,
  },
  searchClear: {
    position: 'absolute',
    right: 6,
    top: 0,
    bottom: 0,
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeRow: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 8,
    gap: 6,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  typeChipBig: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  typeDot: { width: 8, height: 8, borderRadius: 4 },
  list: { padding: Spacing.three, paddingBottom: 90 },
  emptyWrap: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyIcon: { fontSize: 56, marginBottom: 4 },

  // Cards
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginBottom: 10,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  typePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  typePillText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  pinIcon: { fontSize: 13 },
  contactName: { fontSize: 13, fontWeight: '600', maxWidth: 140 },
  metaLabel: { fontSize: 11, fontWeight: '600' },
  cardBody: { fontSize: 15, lineHeight: 21 },
  openChatRow: {
    marginTop: 10,
    paddingVertical: 6,
  },
  openChatText: { fontSize: 13, fontWeight: '600' },

  // Pending action buttons
  pendingRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  pendingBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingBtnPrimary: { borderWidth: 0 },

  // FAB
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabPlus: { fontSize: 28, fontWeight: '300', lineHeight: 30 },

  // Actions bottom sheet
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  actionsSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 28,
  },
  actionsSheetTitle: {
    fontSize: 13,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  actionRow: {
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  actionLabel: { fontSize: 15, fontWeight: '600' },
  actionSub: { fontSize: 12, marginTop: 2 },
  cancelBtn: {
    marginTop: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 10,
  },

  // Editor sheet
  editorSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: '90%',
  },
  editorGrabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(120,120,120,0.4)',
    marginBottom: 12,
  },
  editorLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 12,
    marginBottom: 6,
  },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  editorInput: {
    minHeight: 100,
    maxHeight: 200,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: 'top',
  },
  pinToggle: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    alignItems: 'center',
  },
  editorActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  bigBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigBtnPrimary: { borderWidth: 0 },
});
