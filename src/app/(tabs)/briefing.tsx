import { useAction, useMutation, useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionPlanCard } from '@/components/briefing/action-plan-card';
import { AttentionFeed, type AttentionItem } from '@/components/briefing/attention-feed';
import { BriefingPulseCard, type FilterCategory } from '@/components/briefing/briefing-pulse-card';
import {
  IntelBento,
  type IntelAutoReply,
  type IntelDocument,
  type IntelFyi,
  type IntelTrend,
} from '@/components/briefing/intel-bento';
import { MeetingAgenda, type AgendaMeeting } from '@/components/briefing/meeting-agenda';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { confirmDestructive } from '@/components/ui/selection-bar';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useInstance } from '@/lib/instance';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

type Range = 'today' | 'since_opened' | 'yesterday' | 'this_week';

const RANGE_OPTIONS: { key: Range; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'since_opened', label: 'Since I last opened' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'this_week', label: 'This week' },
];

function formatHeaderDate(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function rangeToMs(
  range: Range,
  lastOpenedAt: number | undefined,
): {
  sinceMs: number;
  untilMs?: number;
  label: string;
} {
  const now = Date.now();
  switch (range) {
    case 'since_opened': {
      const sinceMs = lastOpenedAt ?? now - 24 * 60 * 60 * 1000;
      return { sinceMs, label: 'Since I last opened' };
    }
    case 'yesterday': {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const untilMs = start.getTime();
      const sinceMs = untilMs - 24 * 60 * 60 * 1000;
      return { sinceMs, untilMs, label: 'Yesterday' };
    }
    case 'this_week': {
      return { sinceMs: now - 7 * 24 * 60 * 60 * 1000, label: 'This week' };
    }
    case 'today':
    default:
      return { sinceMs: now - 24 * 60 * 60 * 1000, label: 'Today' };
  }
}

type LiveSections = {
  urgent: {
    messageId: Id<'messages'>;
    contactId: Id<'contacts'>;
    contactName?: string;
    preview: string;
  }[];
  needsReply: {
    messageId: Id<'messages'>;
    contactId: Id<'contacts'>;
    contactName?: string;
    preview: string;
  }[];
  meetings: {
    messageId: Id<'messages'>;
    contactId: Id<'contacts'>;
    contactName?: string;
    preview: string;
  }[];
  documents: {
    messageId: Id<'messages'>;
    contactId: Id<'contacts'>;
    contactName?: string;
    fileName?: string;
  }[];
  autoReplied: {
    messageId: Id<'messages'>;
    contactId: Id<'contacts'>;
    contactName?: string;
    preview: string;
  }[];
  fyi: {
    messageId: Id<'messages'>;
    contactId: Id<'contacts'>;
    contactName?: string;
    preview: string;
    category?: string;
  }[];
};

export default function BriefingScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const router = useRouter();
  const instance = useInstance();
  const summary = useQuery(api.summaries.getLatestForInstance, { instance });
  const pref = useQuery(api.userPreferences.get, { instance });
  const pendingMeetings = useQuery(api.meetings.listPendingForInstance, {
    instance,
  });
  const removeMeeting = useMutation(api.meetings.remove);
  const regenerate = useAction(api.summaries.regenerateForToday);
  const askMissed = useAction(api.summaries.askMissedSummary);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<Range>('today');
  const [filter, setFilter] = useState<FilterCategory>('all');
  const [live, setLive] = useState<{ range: Range; data: LiveSections } | null>(null);

  const openChat = (contactId: Id<'contacts'>) => {
    router.push({ pathname: '/chat/[contactId]', params: { contactId } });
  };

  useEffect(() => {
    if (range === 'today') return;
    let cancelled = false;
    const { sinceMs, untilMs } = rangeToMs(range, pref?.lastOpenedAt);
    (async () => {
      try {
        const result = (await askMissed({
          instance,
          sinceMs,
          untilMs,
        })) as LiveSections;
        if (!cancelled) setLive({ range, data: result });
      } catch (err) {
        if (!cancelled)
          Alert.alert('Load failed', err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range, instance, pref?.lastOpenedAt, askMissed]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      if (range === 'today') {
        await regenerate({ instance });
      } else {
        const { sinceMs, untilMs } = rangeToMs(range, pref?.lastOpenedAt);
        const result = (await askMissed({
          instance,
          sinceMs,
          untilMs,
        })) as LiveSections;
        setLive({ range, data: result });
      }
    } catch (err) {
      Alert.alert('Refresh failed', err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const isToday = range === 'today';
  const usingLive = !isToday;

  if (isToday && summary === undefined) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.center} edges={['top']}>
          <ActivityIndicator color={theme.primary} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (isToday && summary === null) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.header}>
            <ThemedText style={styles.headerTitle}>Today&apos;s briefing</ThemedText>
          </View>
          <View style={styles.center}>
            <ThemedText type="smallBold">No briefing yet</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Tap below to generate today&apos;s summary.
            </ThemedText>
            <Pressable
              onPress={onRefresh}
              style={[
                styles.cta,
                {
                  backgroundColor: theme.primary,
                  opacity: refreshing ? 0.6 : 1,
                },
              ]}
            >
              {refreshing ? (
                <ActivityIndicator color={theme.primaryText} />
              ) : (
                <ThemedText style={{ color: theme.primaryText, fontWeight: '700' }}>
                  Generate now
                </ThemedText>
              )}
            </Pressable>
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const liveLoading = usingLive && live?.range !== range;
  const liveData = live?.range === range ? live.data : null;

  const data: LiveSections | null = usingLive
    ? liveData
    : summary
      ? {
          urgent: summary.urgent,
          needsReply: summary.needsReply,
          meetings: summary.meetings,
          documents: summary.documents,
          autoReplied: summary.autoReplied,
          fyi: summary.fyi,
        }
      : null;

  // 1. Attention Items (Urgent & Needs Reply)
  const urgentAttentionItems: AttentionItem[] = (data?.urgent ?? []).map((r) => ({
    id: r.messageId,
    contactId: r.contactId,
    contactName: r.contactName ?? 'Unknown',
    preview: r.preview,
    type: 'urgent',
    onPress: () => openChat(r.contactId),
  }));

  const needsReplyAttentionItems: AttentionItem[] = (data?.needsReply ?? []).map((r) => ({
    id: r.messageId,
    contactId: r.contactId,
    contactName: r.contactName ?? 'Unknown',
    preview: r.preview,
    type: 'needsReply',
    onPress: () => openChat(r.contactId),
  }));

  const allAttentionItems = [...urgentAttentionItems, ...needsReplyAttentionItems];

  const filteredAttentionItems =
    filter === 'urgent'
      ? urgentAttentionItems
      : filter === 'needsReply'
        ? needsReplyAttentionItems
        : allAttentionItems;

  // 2. Meetings
  const pendingMeetingItems: AgendaMeeting[] = (pendingMeetings ?? []).map((entry) => {
    const m = entry.meeting;
    const firstTime = m.proposedTimes?.[0];
    const timeLabel = firstTime
      ? new Date(firstTime.startAt).toLocaleString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : 'Time pending';
    return {
      id: m._id,
      contactId: m.contactId,
      contactName: entry.contactName ?? 'Unknown',
      title: m.title,
      timeLabel,
      isPending: true,
      onPress: () => openChat(m.contactId),
      onDelete: () =>
        confirmDestructive({
          title: 'Delete this meeting?',
          message: 'It clears from your briefing and the chat. The contact is not told anything.',
          confirmLabel: 'Delete',
          onConfirm: () => void removeMeeting({ meetingId: m._id }),
        }),
    };
  });

  const summaryMeetingItems: AgendaMeeting[] = (data?.meetings ?? []).map((r) => ({
    id: r.messageId,
    contactId: r.contactId,
    contactName: r.contactName ?? 'Unknown',
    title: r.preview,
    timeLabel: 'Detected in conversation',
    isPending: false,
    onPress: () => openChat(r.contactId),
  }));

  const allMeetings: AgendaMeeting[] = isToday
    ? [...pendingMeetingItems, ...summaryMeetingItems]
    : summaryMeetingItems;

  // 3. Tasks
  const taskRows = isToday && summary ? summary.tasks : [];

  // 4. Documents & Intelligence
  const documentItems: IntelDocument[] = (data?.documents ?? []).map((r) => ({
    key: r.messageId,
    contactName: r.contactName ?? 'Unknown',
    fileName: r.fileName,
    onPress: () => openChat(r.contactId),
  }));

  const autoRepliedItems: IntelAutoReply[] = (data?.autoReplied ?? []).map((r) => ({
    key: r.messageId,
    contactName: r.contactName ?? 'Unknown',
    preview: r.preview,
    onPress: () => openChat(r.contactId),
  }));

  const fyiItems: IntelFyi[] = (data?.fyi ?? []).map((r) => ({
    key: r.messageId,
    contactName: r.contactName ?? 'Unknown',
    preview: r.preview,
    onPress: () => openChat(r.contactId),
  }));

  const trendItems: IntelTrend[] =
    isToday && summary?.trends
      ? summary.trends.map((t, idx) => ({
          key: `trend-${idx}-${t.label}`,
          label: t.label,
          subtitle:
            t.contactIds.length > 0
              ? `${t.contactIds.length} contact${t.contactIds.length === 1 ? '' : 's'}${
                  t.count ? ` · ${t.count} messages` : ''
                }`
              : t.count
                ? `${t.count} messages`
                : undefined,
          onPress: t.contactIds[0] ? () => openChat(t.contactIds[0] as Id<'contacts'>) : undefined,
        }))
      : [];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        {/* Header Section */}
        <View style={[styles.header, wide && styles.maxWidth]}>
          <ThemedText style={styles.headerTitle} selectable>
            {isToday ? "Today's briefing" : rangeToMs(range, pref?.lastOpenedAt).label}
          </ThemedText>
          {isToday && summary ? (
            <ThemedText type="small" themeColor="textSecondary">
              {formatHeaderDate(summary.date)}
            </ThemedText>
          ) : null}
        </View>

        {/* Range Selector Chips */}
        <View style={[styles.rangeContainer, wide && styles.maxWidth]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.rangeScroll}
            contentContainerStyle={styles.rangeRow}
          >
            {RANGE_OPTIONS.map((opt) => {
              const active = range === opt.key;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  key={opt.key}
                  onPress={() => {
                    setRange(opt.key);
                    setFilter('all');
                  }}
                  style={({ pressed }) => [
                    styles.rangeChip,
                    { borderColor: theme.border, opacity: pressed ? 0.72 : 1 },
                    active && {
                      backgroundColor: theme.primary,
                      borderColor: theme.primary,
                    },
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[styles.rangeLabel, { color: active ? theme.primaryText : theme.text }]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {usingLive && liveLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.primary} />
          </View>
        ) : (
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={[styles.scroll, wide && styles.scrollWide]}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.primary}
              />
            }
          >
            {/* 1. Executive Focus Pulse Card */}
            <BriefingPulseCard
              urgentCount={urgentAttentionItems.length}
              needsReplyCount={needsReplyAttentionItems.length}
              meetingsCount={allMeetings.length}
              tasksCount={taskRows.length}
              activeFilter={filter}
              onSelectFilter={setFilter}
            />

            {/* 2. Unified Action Center (Urgent & Needs Reply Feed) */}
            {filter === 'all' || filter === 'urgent' || filter === 'needsReply' ? (
              <AttentionFeed items={filteredAttentionItems} />
            ) : null}

            {/* 3. Action Plan & Extracted Tasks */}
            {filter === 'all' || filter === 'tasks' ? (
              <>
                {isToday && summary && (summary.actionPlan?.length ?? 0) > 0 ? (
                  <ActionPlanCard summary={summary} />
                ) : null}

                {taskRows.length > 0 ? (
                  <View style={styles.tasksSection}>
                    <View style={styles.tasksHeader}>
                      <Text style={[styles.tasksTitle, { color: theme.text }]}>
                        Extracted Tasks
                      </Text>
                      <Pressable onPress={() => router.push('/(tabs)/tasks')} hitSlop={6}>
                        <Text style={[styles.viewAllTasks, { color: theme.primary }]}>
                          View all tasks ›
                        </Text>
                      </Pressable>
                    </View>
                    <View style={styles.tasksList}>
                      {taskRows.map((t) => (
                        <Pressable
                          key={t.taskId}
                          onPress={() => router.push('/(tabs)/tasks')}
                          style={[
                            styles.taskItem,
                            {
                              backgroundColor: theme.backgroundElement,
                              borderColor: theme.border,
                            },
                          ]}
                        >
                          <View style={[styles.taskBullet, { backgroundColor: '#F59E0B' }]} />
                          <View style={styles.taskTextGroup}>
                            <Text
                              numberOfLines={1}
                              style={[styles.taskItemTitle, { color: theme.text }]}
                            >
                              {t.title}
                            </Text>
                            {t.dueAt ? (
                              <Text style={[styles.taskDueText, { color: theme.textSecondary }]}>
                                Due {new Date(t.dueAt).toLocaleDateString()}
                              </Text>
                            ) : null}
                          </View>
                          <Text style={[styles.taskArrow, { color: theme.textSecondary }]}>›</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : null}
              </>
            ) : null}

            {/* 4. Scheduled & Pending Meetings */}
            {filter === 'all' || filter === 'meetings' ? (
              <MeetingAgenda meetings={allMeetings} />
            ) : null}

            {/* 5. Intelligence Bento: Documents, AI Activity & Trends */}
            {filter === 'all' ? (
              <IntelBento
                documents={documentItems}
                autoReplied={autoRepliedItems}
                fyi={fyiItems}
                trends={trendItems}
              />
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  header: {
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
    gap: Spacing.one,
  },
  headerTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontFamily: Fonts.sansBold,
    letterSpacing: -0.4,
  },
  maxWidth: { maxWidth: 1180 },
  rangeContainer: {
    width: '100%',
    alignSelf: 'center',
    paddingBottom: Spacing.two,
  },
  rangeScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  rangeRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
  },
  rangeChip: {
    alignSelf: 'center',
    paddingHorizontal: 16,
    height: 38,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rangeLabel: {
    textAlign: 'center',
    fontFamily: Fonts.sansSemiBold,
    fontSize: 13,
  },
  scroll: {
    padding: Spacing.four,
    paddingTop: 8,
    paddingBottom: 88,
    gap: 16,
    width: '100%',
    alignSelf: 'center',
  },
  scrollWide: { maxWidth: 920 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 24,
  },
  cta: {
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
  },
  tasksSection: {
    gap: 10,
  },
  tasksHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  tasksTitle: {
    fontSize: 16,
    fontFamily: Fonts.sansBold,
    letterSpacing: -0.2,
  },
  viewAllTasks: {
    fontSize: 13,
    fontFamily: Fonts.sansSemiBold,
  },
  tasksList: {
    gap: 8,
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  taskBullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  taskTextGroup: {
    flex: 1,
    gap: 2,
  },
  taskItemTitle: {
    fontSize: 14,
    fontFamily: Fonts.sansSemiBold,
  },
  taskDueText: {
    fontSize: 12,
    fontFamily: Fonts.sans,
  },
  taskArrow: {
    fontSize: 16,
    fontFamily: Fonts.sansBold,
  },
});
