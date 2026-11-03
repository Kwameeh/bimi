import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export type DaySelectorProps = {
  value?: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  onChange: (day: number) => void;
};

const DAYS = [
  { day: 0, label: 'Sun', full: 'Sunday' },
  { day: 1, label: 'Mon', full: 'Monday' },
  { day: 2, label: 'Tue', full: 'Tuesday' },
  { day: 3, label: 'Wed', full: 'Wednesday' },
  { day: 4, label: 'Thu', full: 'Thursday' },
  { day: 5, label: 'Fri', full: 'Friday' },
  { day: 6, label: 'Sat', full: 'Saturday' },
];

export function DaySelector({ value = 1, onChange }: DaySelectorProps) {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      {DAYS.map((d) => {
        const selected = value === d.day;
        return (
          <Pressable
            key={d.day}
            onPress={() => onChange(d.day)}
            accessibilityRole="button"
            accessibilityLabel={d.full}
            accessibilityState={{ selected }}
            style={[
              styles.dayChip,
              {
                borderColor: theme.border,
                backgroundColor: theme.backgroundElement,
              },
              selected && {
                backgroundColor: theme.primary,
                borderColor: theme.primary,
              },
            ]}
          >
            <Text
              style={[
                styles.dayText,
                {
                  color: selected ? theme.primaryText : theme.text,
                },
              ]}
            >
              {d.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'space-between',
  },
  dayChip: {
    flex: 1,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
  },
  dayText: {
    fontSize: 12,
    fontWeight: '700',
  },
});

