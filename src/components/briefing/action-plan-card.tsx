import { useMutation } from 'convex/react';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
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

  const onOpenContact = (contactId: Id<'contacts'> | undefined) => {
    if (!contactId) return;
    router.push({
      pathname: '/chat/[contactId]',
      params: { contactId },
    });
  };

  const onLongPress = (order: number, done: boolean) => {
    if (done) return;
    Alert.alert('Mark this item done?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark done',
        onPress: () => markDone({ summaryId: summary._id, order }),
      },
    ]);
  };

  const priorityColor = (p: string): string => {
    if (p === 'urgent') return '#B91C1C';
    if (p === 'high') return '#92400E';
    return theme.textSecondary;
  };

  return (
    <View
      style={[styles.wrap, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
    >
      <ThemedText type="smallBold">Today’s plan</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: 2, marginBottom: 8 }}>
        Tap to open the chat · long-press to mark done
      </ThemedText>

      {plan.map((item) => {
        const done = !!item.doneAt;
        return (
          <Pressable
            key={item.order}
            onPress={() => onOpenContact(item.contactId)}
            onLongPress={() => onLongPress(item.order, done)}
            delayLongPress={350}
            style={({ pressed }) => [
              styles.row,
              { borderBottomColor: theme.border },
              pressed && { opacity: 0.7 },
            ]}
          >
            <View
              style={[
                styles.numberCircle,
                { borderColor: priorityColor(item.priority) },
                done && { opacity: 0.4 },
              ]}
            >
              <Text style={[styles.numberText, { color: priorityColor(item.priority) }]}>
                {item.order}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.action,
                  { color: theme.text },
                  done && {
                    textDecorationLine: 'line-through',
                    color: theme.textSecondary,
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
            </View>
            {done ? <Text style={{ color: theme.textSecondary, fontSize: 16 }}>✓</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  numberCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberText: { fontSize: 12, fontWeight: '700' },
  action: { fontSize: 14, fontWeight: '600' },
  reason: { fontSize: 11, marginTop: 2 },
});
