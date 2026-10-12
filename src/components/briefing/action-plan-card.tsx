import { useMutation } from 'convex/react';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { api } from '../../../convex/_generated/api';
import type { Doc, Id } from '../../../convex/_generated/dataModel';

type Props = {
  summary: Doc<'dailySummaries'>;
};

export function ActionPlanCard({ summary }: Props) {
  const theme = useTheme();
  const router = useRouter();
  const markDone = useMutation(api.summaries.markActionPlanItemDone);
  const plan = summary.actionPlan ?? [];

  if (plan.length === 0) return null;

  const completedCount = plan.filter((item) => Boolean(item.doneAt)).length;
  const progressRatio = plan.length > 0 ? completedCount / plan.length : 0;

  const onOpenContact = (contactId: Id<'contacts'> | undefined) => {
    if (!contactId) return;
    router.push({
      pathname: '/chat/[contactId]',
      params: { contactId },
    });
  };

  const handleToggle = (order: number, done: boolean) => {
    if (done) return;
    void markDone({ summaryId: summary._id, order });
  };

  const priorityColor = (p: string): string => {
    if (p === 'urgent') return theme.danger;
    if (p === 'high') return '#F59E0B';
    return theme.textSecondary;
  };

  return (
    <View
      style={[
        styles.wrap,
        {
          borderColor: theme.border,
          backgroundColor: theme.backgroundElement,
          shadowColor: '#000',
          shadowOpacity: 0.04,
          shadowOffset: { width: 0, height: 4 },
          shadowRadius: 10,
          elevation: 2,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.headerTitleGroup}>
          <Text style={[styles.title, { color: theme.text }]}>Today’s Plan</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            {completedCount === plan.length
              ? 'All priorities completed!'
              : `${completedCount} of ${plan.length} completed`}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: `${theme.primary}15` }]}>
          <Text style={[styles.badgeText, { color: theme.primary }]}>
            {Math.round(progressRatio * 100)}%
          </Text>
        </View>
      </View>

      <View style={[styles.progressBarBg, { backgroundColor: theme.surface }]}>
        <View
          style={[
            styles.progressBarFill,
            {
              backgroundColor: theme.primary,
              width: `${Math.max(progressRatio * 100, 4)}%`,
            },
          ]}
        />
      </View>

      <View style={styles.list}>
        {plan.map((item) => {
          const done = Boolean(item.doneAt);
          const pColor = priorityColor(item.priority);

          return (
            <View
              key={item.order}
              style={[
                styles.row,
                {
                  borderBottomColor: theme.border,
                  opacity: done ? 0.6 : 1,
                },
              ]}
            >
              <Pressable
                hitSlop={8}
                onPress={() => handleToggle(item.order, done)}
                style={[
                  styles.checkbox,
                  {
                    borderColor: done ? theme.primary : pColor,
                    backgroundColor: done ? theme.primary : 'transparent',
                  },
                ]}
              >
                {done ? (
                  <Text style={[styles.checkText, { color: theme.primaryText }]}>✓</Text>
                ) : (
                  <Text style={[styles.orderText, { color: pColor }]}>{item.order}</Text>
                )}
              </Pressable>

              <Pressable onPress={() => onOpenContact(item.contactId)} style={styles.textContainer}>
                <Text
                  style={[
                    styles.action,
                    {
                      color: theme.text,
                      textDecorationLine: done ? 'line-through' : 'none',
                    },
                  ]}
                >
                  {item.action}
                </Text>
                {item.reason ? (
                  <Text style={[styles.reason, { color: theme.textSecondary }]} numberOfLines={2}>
                    {item.reason}
                  </Text>
                ) : null}
              </Pressable>

              {item.contactId ? (
                <Pressable
                  hitSlop={6}
                  onPress={() => onOpenContact(item.contactId)}
                  style={styles.openChatIcon}
                >
                  <Text style={[styles.arrow, { color: theme.textSecondary }]}>›</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 18,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitleGroup: {
    gap: 2,
  },
  title: {
    fontSize: 16,
    fontFamily: Fonts.sansBold,
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: Fonts.sans,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: Fonts.sansBold,
  },
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  list: {
    paddingTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkText: {
    fontSize: 12,
    fontFamily: Fonts.sansBold,
  },
  orderText: {
    fontSize: 11,
    fontFamily: Fonts.sansBold,
  },
  textContainer: {
    flex: 1,
    gap: 2,
  },
  action: {
    fontSize: 14,
    lineHeight: 19,
    fontFamily: Fonts.sansSemiBold,
  },
  reason: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: Fonts.sans,
  },
  openChatIcon: {
    paddingHorizontal: 4,
  },
  arrow: {
    fontSize: 18,
    fontFamily: Fonts.sansBold,
  },
});
