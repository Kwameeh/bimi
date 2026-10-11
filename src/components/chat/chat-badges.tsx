import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export type ChatBadges = {
  urgent: boolean;
  needsReply: boolean;
  draftReady: boolean;
  deadline: boolean;
  meeting: boolean;
  muted: boolean;
  autoReplied: boolean;
  mentioned: boolean;
};

type BadgeStyle = { bg: string; fg: string; label: string };

function badgeStyles(theme: ReturnType<typeof useTheme>): Record<keyof ChatBadges, BadgeStyle> {
  return {
    urgent: { bg: '#FEE2E2', fg: '#B91C1C', label: 'Urgent' },
    mentioned: { bg: '#EDE9FE', fg: '#5B21B6', label: '@You' },
    needsReply: { bg: '#FEF3C7', fg: '#92400E', label: 'Needs Reply' },
    draftReady: { bg: '#E0E7FF', fg: '#3730A3', label: 'Draft Ready' },
    deadline: { bg: '#FFE4E6', fg: '#9F1239', label: 'Deadline' },
    meeting: { bg: '#DBEAFE', fg: '#1E40AF', label: 'Meeting' },
    muted: { bg: theme.backgroundElement, fg: theme.textSecondary, label: 'Muted' },
    autoReplied: { bg: '#DCFCE7', fg: '#166534', label: 'Auto-Replied' },
  };
}

const ORDER: (keyof ChatBadges)[] = [
  'urgent',
  'mentioned',
  'needsReply',
  'deadline',
  'meeting',
  'draftReady',
  'autoReplied',
  'muted',
];

export function ChatBadgeRow({ badges }: { badges: ChatBadges }) {
  const theme = useTheme();
  const styleMap = badgeStyles(theme);
  const active = ORDER.filter((k) => badges[k]);
  if (active.length === 0) return null;
  return (
    <View style={styles.row}>
      {active.map((k) => {
        const s = styleMap[k];
        return (
          <View key={k} style={[styles.badge, { backgroundColor: s.bg }]}>
            <Text style={[styles.text, { color: s.fg }]}>{s.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  text: { fontSize: 10, fontWeight: '700', letterSpacing: 0.2 },
});
