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
import { BriefingSection, type SectionRow } from '@/components/briefing/section-list';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { confirmDestructive } from '@/components/ui/selection-bar';
import { Spacing } from '@/constants/theme';
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

  // Choose source based on mode
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

  const urgentRows: SectionRow[] = (data?.urgent ?? []).map((r) => ({
    key: r.messageId,
    title: r.contactName ?? 'Unknown',
    subtitle: r.preview,
    onPress: () => openChat(r.contactId),
  }));
  const needsReplyRows: SectionRow[] = (data?.needsReply ?? []).map((r) => ({
    key: r.messageId,
    title: r.contactName ?? 'Unknown',
    subtitle: r.preview,
    onPress: () => openChat(r.contactId),
  }));
  const taskRows: SectionRow[] =
    isToday && summary
      ? summary.tasks.map((t) => ({
          key: t.taskId,
          title: t.title,
          subtitle: t.dueAt ? `Due ${new Date(t.dueAt).toLocaleDateString()}` : undefined,
        }))
      : [];
  const meetingRows: SectionRow[] = (data?.meetings ?? []).map((r) => ({
    key: r.messageId,
    title: r.contactName ?? 'Unknown',
    subtitle: r.preview,
    onPress: () => openChat(r.contactId),
  }));
  const documentRows: SectionRow[] = (data?.documents ?? []).map((r) => ({
    key: r.messageId,
    title: r.contactName ?? 'Unknown',
    subtitle: r.fileName,
    onPress: () => openChat(r.contactId),
  }));
  const autoRepliedRows: SectionRow[] = (data?.autoReplied ?? []).map((r) => ({
    key: r.messageId,
    title: r.contactName ?? 'Unknown',
    subtitle: r.preview,
    onPress: () => openChat(r.contactId),
  }));
  const fyiRows: SectionRow[] = (data?.fyi ?? []).map((r) => ({
    key: r.messageId,
    title: r.contactName ?? 'Unknown',
    subtitle: r.preview,
    onPress: () => openChat(r.contactId),
  }));
  const trendRows: SectionRow[] =
    isToday && summary?.trends
      ? summary.trends.map((t, idx) => ({
          key: `trend-${idx}-${t.label}`,
          title: t.label,
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

        <View style={[styles.rangeContainer, wide && styles.maxWidth]}>
          <View style={styles.rangeRow}>
            {RANGE_OPTIONS.map((opt) => {
              const active = range === opt.key;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  key={opt.key}
                  onPress={() => setRange(opt.key)}
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
                    numberOfLines={2}
                    style={[styles.rangeLabel, { color: active ? theme.primaryText : theme.text }]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
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
            <View
              style={[
                styles.summaryStrip,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            >
              <View>
                <Text style={[styles.summaryNumber, { color: theme.danger }]}>
                  {urgentRows.length}
                </Text>
                <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>Urgent</Text>
              </View>
              <View style={[styles.summaryDivider, { backgroundColor: theme.border }]} />
              <View>
                <Text style={[styles.summaryNumber, { color: theme.primary }]}>
                  {needsReplyRows.length}
                </Text>
                <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>
                  Need reply
                </Text>
              </View>
              <View style={[styles.summaryDivider, { backgroundColor: theme.border }]} />
              <View>
                <Text style={[styles.summaryNumber, { color: theme.text }]}>{taskRows.length}</Text>
                <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>Tasks</Text>
              </View>
            </View>
            <View style={[styles.grid, wide && styles.gridWide]}>
              {isToday && summary && (summary.actionPlan?.length ?? 0) > 0 ? (
                <View style={styles.gridItem}>
                  <ActionPlanCard summary={summary} />
                </View>
              ) : null}
              {isToday ? (
                <BriefingSection
                  title="Pending meetings"
                  rows={(pendingMeetings ?? []).map((entry) => {
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
                      : 'No time proposed';
                    return {
                      key: m._id,
                      title: entry.contactName ?? 'Unknown',
                      subtitle: `${timeLabel}${m.title ? ` · ${m.title}` : ''}`,
                      onPress: () =>
                        router.push({
                          pathname: '/chat/[contactId]',
                          params: { contactId: m.contactId },
                        }),
                      // Meetings are extracted automatically, so a misread used to
                      // sit here permanently with no way to clear it.
                      onDelete: () =>
                        confirmDestructive({
                          title: 'Delete this meeting?',
                          message:
                            'It clears from your briefing and the chat. The contact is not told anything.',
                          confirmLabel: 'Delete',
                          onConfirm: () => void removeMeeting({ meetingId: m._id }),
                        }),
                    };
                  })}
                  emptyText="No pending meetings."
                  defaultOpen
                  accent="#8B7FFF"
                  icon="◷"
                />
              ) : null}
              <BriefingSection
                title="Urgent"
                rows={urgentRows}
                emptyText="Nothing urgent."
                accent={theme.danger}
                icon="!"
              />
              <BriefingSection
                title="Needs reply"
                rows={needsReplyRows}
                emptyText="No messages waiting for a reply."
                accent={theme.primary}
                icon="↩"
              />
              {isToday ? (
                <BriefingSection
                  title="Tasks"
                  rows={taskRows}
                  emptyText="No new tasks."
                  accent="#F59E0B"
                  icon="✓"
                />
              ) : null}
              <BriefingSection
                title="Meetings"
                rows={meetingRows}
                emptyText="No meetings detected."
                accent="#8B7FFF"
                icon="◷"
              />
              <BriefingSection
                title="Documents"
                rows={documentRows}
                emptyText="No documents received."
                accent="#14B8A6"
                icon="□"
              />
              <BriefingSection
                title="Auto-replied"
                rows={autoRepliedRows}
                emptyText="Bimi didn't auto-reply to anything."
                accent="#22C55E"
                icon="↗"
              />
              <BriefingSection
                title="FYI"
                rows={fyiRows}
                emptyText="No FYI updates."
                defaultOpen={false}
                accent="#64748B"
                icon="i"
              />
              {isToday ? (
                <BriefingSection
                  title="Trends & patterns"
                  rows={trendRows}
                  emptyText="No notable patterns today."
                  defaultOpen
                  accent="#EC4899"
                  icon="⌁"
                />
              ) : null}
            </View>
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
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  maxWidth: { maxWidth: 1180 },
  rangeContainer: {
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  rangeRow: {
    flexDirection: 'row',
    gap: 6,
    width: '100%',
  },
  rangeChip: {
    flex: 1,
    minWidth: 0,
    height: 42,
    paddingHorizontal: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rangeLabel: {
    textAlign: 'center',
    fontWeight: '600',
    fontSize: 11,
    lineHeight: 13,
  },
  scroll: {
    padding: Spacing.four,
    paddingTop: 8,
    gap: 16,
    width: '100%',
    alignSelf: 'center',
  },
  scrollWide: { maxWidth: 920 },
  grid: { gap: 14 },
  gridWide: { gap: 16 },
  gridItem: { minWidth: 340, flexGrow: 1, flexBasis: 480 },
  summaryStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    borderCurve: 'continuous',
    paddingVertical: 14,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.06)',
  },
  summaryNumber: {
    textAlign: 'center',
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  summaryLabel: { fontSize: 11, lineHeight: 16, fontWeight: '600' },
  summaryDivider: { width: StyleSheet.hairlineWidth, height: 30 },
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
});
