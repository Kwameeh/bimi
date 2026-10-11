import { useMutation } from 'convex/react';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { confirmDestructive } from '@/components/ui/selection-bar';
import { useTheme } from '@/hooks/use-theme';
import { addMeetingToCalendar } from '@/lib/calendar';

import { api } from '../../../convex/_generated/api';
import type { Doc } from '../../../convex/_generated/dataModel';

import { MeetingCounterSheet } from './meeting-counter-sheet';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function MeetingCard({ meeting }: { meeting: Doc<'meetings'> }) {
  const theme = useTheme();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [counterOpen, setCounterOpen] = useState(false);

  const acceptMeeting = useMutation(api.meetings.acceptMeeting);
  const declineMeeting = useMutation(api.meetings.declineMeeting);
  const markAddedToCalendar = useMutation(api.meetings.markAddedToCalendar);
  const removeMeeting = useMutation(api.meetings.remove);

  const proposedTimes = meeting.proposedTimes ?? [];
  const status = meeting.status;
  const selectedStartAt = meeting.selectedStartAt ?? proposedTimes[selectedIdx]?.startAt ?? null;

  const onAccept = async () => {
    if (busy) return;
    setBusy('accept');
    try {
      await acceptMeeting({
        meetingId: meeting._id,
        startAt: proposedTimes[selectedIdx]?.startAt,
      });
    } catch (err) {
      Alert.alert('Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  // Declining tells the contact something; deleting just clears a card the
  // extractor got wrong. Both need to exist, and only the first one did.
  const onDelete = () => {
    if (busy) return;
    confirmDestructive({
      title: 'Delete this meeting card?',
      message:
        'It disappears from your briefing and this chat. The original message is untouched, and the contact is not told anything.',
      confirmLabel: 'Delete',
      onConfirm: () => {
        void removeMeeting({ meetingId: meeting._id }).catch((err) =>
          Alert.alert('Failed', err instanceof Error ? err.message : String(err)),
        );
      },
    });
  };

  const onDecline = async () => {
    if (busy) return;
    setBusy('decline');
    try {
      await declineMeeting({ meetingId: meeting._id });
    } catch (err) {
      Alert.alert('Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const onAddToCalendar = async () => {
    if (!selectedStartAt) return;
    setBusy('cal');
    try {
      const result = await addMeetingToCalendar({
        title: meeting.title ?? 'Meeting',
        startAt: selectedStartAt,
        durationMinutes: proposedTimes[selectedIdx]?.durationMinutes ?? 30,
      });
      if ('error' in result) {
        Alert.alert('Calendar', result.error);
      } else {
        await markAddedToCalendar({
          meetingId: meeting._id,
          calendarEventId: result.eventId,
        });
      }
    } finally {
      setBusy(null);
    }
  };

  if (status === 'declined') return null;

  const isAccepted = status === 'accepted';
  const isRescheduled = status === 'rescheduled';
  const alreadyOnCalendar = meeting.addedToCalendarAt !== undefined;

  return (
    <View
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.headerText, { color: theme.text }]}>{meeting.title ?? 'Meeting'}</Text>
        <Pressable onPress={onDelete} hitSlop={8} disabled={busy !== null}>
          <Text style={{ color: theme.textSecondary, fontSize: 18 }}>×</Text>
        </Pressable>
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor: isAccepted ? '#DCFCE7' : isRescheduled ? '#FEF3C7' : '#E0E7FF',
            },
          ]}
        >
          <Text
            style={[
              styles.statusText,
              {
                color: isAccepted ? '#166534' : isRescheduled ? '#92400E' : '#3730A3',
              },
            ]}
          >
            {isAccepted ? 'Accepted' : isRescheduled ? 'Counter-proposed' : 'Pending'}
          </Text>
        </View>
      </View>

      {proposedTimes.length > 0 ? (
        <View style={{ gap: 6 }}>
          {proposedTimes.map((t, idx) => {
            const active = isAccepted ? meeting.selectedStartAt === t.startAt : selectedIdx === idx;
            return (
              <Pressable
                key={`${t.startAt}-${idx}`}
                onPress={() => {
                  if (!isAccepted) setSelectedIdx(idx);
                }}
                disabled={isAccepted || isRescheduled}
                style={[styles.timeRow, { borderColor: active ? theme.primary : theme.border }]}
              >
                <View
                  style={[
                    styles.radio,
                    { borderColor: active ? theme.primary : theme.border },
                    active && { backgroundColor: theme.primary },
                  ]}
                />
                <Text style={[styles.timeText, { color: theme.text }]}>
                  {formatTime(t.startAt)}
                </Text>
                {t.label ? (
                  <Text style={[styles.timeLabel, { color: theme.textSecondary }]}>{t.label}</Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text style={[styles.noTimeText, { color: theme.textSecondary }]}>
          No specific time proposed.
        </Text>
      )}

      <View style={styles.actionRow}>
        {isAccepted ? (
          <Pressable
            onPress={onAddToCalendar}
            disabled={busy !== null || alreadyOnCalendar}
            style={[
              styles.btn,
              styles.btnPrimary,
              { backgroundColor: theme.primary },
              (busy !== null || alreadyOnCalendar) && { opacity: 0.5 },
            ]}
          >
            {busy === 'cal' ? (
              <ActivityIndicator size="small" color={theme.primaryText} />
            ) : (
              <Text style={{ color: theme.primaryText, fontWeight: '700' }}>
                {alreadyOnCalendar ? 'Added to calendar' : 'Add to calendar'}
              </Text>
            )}
          </Pressable>
        ) : (
          <>
            <Pressable
              onPress={onDecline}
              disabled={busy !== null}
              style={[styles.btn, { borderColor: theme.border }]}
            >
              <Text style={{ color: theme.danger ?? '#EF4444' }}>Decline</Text>
            </Pressable>
            <Pressable
              onPress={() => setCounterOpen(true)}
              disabled={busy !== null}
              style={[styles.btn, { borderColor: theme.border }]}
            >
              <Text style={{ color: theme.text }}>Suggest other</Text>
            </Pressable>
            <Pressable
              onPress={onAccept}
              disabled={busy !== null || proposedTimes.length === 0}
              style={[
                styles.btn,
                styles.btnPrimary,
                { backgroundColor: theme.primary },
                (busy !== null || proposedTimes.length === 0) && { opacity: 0.5 },
              ]}
            >
              {busy === 'accept' ? (
                <ActivityIndicator size="small" color={theme.primaryText} />
              ) : (
                <Text style={{ color: theme.primaryText, fontWeight: '700' }}>Accept</Text>
              )}
            </Pressable>
          </>
        )}
      </View>

      {meeting.confirmationDraftId ? (
        <Text style={[styles.draftHint, { color: theme.textSecondary }]}>
          {isRescheduled
            ? 'Counter-proposal draft saved — open the drafts pill to review and send.'
            : 'Confirmation draft saved — open the drafts pill to review and send.'}
        </Text>
      ) : null}

      <MeetingCounterSheet
        visible={counterOpen}
        meetingId={meeting._id}
        onClose={() => setCounterOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 6,
    marginHorizontal: 12,
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerText: { fontSize: 14, fontWeight: '700', flex: 1 },
  statusBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  statusText: { fontSize: 10, fontWeight: '700' },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  radio: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5 },
  timeText: { fontSize: 13, fontWeight: '600' },
  timeLabel: { fontSize: 12 },
  noTimeText: { fontSize: 12, fontStyle: 'italic' },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { borderWidth: 0 },
  draftHint: { fontSize: 11, fontStyle: 'italic' },
});
