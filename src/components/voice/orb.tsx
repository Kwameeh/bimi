import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';

import type { VoicePhase } from '@/lib/speech/use-voice-session';

const SIZE = 168;

type Props = {
  phase: VoicePhase;
  /** Mic level, 0..1. Only meaningful while listening. */
  volume: number;
};

/**
 * The thing you look at while talking.
 *
 * Each phase gets its own motion so the state is readable at a glance without
 * reading any text: listening swells with your voice, thinking pulses on its
 * own, speaking breathes slowly, idle sits still.
 */
export function Orb({ phase, volume }: Props) {
  const theme = useTheme();

  // Self-driven motion, keyed on phase alone so a changing mic level never
  // restarts a repeating animation mid-cycle.
  const pulse = useDerivedValue(() => {
    if (phase === 'thinking') {
      return withRepeat(
        withSequence(
          withTiming(1.08, { duration: 620, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.96, { duration: 620, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        true,
      );
    }
    if (phase === 'speaking') {
      return withRepeat(
        withSequence(
          withTiming(1.05, { duration: 900, easing: Easing.inOut(Easing.sin) }),
          withTiming(0.99, { duration: 900, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        true,
      );
    }
    return withTiming(1, { duration: 300 });
  }, [phase]);

  // While listening the orb tracks your voice; otherwise it settles to zero.
  const level = useDerivedValue(
    () =>
      withTiming(phase === 'listening' ? Math.min(Math.max(volume, 0), 1) : 0, {
        duration: 90,
      }),
    [phase, volume],
  );

  const baseGlow = phase === 'speaking' ? 0.6 : phase === 'thinking' ? 0.5 : 0.2;
  const color = phase === 'speaking' ? theme.aiAccent : theme.primary;

  const orbStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value * (1 + level.value * 0.35) }],
  }));
  const glowStyle = useAnimatedStyle(() => {
    const opacity = Math.min(baseGlow + level.value * 0.5, 1);
    return { opacity, transform: [{ scale: 1 + opacity * 0.5 }] };
  });

  return (
    <View style={styles.wrap}>
      <Animated.View
        style={[styles.glow, { backgroundColor: color }, glowStyle]}
        pointerEvents="none"
      />
      <Animated.View style={[styles.orb, { backgroundColor: color }, orbStyle]}>
        <View style={[styles.inner, { backgroundColor: theme.background }]} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: SIZE * 1.8,
    height: SIZE * 1.8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
  },
  orb: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    width: SIZE - 22,
    height: SIZE - 22,
    borderRadius: (SIZE - 22) / 2,
    opacity: 0.82,
  },
});
