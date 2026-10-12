import { useMutation, useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApprovalCard } from '@/components/approvals/approval-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AppIcon } from '@/components/ui/app-icon';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { SelectButton, SelectionBar, SelectionCheck } from '@/components/ui/selection-bar';
import { Fonts, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteInChunks, useSelection } from '@/hooks/use-selection';
import { useInstance } from '@/lib/instance';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

type Filter = 'all' | 'urgent' | 'high' | 'normal' | 'low';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'urgent', label: 'Urgent' },
  { key: 'high', label: 'High' },
  { key: 'normal', label: 'Normal' },
  { key: 'low', label: 'Low' },
];

export default function ApprovalsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const instance = useInstance();
  const [filter, setFilter] = useState<Filter>('all');

  const items = useQuery(api.drafts.listQueue, {
    instance,
    priority: filter === 'all' ? undefined : filter,
    limit: 50,
  });
  const removeMany = useMutation(api.drafts.removeMany);
  const selection = useSelection<Id<'drafts'>>();
  const [deleting, setDeleting] = useState(false);

  // Select-all covers the filtered view, not the whole queue — picking "Urgent"
  // then "All" should never sweep up the low-priority drafts you cannot see.
  const visibleIds = (items ?? []).map((it) => it.draft._id as Id<'drafts'>);

  const deleteSelected = async () => {
    setDeleting(true);
    try {
      await deleteInChunks(selection.selected, (draftIds) => removeMany({ draftIds }));
      selection.exit();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingContainer style={styles.safe}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.header}>
            <View style={styles.headerRow}>
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
                <ThemedText type="title">Approvals</ThemedText>
              </View>
              {items !== undefined && items.length > 0 && !selection.active ? (
                <SelectButton onPress={selection.enter} />
              ) : null}
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
              {items === undefined
                ? 'Loading…'
                : items.length === 0
                  ? 'Nothing waiting.'
                  : `${items.length} pending`}
            </ThemedText>
          </View>

          {selection.active ? (
            <SelectionBar
              count={selection.count}
              total={visibleIds.length}
              noun="draft"
              busy={deleting}
              onSelectAll={() => selection.setAll(visibleIds)}
              onDelete={() => void deleteSelected()}
              onCancel={selection.exit}
            />
          ) : null}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  key={f.key}
                  onPress={() => setFilter(f.key)}
                  style={[
                    styles.filterChip,
                    { borderColor: theme.border },
                    active && {
                      backgroundColor: theme.primary,
                      borderColor: theme.primary,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: active ? theme.primaryText : theme.text,
                      fontFamily: Fonts.sansSemiBold,
                      fontSize: 13,
                    }}
                  >
                    {f.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {items === undefined ? (
            <View style={styles.center}>
              <ActivityIndicator color={theme.primary} />
            </View>
          ) : items.length === 0 ? (
            <View style={styles.center}>
              <ThemedText type="smallBold">All caught up</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                No drafts are waiting for your approval.
              </ThemedText>
            </View>
          ) : (
            <ScrollView
              contentInsetAdjustmentBehavior="automatic"
              contentContainerStyle={styles.list}
            >
              {items.map((it) => {
                const id = it.draft._id as Id<'drafts'>;
                const checked = selection.isSelected(id);
                return (
                  <Pressable
                    key={it.draft._id}
                    onPress={selection.active ? () => selection.toggle(id) : undefined}
                    onLongPress={selection.active ? undefined : () => selection.begin(id)}
                    delayLongPress={350}
                    style={[
                      styles.row,
                      selection.active && checked && { borderColor: theme.primary },
                    ]}
                  >
                    {selection.active ? (
                      <View style={styles.rowCheck}>
                        <SelectionCheck checked={checked} />
                      </View>
                    ) : null}
                    {/* The card's own Send/Edit/Reject buttons would fight the
                      row for the tap, so it goes inert while selecting. */}
                    <View style={styles.rowBody} pointerEvents={selection.active ? 'none' : 'auto'}>
                      <ApprovalCard item={it} />
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </SafeAreaView>
      </KeyboardAvoidingContainer>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  header: { padding: Spacing.four, gap: Spacing.one },
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
  subtitle: { marginTop: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  rowCheck: { paddingLeft: Spacing.two },
  rowBody: { flex: 1 },
  filterRow: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
    gap: 8,
    flexDirection: 'row',
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 24,
  },
  list: { padding: Spacing.four, paddingTop: 0, gap: 12 },
});
