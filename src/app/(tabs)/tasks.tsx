import { useMutation, useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  SelectButton,
  SelectionBar,
  SelectionCheck,
  confirmDestructive,
} from '@/components/ui/selection-bar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteInChunks, useSelection } from '@/hooks/use-selection';
import { useInstance } from '@/lib/instance';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

type Tab = 'tasks' | 'reminders';

export default function TasksScreen() {
  const theme = useTheme();
  const instance = useInstance();
  const [tab, setTab] = useState<Tab>('tasks');

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <ThemedText type="title">{tab === 'tasks' ? 'Tasks' : 'Reminders'}</ThemedText>
        </View>
        <View style={styles.segmentRow}>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === 'tasks' }}
            onPress={() => setTab('tasks')}
            style={[
              styles.segment,
              { borderColor: theme.border },
              tab === 'tasks' && {
                backgroundColor: theme.primary,
                borderColor: theme.primary,
              },
            ]}>
            <Text
              style={{
                color: tab === 'tasks' ? theme.primaryText : theme.text,
                fontWeight: '600',
              }}>
              Tasks
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === 'reminders' }}
            onPress={() => setTab('reminders')}
            style={[
              styles.segment,
              { borderColor: theme.border },
              tab === 'reminders' && {
                backgroundColor: theme.primary,
                borderColor: theme.primary,
              },
            ]}>
            <Text
              style={{
                color: tab === 'reminders' ? theme.primaryText : theme.text,
                fontWeight: '600',
              }}>
              Reminders
            </Text>
          </Pressable>
        </View>
        {tab === 'tasks' ? (
          <TasksList instance={instance} />
        ) : (
          <RemindersList instance={instance} />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function TasksList({ instance }: { instance: string }) {
  const theme = useTheme();
  const router = useRouter();
  const tasks = useQuery(api.tasks.list, { instance, limit: 100 });
  const setStatus = useMutation(api.tasks.setStatus);
  const remove = useMutation(api.tasks.remove);
  const removeMany = useMutation(api.tasks.removeMany);
  const selection = useSelection<Id<'tasks'>>();
  const [deleting, setDeleting] = useState(false);

  const openSource = (contactId: Id<'contacts'> | undefined) => {
    if (!contactId) return;
    router.push({ pathname: '/chat/[contactId]', params: { contactId } });
  };

  const deleteSelected = async () => {
    setDeleting(true);
    try {
      await deleteInChunks(selection.selected, (taskIds) => removeMany({ taskIds }));
      selection.exit();
    } finally {
      setDeleting(false);
    }
  };

  if (tasks === undefined) {
    return (
      <View style={styles.center}>
        <ThemedText type="small" themeColor="textSecondary">
          Loading…
        </ThemedText>
      </View>
    );
  }
  if (tasks.length === 0) {
    return (
      <View style={styles.center}>
        <ThemedText type="smallBold">No tasks yet</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Long-press a message and tap &quot;Create Task&quot;.
        </ThemedText>
      </View>
    );
  }

  const open = tasks.filter((t) => t.status === 'open');
  const done = tasks.filter((t) => t.status === 'done');
  const allIds = tasks.map((t) => t._id);

  const rowProps = (t: (typeof tasks)[number]) => ({
    selectMode: selection.active,
    selected: selection.isSelected(t._id),
    onSelectToggle: () => selection.toggle(t._id),
    onLongPress: () => selection.begin(t._id),
  });

  return (
    <>
      {selection.active ? (
        <SelectionBar
          count={selection.count}
          total={allIds.length}
          noun="task"
          busy={deleting}
          onSelectAll={() => selection.setAll(allIds)}
          onDelete={() => void deleteSelected()}
          onCancel={selection.exit}
        />
      ) : (
        <View style={styles.toolbar}>
          {done.length > 0 ? (
            <Pressable
              onPress={() =>
                confirmDestructive({
                  title: `Clear ${done.length} completed task${done.length === 1 ? '' : 's'}?`,
                  message: 'This cannot be undone.',
                  confirmLabel: 'Clear',
                  onConfirm: () => {
                    void deleteInChunks(
                      done.map((t) => t._id),
                      (taskIds) => removeMany({ taskIds }),
                    );
                  },
                })
              }
              hitSlop={8}>
              <Text
                style={{
                  color: theme.textSecondary,
                  fontSize: 14,
                  fontWeight: '600',
                }}>
                Clear done
              </Text>
            </Pressable>
          ) : (
            <View />
          )}
          <SelectButton onPress={selection.enter} />
        </View>
      )}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.listContent}>
        {open.length > 0 ? (
          <>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
              Open
            </ThemedText>
            {open.map((t) => (
              <TaskRow
                key={t._id}
                title={t.title}
                description={t.description ?? undefined}
                dueAt={t.dueAt ?? undefined}
                priority={t.priority ?? undefined}
                done={false}
                isAi={t.createdBy === 'ai'}
                onOpenSource={
                  t.contactId ? () => openSource(t.contactId as Id<'contacts'>) : undefined
                }
                onToggle={() => setStatus({ taskId: t._id, status: 'done' })}
                onDelete={() =>
                  confirmDestructive({
                    title: 'Delete task?',
                    message: t.title,
                    confirmLabel: 'Delete',
                    onConfirm: () => void remove({ taskId: t._id }),
                  })
                }
                {...rowProps(t)}
              />
            ))}
          </>
        ) : null}
        {done.length > 0 ? (
          <>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
              Done
            </ThemedText>
            {done.map((t) => (
              <TaskRow
                key={t._id}
                title={t.title}
                description={t.description ?? undefined}
                done
                isAi={t.createdBy === 'ai'}
                onToggle={() => setStatus({ taskId: t._id, status: 'open' })}
                onDelete={() => remove({ taskId: t._id })}
                {...rowProps(t)}
              />
            ))}
          </>
        ) : null}
      </ScrollView>
    </>
  );
}

function TaskRow(props: {
  title: string;
  description?: string;
  dueAt?: number;
  priority?: 'urgent' | 'high' | 'normal' | 'low';
  done: boolean;
  isAi?: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onOpenSource?: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onSelectToggle?: () => void;
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  const priorityColor =
    props.priority === 'urgent' ? '#DC2626' : props.priority === 'high' ? '#F59E0B' : null;
  // In selection mode the whole row is one target. Leaving the inner controls
  // live would mean a tap meant to select a task marks it done instead.
  const body = (
    <>
      {props.selectMode ? (
        <View style={styles.checkbox}>
          <SelectionCheck checked={props.selected === true} />
        </View>
      ) : (
        <Pressable onPress={props.onToggle} style={styles.checkbox}>
          <View
            style={[
              styles.checkboxBox,
              { borderColor: theme.border },
              props.done && {
                backgroundColor: theme.primary,
                borderColor: theme.primary,
              },
            ]}>
            {props.done ? (
              <Text style={{ color: theme.primaryText, fontWeight: '800' }}>✓</Text>
            ) : null}
          </View>
        </Pressable>
      )}
      <View style={styles.cardBody}>
        <Text
          style={[
            styles.taskTitle,
            { color: theme.text },
            props.done && {
              textDecorationLine: 'line-through',
              color: theme.textSecondary,
            },
          ]}>
          {props.title}
        </Text>
        {props.description ? (
          <Text style={[styles.taskDesc, { color: theme.textSecondary }]} numberOfLines={2}>
            {props.description}
          </Text>
        ) : null}
        <View style={styles.taskMeta}>
          {priorityColor ? (
            <View style={[styles.priorityChip, { backgroundColor: priorityColor }]}>
              <Text style={styles.priorityText}>{props.priority?.toUpperCase()}</Text>
            </View>
          ) : null}
          {props.isAi ? (
            <View style={[styles.aiChip, { backgroundColor: theme.aiAccent }]}>
              <Text style={styles.aiChipText}>✦ AI</Text>
            </View>
          ) : null}
          {props.dueAt ? (
            <Text style={[styles.taskDue, { color: theme.textSecondary }]}>
              Due {new Date(props.dueAt).toLocaleDateString()}
            </Text>
          ) : null}
          {props.onOpenSource && !props.selectMode ? (
            <Pressable onPress={props.onOpenSource} hitSlop={6}>
              <Text style={[styles.openSource, { color: theme.primary }]}>Open chat</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {props.selectMode ? null : (
        <Pressable onPress={props.onDelete} hitSlop={8} style={styles.deleteBtn}>
          <Text style={{ color: theme.textSecondary, fontSize: 18 }}>×</Text>
        </Pressable>
      )}
    </>
  );

  const cardStyle = [
    styles.card,
    { backgroundColor: theme.backgroundElement, borderColor: theme.border },
    props.selectMode &&
      props.selected && {
        borderColor: theme.primary,
        backgroundColor: theme.backgroundSelected,
      },
  ];

  // Long-press is the entry point everywhere in the app, so it stays live
  // outside selection mode too.
  return (
    <Pressable
      onPress={props.selectMode ? props.onSelectToggle : undefined}
      onLongPress={props.selectMode ? undefined : props.onLongPress}
      delayLongPress={350}
      style={cardStyle}>
      {body}
    </Pressable>
  );
}

function RemindersList({ instance }: { instance: string }) {
  const theme = useTheme();
  const reminders = useQuery(api.reminders.list, { instance, limit: 100 });
  const dismiss = useMutation(api.reminders.dismiss);
  const dismissSuggested = useMutation(api.reminders.dismissSuggested);
  const acceptSuggested = useMutation(api.reminders.acceptSuggested);
  const remove = useMutation(api.reminders.remove);
  const removeMany = useMutation(api.reminders.removeMany);
  const selection = useSelection<Id<'reminders'>>();
  const [deleting, setDeleting] = useState(false);

  const deleteSelected = async () => {
    setDeleting(true);
    try {
      await deleteInChunks(selection.selected, (reminderIds) => removeMany({ reminderIds }));
      selection.exit();
    } finally {
      setDeleting(false);
    }
  };

  if (reminders === undefined) {
    return (
      <View style={styles.center}>
        <ThemedText type="small" themeColor="textSecondary">
          Loading…
        </ThemedText>
      </View>
    );
  }
  if (reminders.length === 0) {
    return (
      <View style={styles.center}>
        <ThemedText type="smallBold">No reminders yet</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Long-press a message and tap &quot;Add Reminder&quot;.
        </ThemedText>
      </View>
    );
  }

  const suggested = reminders.filter((r) => r.status === 'suggested');
  const others = reminders.filter((r) => r.status !== 'suggested');
  const allIds = reminders.map((r) => r._id);

  return (
    <>
      {selection.active ? (
        <SelectionBar
          count={selection.count}
          total={allIds.length}
          noun="reminder"
          busy={deleting}
          onSelectAll={() => selection.setAll(allIds)}
          onDelete={() => void deleteSelected()}
          onCancel={selection.exit}
        />
      ) : (
        <View style={styles.toolbar}>
          <View />
          <SelectButton onPress={selection.enter} />
        </View>
      )}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.listContent}>
        {suggested.length > 0 ? (
          <>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
              Suggested by Bimi
            </ThemedText>
            {suggested.map((r) => (
              <Pressable
                key={r._id}
                onPress={selection.active ? () => selection.toggle(r._id) : undefined}
                onLongPress={selection.active ? undefined : () => selection.begin(r._id)}
                delayLongPress={350}
                style={[
                  styles.card,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                  },
                  selection.active &&
                    selection.isSelected(r._id) && {
                      borderColor: theme.primary,
                      backgroundColor: theme.backgroundSelected,
                    },
                ]}>
                {selection.active ? (
                  <View style={styles.checkbox}>
                    <SelectionCheck checked={selection.isSelected(r._id)} />
                  </View>
                ) : null}
                <View style={styles.cardBody}>
                  <Text style={[styles.taskTitle, { color: theme.text }]}>{r.text}</Text>
                  <View style={styles.taskMeta}>
                    <View style={[styles.aiChip, { backgroundColor: theme.aiAccent }]}>
                      <Text style={styles.aiChipText}>✦ AI</Text>
                    </View>
                    <Text style={[styles.taskDue, { color: theme.textSecondary }]}>
                      Suggested for {new Date(r.remindAt).toLocaleString()}
                    </Text>
                  </View>
                </View>
                {selection.active ? null : (
                  <View style={styles.suggestedActions}>
                    <Pressable
                      onPress={() => dismissSuggested({ reminderId: r._id })}
                      hitSlop={6}
                      style={styles.suggestedBtn}>
                      <Text
                        style={{
                          color: theme.textSecondary,
                          fontSize: 11,
                          fontWeight: '700',
                        }}>
                        DISMISS
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => acceptSuggested({ reminderId: r._id })}
                      hitSlop={6}
                      style={[
                        styles.suggestedBtn,
                        { backgroundColor: theme.primary, borderRadius: 6 },
                      ]}>
                      <Text
                        style={{
                          color: theme.primaryText,
                          fontSize: 11,
                          fontWeight: '700',
                        }}>
                        ACCEPT
                      </Text>
                    </Pressable>
                  </View>
                )}
              </Pressable>
            ))}
          </>
        ) : null}
        {others.length > 0 ? (
          <>
            {suggested.length > 0 ? (
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
                Reminders
              </ThemedText>
            ) : null}
            {others.map((r) => (
              <Pressable
                key={r._id}
                onPress={selection.active ? () => selection.toggle(r._id) : undefined}
                onLongPress={selection.active ? undefined : () => selection.begin(r._id)}
                delayLongPress={350}
                style={[
                  styles.card,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                  },
                  selection.active &&
                    selection.isSelected(r._id) && {
                      borderColor: theme.primary,
                      backgroundColor: theme.backgroundSelected,
                    },
                ]}>
                {selection.active ? (
                  <View style={styles.checkbox}>
                    <SelectionCheck checked={selection.isSelected(r._id)} />
                  </View>
                ) : null}
                <View style={styles.cardBody}>
                  <Text
                    style={[
                      styles.taskTitle,
                      { color: theme.text },
                      r.status !== 'pending' && {
                        textDecorationLine: 'line-through',
                        color: theme.textSecondary,
                      },
                    ]}>
                    {r.text}
                  </Text>
                  <Text style={[styles.taskDue, { color: theme.textSecondary }]}>
                    {r.status === 'pending'
                      ? 'Remind at '
                      : r.status === 'fired'
                        ? 'Fired at '
                        : 'Was set for '}
                    {new Date(r.remindAt).toLocaleString()}
                  </Text>
                </View>
                {selection.active ? null : r.status === 'pending' ? (
                  <Pressable
                    onPress={() => dismiss({ reminderId: r._id })}
                    hitSlop={6}
                    style={styles.deleteBtn}>
                    <Text
                      style={{
                        color: theme.textSecondary,
                        fontSize: 12,
                        fontWeight: '700',
                      }}>
                      DISMISS
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => remove({ reminderId: r._id })}
                    hitSlop={8}
                    style={styles.deleteBtn}>
                    <Text style={{ color: theme.textSecondary, fontSize: 18 }}>×</Text>
                  </Pressable>
                )}
              </Pressable>
            ))}
          </>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  segmentRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.four,
    gap: 8,
    marginBottom: Spacing.three,
  },
  segment: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 24,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  listContent: { paddingHorizontal: Spacing.three, paddingBottom: 80, gap: 8 },
  sectionLabel: { marginTop: 12, marginBottom: 4, paddingHorizontal: 4 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  checkbox: { paddingTop: 2 },
  checkboxBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, gap: 4 },
  taskTitle: { fontSize: 15, fontWeight: '600' },
  taskDesc: { fontSize: 13 },
  taskMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  priorityChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  priorityText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
  aiChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  aiChipText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
  taskDue: { fontSize: 12 },
  openSource: { fontSize: 12, fontWeight: '600' },
  suggestedActions: { gap: 6, justifyContent: 'center' },
  suggestedBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtn: { padding: 4 },
});
