import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export function AiBadge() {
  const theme = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: theme.aiAccent }]}>
      <Text style={styles.label}>AI</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  label: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
});
