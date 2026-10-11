import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  visible: boolean;
  newMessageCount?: number;
  onPress: () => void;
};

export function ScrollToBottomPill({ visible, newMessageCount, onPress }: Props) {
  const theme = useTheme();
  if (!visible) return null;

  const count = newMessageCount && newMessageCount > 0 ? newMessageCount : null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        {
          backgroundColor: theme.primary,
          shadowColor: theme.text,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <AppIcon name="arrowDown" tintColor={theme.primaryText} size={14} />
      <Text style={[styles.label, { color: theme.primaryText }]}>
        {count ? `${count} new` : 'Latest'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  label: { fontSize: 12, fontWeight: '700' },
});
