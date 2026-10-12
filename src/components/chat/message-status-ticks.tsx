import React from 'react';
import { Text } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  status?: 'pending' | 'sent' | 'delivered' | 'read' | 'played' | 'error';
  size?: number;
};

export function MessageStatusTicks({ status, size = 14 }: Props) {
  const theme = useTheme();
  if (!status) return null;

  if (status === 'error') {
    return <AppIcon name="error" tintColor={theme.danger} size={size} />;
  }
  if (status === 'pending') {
    return <AppIcon name="dot" tintColor={theme.tickIdle} size={size} />;
  }

  const color = status === 'read' || status === 'played' ? theme.tickRead : theme.tickIdle;
  const double = status === 'delivered' || status === 'read' || status === 'played';

  return <AppIcon name={double ? 'checkDouble' : 'check'} tintColor={color} size={size} />;
}
