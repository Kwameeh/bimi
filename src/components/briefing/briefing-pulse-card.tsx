import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type FilterCategory = 'all' | 'urgent' | 'needsReply' | 'meetings' | 'tasks';

type Props = {
  urgentCount: number;
  needsReplyCount: number;
  meetingsCount: number;
  tasksCount: number;
  activeFilter: FilterCategory;
  onSelectFilter: (filter: FilterCategory) => void;
};

export function BriefingPulseCard({
  urgentCount,
  needsReplyCount,
  meetingsCount,
  tasksCount,
  activeFilter,
  onSelectFilter,
}: Props) {
  const theme = useTheme();
  const totalAttention = urgentCount + needsReplyCount + meetingsCount;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.border,
          shadowColor: '#000',
          shadowOpacity: 0.04,
          shadowOffset: { width: 0, height: 4 },
          shadowRadius: 12,
          elevation: 2,
        },
      ]}
    >
      <View style={styles.topRow}>
        <View style={styles.headerTextGroup}>
          <View style={styles.statusBadgeRow}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor: totalAttention > 0 ? theme.danger : theme.primary,
                },
              ]}
            />
            <Text
              style={[
                styles.statusBadgeText,
                { color: totalAttention > 0 ? theme.danger : theme.primary },
              ]}
            >
              {totalAttention > 0 ? 'ATTENTION REQUIRED' : 'ALL CAUGHT UP'}
            </Text>
          </View>
          <Text style={[styles.title, { color: theme.text }]}>
            {totalAttention > 0
              ? `${totalAttention} item${totalAttention === 1 ? '' : 's'} need your review`
              : 'You are completely caught up!'}
          </Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            {totalAttention > 0
              ? 'Review pending responses and urgent messages to keep your chats moving.'
              : 'No urgent flags, unanswered requests, or pending commitments right now.'}
          </Text>
        </View>
      </View>

      <View style={styles.pillsRow}>
        <Pressable
          onPress={() => onSelectFilter('all')}
          style={({ pressed }) => [
            styles.pill,
            {
              borderColor: activeFilter === 'all' ? theme.primary : theme.border,
              backgroundColor: activeFilter === 'all' ? theme.primary : theme.surface,
              opacity: pressed ? 0.75 : 1,
            },
          ]}
        >
          <Text
            style={[
              styles.pillLabel,
              { color: activeFilter === 'all' ? theme.primaryText : theme.text },
            ]}
          >
            All
          </Text>
        </Pressable>

        {urgentCount > 0 ? (
          <Pressable
            onPress={() => onSelectFilter(activeFilter === 'urgent' ? 'all' : 'urgent')}
            style={({ pressed }) => [
              styles.pill,
              {
                borderColor: activeFilter === 'urgent' ? theme.danger : theme.border,
                backgroundColor: activeFilter === 'urgent' ? `${theme.danger}20` : theme.surface,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <View style={[styles.pillDot, { backgroundColor: theme.danger }]} />
            <Text style={[styles.pillLabel, { color: theme.danger }]}>{urgentCount} Urgent</Text>
          </Pressable>
        ) : null}

        {needsReplyCount > 0 ? (
          <Pressable
            onPress={() => onSelectFilter(activeFilter === 'needsReply' ? 'all' : 'needsReply')}
            style={({ pressed }) => [
              styles.pill,
              {
                borderColor: activeFilter === 'needsReply' ? theme.primary : theme.border,
                backgroundColor:
                  activeFilter === 'needsReply' ? `${theme.primary}20` : theme.surface,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <View style={[styles.pillDot, { backgroundColor: theme.primary }]} />
            <Text style={[styles.pillLabel, { color: theme.primary }]}>
              {needsReplyCount} Need reply
            </Text>
          </Pressable>
        ) : null}

        {meetingsCount > 0 ? (
          <Pressable
            onPress={() => onSelectFilter(activeFilter === 'meetings' ? 'all' : 'meetings')}
            style={({ pressed }) => [
              styles.pill,
              {
                borderColor: activeFilter === 'meetings' ? '#8B7FFF' : theme.border,
                backgroundColor: activeFilter === 'meetings' ? '#8B7FFF20' : theme.surface,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <View style={[styles.pillDot, { backgroundColor: '#8B7FFF' }]} />
            <Text style={[styles.pillLabel, { color: '#8B7FFF' }]}>{meetingsCount} Meetings</Text>
          </Pressable>
        ) : null}

        {tasksCount > 0 ? (
          <Pressable
            onPress={() => onSelectFilter(activeFilter === 'tasks' ? 'all' : 'tasks')}
            style={({ pressed }) => [
              styles.pill,
              {
                borderColor: activeFilter === 'tasks' ? '#F59E0B' : theme.border,
                backgroundColor: activeFilter === 'tasks' ? '#F59E0B20' : theme.surface,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <View style={[styles.pillDot, { backgroundColor: '#F59E0B' }]} />
            <Text style={[styles.pillLabel, { color: '#F59E0B' }]}>{tasksCount} Tasks</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    gap: 14,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerTextGroup: {
    flex: 1,
    gap: 6,
  },
  statusBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusBadgeText: {
    fontSize: 11,
    fontFamily: Fonts.sansBold,
    letterSpacing: 0.8,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    fontFamily: Fonts.sansBold,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: Fonts.sans,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 4,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pillLabel: {
    fontSize: 12,
    fontFamily: Fonts.sansSemiBold,
  },
});
