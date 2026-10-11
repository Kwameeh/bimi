import type { ComponentProps } from 'react';
import { KeyboardAvoidingView } from 'react-native';

type Props = ComponentProps<typeof KeyboardAvoidingView>;

/**
 * Keeps bottom controls above the software keyboard on both native platforms.
 * Android normally relies on window resizing, but that is not reliable for
 * native tabs and transparent modals, so native screens get an explicit
 * padding fallback as well.
 */
export function KeyboardAvoidingContainer({ behavior, ...props }: Props) {
  return (
    <KeyboardAvoidingView
      behavior={behavior ?? (process.env.EXPO_OS === 'web' ? undefined : 'padding')}
      {...props}
    />
  );
}
