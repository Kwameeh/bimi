import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

export type SectionRow = {
  key: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  /** Renders a dismiss control on the row. Sections without it are read-only. */
  onDelete?: () => void;
};

type Props = {
  title: string;
  rows: SectionRow[];
  emptyText: string;
  defaultOpen?: boolean;
  accent?: string;
  icon?: string;
};

export function BriefingSection({
  title,
  rows,
  emptyText,
  defaultOpen,
  accent = '#3B9DF8',
  icon = '•',
}: Props) {
  const theme = useTheme();
  const initial = defaultOpen ?? rows.length > 0;
  const [open, setOpen] = useState(initial);

  return (
    <View
      style={[
        styles.section,
        {
          borderColor: theme.border,
          backgroundColor: theme.backgroundElement,
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.08)',
        },
      ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.header, pressed && { opacity: 0.7 }]}>
        <View style={styles.headingGroup}>
          <View style={[styles.icon, { backgroundColor: `${accent}20` }]}>
            <Text style={[styles.iconText, { color: accent }]}>{icon}</Text>
          </View>
          <ThemedText type="smallBold" selectable>{title}</ThemedText>
          <View style={[styles.count, { backgroundColor: rows.length ? `${accent}20` : theme.backgroundSelected }]}>
            <Text style={[styles.countText, { color: rows.length ? accent : theme.textSecondary }]}>{rows.length}</Text>
          </View>
        </View>
        <Text style={[styles.chevron, { color: theme.textSecondary }]}>{open ? '⌃' : '⌄'}</Text>
      </Pressable>

      {open ? (
        rows.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: theme.surface }]}>
            <Text style={[styles.emptyCheck, { color: accent }]}>✓</Text>
            <ThemedText type="small" themeColor="textSecondary" selectable>{emptyText}</ThemedText>
          </View>
        ) : (
          <View style={styles.rowList}>
            {rows.map((row, index) => (
              <Pressable
                key={row.key}
                onPress={row.onPress}
                disabled={!row.onPress}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 && { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth },
                  pressed && row.onPress && { backgroundColor: theme.backgroundSelected },
                ]}>
                <View style={[styles.avatar, { backgroundColor: `${accent}1A` }]}>
                  <Text style={[styles.avatarText, { color: accent }]}>{row.title.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={styles.rowCopy}>
                  <Text selectable style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>{row.title}</Text>
                  {row.subtitle ? (
                    <Text selectable style={[styles.rowSubtitle, { color: theme.textSecondary }]} numberOfLines={2}>{row.subtitle}</Text>
                  ) : null}
                </View>
                {row.onDelete ? (
                  <Pressable
                    onPress={(e) => {
                      // The row itself navigates, so the dismiss control must
                      // not let the press through to it.
                      e.stopPropagation();
                      row.onDelete?.();
                    }}
                    hitSlop={10}
                    style={styles.rowDelete}>
                    <Text style={[styles.arrow, { color: theme.textSecondary }]}>×</Text>
                  </Pressable>
                ) : null}
                {row.onPress ? <Text style={[styles.arrow, { color: theme.textSecondary }]}>›</Text> : null}
              </Pressable>
            ))}
          </View>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderRadius: 18, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 12, overflow: 'hidden' },
  header: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headingGroup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 34, height: 34, borderRadius: 11, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 16, fontWeight: '800' },
  count: { minWidth: 24, height: 24, paddingHorizontal: 7, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 12, lineHeight: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  chevron: { fontSize: 17, fontWeight: '800' },
  empty: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, borderCurve: 'continuous' },
  emptyCheck: { fontSize: 14, fontWeight: '900' },
  rowList: { marginHorizontal: -4 },
  row: { minHeight: 64, paddingHorizontal: 4, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontWeight: '800' },
  rowCopy: { flex: 1, gap: 3 },
  rowTitle: { fontSize: 14, lineHeight: 19, fontWeight: '700' },
  rowSubtitle: { fontSize: 12, lineHeight: 17 },
  arrow: { fontSize: 22, fontWeight: '400' },
  rowDelete: { paddingHorizontal: 4 },
});
