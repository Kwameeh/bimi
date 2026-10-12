import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from 'react-native';
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

function badgeStyles(
  theme: ReturnType<typeof useTheme>,
  isDark: boolean,
): Record<keyof ChatBadges, BadgeStyle> {
  if (isDark) {
    return {
      urgent: { bg: 'rgba(239, 68, 68, 0.22)', fg: '#FCA5A5', label: 'Urgent' },
      mentioned: { bg: 'rgba(139, 92, 246, 0.22)', fg: '#DDD6FE', label: '@You' },
      needsReply: { bg: 'rgba(245, 158, 11, 0.22)', fg: '#FDE68A', label: 'Needs Reply' },
      draftReady: { bg: 'rgba(99, 102, 241, 0.22)', fg: '#C7D2FE', label: 'Draft Ready' },
      deadline: { bg: 'rgba(244, 63, 94, 0.22)', fg: '#FECDD3', label: 'Deadline' },
      meeting: { bg: 'rgba(59, 130, 246, 0.22)', fg: '#BAE6FD', label: 'Meeting' },
      muted: { bg: theme.backgroundElement, fg: theme.textSecondary, label: 'Muted' },
      autoReplied: { bg: 'rgba(16, 185, 129, 0.22)', fg: '#A7F3D0', label: 'Auto-Replied' },
    };
  }
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
  const scheme = useColorScheme();
  const styleMap = badgeStyles(theme, scheme === 'dark');
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
