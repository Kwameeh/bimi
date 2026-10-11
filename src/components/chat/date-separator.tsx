import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

export function DateSeparator({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <View style={[styles.pill, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', paddingVertical: 12 },
  pill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999 },
});
