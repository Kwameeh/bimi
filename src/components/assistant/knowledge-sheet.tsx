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
import {
  SelectButton,
  SelectionBar,
  SelectionCheck,
} from '@/components/ui/selection-bar';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { useTheme } from '@/hooks/use-theme';
import { deleteInChunks, useSelection } from '@/hooks/use-selection';

import { api } from '../../../convex/_generated/api';
import type { Doc, Id } from '../../../convex/_generated/dataModel';

const KINDS = [
  { id: 'project', label: 'Project' },
  { id: 'url', label: 'URL' },
  { id: 'template', label: 'Template' },
  { id: 'client_note', label: 'Client note' },
  { id: 'availability', label: 'Availability' },
  { id: 'note', label: 'Note' },
] as const;

type Kind = (typeof KINDS)[number]['id'];

type Props = {
  instance: string;
  visible: boolean;
  onClose: () => void;
};

export function KnowledgeSheet({ instance, visible, onClose }: Props) {
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [editing, setEditing] = useState<
    Doc<'knowledgeEntries'> | { _new: true; kind: Kind } | null
  >(null);
  const removeMany = useMutation(api.knowledgeEntries.removeMany);
  const selection = useSelection<Id<'knowledgeEntries'>>();
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 220);
    return () => clearTimeout(t);
  }, [search]);

  const all = useQuery(
    api.knowledgeEntries.list,
    visible && debounced.length === 0 ? { instance } : 'skip',
  );
  const matched = useQuery(
    api.knowledgeEntries.search,
    visible && debounced.length > 0
      ? { instance, query: debounced, limit: 40 }
      : 'skip',
  );

  const rows: Doc<'knowledgeEntries'>[] | undefined =
    debounced.length > 0 ? matched : all;

  const grouped = useMemo(() => {
    if (!rows) return null;
    const groups: Record<Kind, Doc<'knowledgeEntries'>[]> = {
      project: [],
      url: [],
      template: [],
      client_note: [],
      availability: [],
      note: [],
    };
    for (const r of rows) {
      const k = r.kind as Kind;
      if (groups[k]) groups[k].push(r);
    }
    return groups;
  }, [rows]);

  const visibleIds = (rows ?? []).map((r) => r._id);

  const deleteSelected = async () => {
    setDeleting(true);
    try {
      await deleteInChunks(selection.selected, (entryIds) => removeMany({ entryIds }));
      selection.exit();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingContainer style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.border }]}
          onPress={(e) => e.stopPropagation()}>
          <View style={styles.headerRow}>
            <ThemedText type="smallBold">Knowledge base</ThemedText>
            <View style={styles.headerActions}>
              {visibleIds.length > 0 && !selection.active ? (
                <SelectButton onPress={selection.enter} />
              ) : null}
              <Pressable
                onPress={() => setEditing({ _new: true, kind: 'note' })}
                style={[styles.newBtn, { backgroundColor: theme.primary }]}>
                <Text style={{ color: theme.primaryText, fontWeight: '700' }}>+ Add</Text>
              </Pressable>
            </View>
          </View>

          {selection.active ? (
            <SelectionBar
              count={selection.count}
              total={visibleIds.length}
              noun="entry"
              busy={deleting}
              onSelectAll={() => selection.setAll(visibleIds)}
              onDelete={() => void deleteSelected()}
              onCancel={selection.exit}
            />
          ) : null}
          <ThemedText
            type="small"
            themeColor="textSecondary"
            style={{ marginBottom: 8 }}>
            Save projects, URLs, templates, client notes — Bimi can look these up when you ask.
            Pin an item to include it in every assistant turn.
          </ThemedText>

          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search knowledge…"
            placeholderTextColor={theme.textSecondary}
            style={[
              styles.search,
              { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement },
            ]}
          />

          {!rows ? (
            <ActivityIndicator color={theme.primary} />
          ) : (
            <ScrollView style={{ maxHeight: 440 }}>
              {grouped &&
                KINDS.map((kindDef) => {
                  const items = grouped[kindDef.id];
                  if (!items || items.length === 0) return null;
                  return (
                    <View key={kindDef.id} style={{ marginBottom: 10 }}>
                      <Text style={[styles.groupLabel, { color: theme.textSecondary }]}>
                        {kindDef.label}
                      </Text>
                      {items.map((it) => (
                        <Pressable
                          key={it._id}
                          onPress={() =>
                            selection.active ? selection.toggle(it._id) : setEditing(it)
                          }
                          onLongPress={
                            selection.active ? undefined : () => selection.begin(it._id)
                          }
                          delayLongPress={350}
                          style={({ pressed }) => [
                            styles.row,
                            { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                            selection.active &&
                              selection.isSelected(it._id) && {
                                borderColor: theme.primary,
                                backgroundColor: theme.backgroundSelected,
                              },
                            pressed && { opacity: 0.7 },
                          ]}>
                          {selection.active ? (
                            <SelectionCheck checked={selection.isSelected(it._id)} />
                          ) : null}
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
                              {it.pinned ? '📌 ' : ''}
                              {it.title}
                            </Text>
                            <Text
                              style={[styles.body, { color: theme.textSecondary }]}
                              numberOfLines={2}>
                              {it.body}
                            </Text>
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  );
                })}
              {rows.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={{ paddingVertical: 10 }}>
                  {debounced.length > 0 ? 'No matches.' : 'Nothing saved yet.'}
                </ThemedText>
              ) : null}
            </ScrollView>
          )}
        </Pressable>
        </Pressable>

        <EntryEditor
          instance={instance}
          entry={editing}
          onClose={() => setEditing(null)}
        />
      </KeyboardAvoidingContainer>
    </Modal>
  );
}

function EntryEditor({
  instance,
  entry,
  onClose,
}: {
  instance: string;
  entry:
    | Doc<'knowledgeEntries'>
    | { _new: true; kind: Kind }
    | null;
  onClose: () => void;
}) {
  const theme = useTheme();
  const create = useMutation(api.knowledgeEntries.create);
  const update = useMutation(api.knowledgeEntries.update);
  const remove = useMutation(api.knowledgeEntries.remove);

  const [kind, setKind] = useState<Kind>('note');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (entry && '_new' in entry) {
      setKind(entry.kind);
      setTitle('');
      setBody('');
      setPinned(false);
    } else if (entry) {
      setKind(entry.kind as Kind);
      setTitle(entry.title);
      setBody(entry.body);
      setPinned(entry.pinned === true);
    }
  }, [entry]);

  if (!entry) return null;
  const isNew = '_new' in entry;

  const onSave = async () => {
    if (saving) return;
    if (title.trim().length === 0) {
      Alert.alert('Title required');
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        await create({ instance, kind, title: title.trim(), body, pinned });
      } else {
        await update({
          entryId: entry._id,
          kind,
          title: title.trim(),
          body,
          pinned,
        });
      }
      onClose();
    } catch (err) {
      Alert.alert('Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = () => {
    if (isNew) {
      onClose();
      return;
    }
    Alert.alert('Delete entry?', title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await remove({ entryId: entry._id });
          onClose();
        },
      },
    ]);
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingContainer style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.editorSheet, { backgroundColor: theme.background, borderColor: theme.border }]}
          onPress={(e) => e.stopPropagation()}>
          <ThemedText type="smallBold">{isNew ? 'New entry' : 'Edit entry'}</ThemedText>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6, paddingVertical: 8 }}>
            {KINDS.map((k) => (
              <Pressable
                key={k.id}
                onPress={() => setKind(k.id)}
                style={[
                  styles.kindChip,
                  { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                  kind === k.id && { backgroundColor: theme.primary, borderColor: theme.primary },
                ]}>
                <Text
                  style={{
                    color: kind === k.id ? theme.primaryText : theme.text,
                    fontSize: 12,
                    fontWeight: '600',
                  }}>
                  {k.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Title"
            placeholderTextColor={theme.textSecondary}
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement },
            ]}
          />
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder={
              kind === 'url'
                ? 'https://api.example.com'
                : kind === 'template'
                  ? 'Hey {name}, just following up on…'
                  : 'Details…'
            }
            placeholderTextColor={theme.textSecondary}
            multiline
            style={[
              styles.input,
              styles.bodyInput,
              { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement },
            ]}
          />
          <View style={styles.pinRow}>
            <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600' }}>
              Pin to system prompt
            </Text>
            <Switch value={pinned} onValueChange={setPinned} />
          </View>

          <View style={styles.editorActions}>
            {!isNew ? (
              <Pressable
                onPress={onDelete}
                style={[styles.btn, { borderColor: '#B91C1C' }]}>
                <Text style={{ color: '#B91C1C', fontWeight: '700' }}>Delete</Text>
              </Pressable>
            ) : null}
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={onClose}
              style={[styles.btn, { borderColor: theme.border }]}>
              <Text style={{ color: theme.text, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={onSave}
              disabled={saving}
              style={[
                styles.btn,
                { backgroundColor: theme.primary, borderWidth: 0 },
                saving && { opacity: 0.6 },
              ]}>
              {saving ? (
                <ActivityIndicator color={theme.primaryText} size="small" />
              ) : (
                <Text style={{ color: theme.primaryText, fontWeight: '700' }}>Save</Text>
              )}
            </Pressable>
          </View>
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
  editorSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 28,
    maxHeight: '85%',
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
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
    marginBottom: 10,
  },
  groupLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  row: {
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 4,
  },
  title: { fontSize: 14, fontWeight: '600' },
  body: { fontSize: 11, marginTop: 2 },
  kindChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    marginTop: 8,
  },
  bodyInput: { minHeight: 100, maxHeight: 240, textAlignVertical: 'top' },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
  },
  editorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  btn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
