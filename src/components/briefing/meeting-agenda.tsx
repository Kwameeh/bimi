import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type AgendaMeeting = {
  id: string;
  contactId: string;
  contactName: string;
  title?: string;
  timeLabel: string;
  isPending?: boolean;
  onPress: () => void;
  onDelete?: () => void;
};

type Props = {
  meetings: AgendaMeeting[];
};

export function MeetingAgenda({ meetings }: Props) {
  const theme = useTheme();

  if (meetings.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>
          Scheduled & Pending Meetings
        </Text>
        <View style={[styles.countBadge, { backgroundColor: '#8B7FFF20' }]}>
          <Text style={[styles.countBadgeText, { color: '#8B7FFF' }]}>{meetings.length}</Text>
        </View>
      </View>

      <View style={styles.list}>
        {meetings.map((m) => (
          <Pressable
            key={m.id}
            onPress={m.onPress}
            style={({ pressed }) => [
              styles.card,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <View style={styles.cardHeader}>
              <View style={[styles.timeChip, { backgroundColor: '#8B7FFF18' }]}>
                <Text style={styles.timeIcon}>◷</Text>
                <Text style={[styles.timeText, { color: '#8B7FFF' }]}>{m.timeLabel}</Text>
              </View>

              {m.isPending ? (
                <View style={[styles.pendingPill, { backgroundColor: `${theme.primary}18` }]}>
                  <Text style={[styles.pendingPillText, { color: theme.primary }]}>PENDING</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.body}>
              <Text style={[styles.contactName, { color: theme.text }]}>{m.contactName}</Text>
              {m.title ? (
                <Text
                  numberOfLines={2}
                  style={[styles.meetingTitle, { color: theme.textSecondary }]}
                >
                  {m.title}
                </Text>
              ) : null}
            </View>

            <View style={styles.footer}>
              {m.onDelete ? (
                <Pressable
                  hitSlop={8}
                  onPress={(e) => {
                    e.stopPropagation();
                    m.onDelete?.();
                  }}
                  style={styles.dismissBtn}
                >
                  <Text style={[styles.dismissText, { color: theme.textSecondary }]}>Dismiss</Text>
                </Pressable>
              ) : (
                <View />
              )}

              <View style={styles.chatAction}>
                <Text style={[styles.chatActionLabel, { color: theme.primary }]}>Open chat</Text>
                <Text style={[styles.arrow, { color: theme.primary }]}>›</Text>
              </View>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: Fonts.sansBold,
    letterSpacing: -0.2,
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  countBadgeText: {
    fontSize: 11,
    fontFamily: Fonts.sansBold,
  },
  list: {
    gap: 10,
  },
  card: {
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  timeIcon: {
    fontSize: 13,
    color: '#8B7FFF',
  },
  timeText: {
    fontSize: 12,
    fontFamily: Fonts.sansBold,
  },
  pendingPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  pendingPillText: {
    fontSize: 10,
    fontFamily: Fonts.sansBold,
    letterSpacing: 0.5,
  },
  body: {
    gap: 3,
  },
  contactName: {
    fontSize: 15,
    fontFamily: Fonts.sansBold,
  },
  meetingTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: Fonts.sans,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  dismissBtn: {
    paddingVertical: 2,
  },
  dismissText: {
    fontSize: 12,
    fontFamily: Fonts.sansSemiBold,
  },
  chatAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  chatActionLabel: {
    fontSize: 12,
    fontFamily: Fonts.sansSemiBold,
  },
  arrow: {
    fontSize: 15,
    fontFamily: Fonts.sansBold,
  },
});
