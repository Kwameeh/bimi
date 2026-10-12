/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#0F172A',
    background: '#FFFFFF',
    backgroundElement: '#F1F5F9',
    backgroundSelected: '#E2E8F0',
    textSecondary: '#64748B',

    surface: '#F8FAFC',
    border: '#E2E8F0',

    primary: '#208AEF',
    primaryText: '#FFFFFF',
    aiAccent: '#6F5BFF',

    bubbleReceived: '#F1F5F9',
    bubbleReceivedText: '#0F172A',
    bubbleSent: '#208AEF',
    bubbleSentText: '#FFFFFF',

    tickIdle: '#94A3B8',
    tickRead: '#208AEF',
    unreadBadge: '#208AEF',
    unreadBadgeText: '#FFFFFF',

    danger: '#EF4444',
  },
  dark: {
    text: '#F1F5F9',
    background: '#0B1220',
    backgroundElement: '#1F2937',
    backgroundSelected: '#374151',
    textSecondary: '#94A3B8',

    surface: '#111827',
    border: '#1F2937',

    primary: '#3B9DF8',
    primaryText: '#FFFFFF',
    aiAccent: '#8B7FFF',

    bubbleReceived: '#1F2937',
    bubbleReceivedText: '#F1F5F9',
    bubbleSent: '#3B9DF8',
    bubbleSentText: '#FFFFFF',

    tickIdle: '#64748B',
    tickRead: '#3B9DF8',
    unreadBadge: '#3B9DF8',
    unreadBadgeText: '#FFFFFF',

    danger: '#F87171',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: 'PlusJakartaSans-Regular',
    sansMedium: 'PlusJakartaSans-Medium',
    sansSemiBold: 'PlusJakartaSans-SemiBold',
    sansBold: 'PlusJakartaSans-Bold',
    sansExtraBold: 'PlusJakartaSans-ExtraBold',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'JetBrainsMono-Regular',
    monoMedium: 'JetBrainsMono-Medium',
  },
  android: {
    sans: 'PlusJakartaSans-Regular',
    sansMedium: 'PlusJakartaSans-Medium',
    sansSemiBold: 'PlusJakartaSans-SemiBold',
    sansBold: 'PlusJakartaSans-Bold',
    sansExtraBold: 'PlusJakartaSans-ExtraBold',
    serif: 'serif',
    rounded: 'sans-serif',
    mono: 'JetBrainsMono-Regular',
    monoMedium: 'JetBrainsMono-Medium',
  },
  web: {
    sans: 'var(--font-display)',
    sansMedium: 'var(--font-display)',
    sansSemiBold: 'var(--font-display)',
    sansBold: 'var(--font-display)',
    sansExtraBold: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
    monoMedium: 'var(--font-mono)',
  },
  default: {
    sans: 'sans-serif',
    sansMedium: 'sans-serif-medium',
    sansSemiBold: 'sans-serif',
    sansBold: 'sans-serif',
    sansExtraBold: 'sans-serif',
    serif: 'serif',
    rounded: 'sans-serif',
    mono: 'monospace',
    monoMedium: 'monospace',
  },
}) as {
  sans: string;
  sansMedium?: string;
  sansSemiBold?: string;
  sansBold?: string;
  sansExtraBold?: string;
  serif: string;
  rounded: string;
  mono: string;
  monoMedium?: string;
};

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
