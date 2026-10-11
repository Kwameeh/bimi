import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

type Props = {
  suggestions: string[];
  onPick: (suggestion: string) => void;
  disabled?: boolean;
};

export function FollowUps({ suggestions, onPick, disabled }: Props) {
  const theme = useTheme();
  if (suggestions.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}>
      {suggestions.map((s) => (
        <Pressable
          key={s}
          disabled={disabled}
          onPress={() => onPick(s)}
          style={({ pressed }) => [
            styles.chip,
            {
              borderColor: theme.border,
              backgroundColor: theme.backgroundElement,
            },
            (disabled || pressed) && { opacity: 0.6 },
          ]}>
          <Text style={[styles.chipText, { color: theme.text }]} numberOfLines={1}>
            {s}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 4,
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 240,
  },
  chipText: { fontSize: 12, fontWeight: '600' },
});
