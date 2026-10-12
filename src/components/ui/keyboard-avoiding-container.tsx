import type { ComponentProps } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';

type Props = ComponentProps<typeof KeyboardAvoidingView>;

/**
 * Keeps bottom controls above the software keyboard on iOS.
 * On Android, the OS already resizes the window when the keyboard appears
 * (softwareKeyboardLayoutMode: 'resize'), so extra padding causes unwanted double-spacing.
 */
export function KeyboardAvoidingContainer({ behavior, ...props }: Props) {
  return (
    <KeyboardAvoidingView
      behavior={behavior ?? (Platform.OS === 'ios' ? 'padding' : undefined)}
      {...props}
    />
  );
}
