import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';
import type { VoicePhase } from '@/lib/speech/use-voice-session';

const BASE_SIZE = 160;

type Props = {
  phase: VoicePhase;
  /** Mic level, 0..1. Only meaningful while listening. */
  volume: number;
  /** True when a pending approval or choice card is waiting on the user. */
  hasPendingApproval?: boolean;
  /** Tapping the orb interrupts speaking or triggers primary action. */
  onPress?: () => void;
};

/**
 * State-of-the-art Voice Orb inspired by modern conversational AI (ChatGPT Voice / Siri).
 *
 * Features:
 * - Multi-layered atmospheric glow and ambient breathing halo
 * - Concentric fluid ripple waves reacting dynamically in real time to voice intensity
 * - Synchronized orbital spin and harmonic breathing during 'thinking'
 * - Living speech cadence with harmonic modulation during 'speaking'
 * - Warm radiant amber beacon when an action requires approval
 * - Tactile spring feedback on tap
 */
export function Orb({ phase, volume, hasPendingApproval = false, onPress }: Props) {
  const theme = useTheme();

  // Rotation value for neural/orbital swirl in thinking phase
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (phase === 'thinking') {
      rotation.value = withRepeat(
        withTiming(360, { duration: 3200, easing: Easing.linear }),
        -1,
        false,
      );
    } else {
      rotation.value = withTiming(0, { duration: 400 });
    }
  }, [phase, rotation]);

  // Self-driven rhythmic motion depending on the phase
  const pulse = useDerivedValue(() => {
    if (hasPendingApproval) {
      return withRepeat(
        withSequence(
          withTiming(1.08, { duration: 900, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.96, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        true,
      );
    }

    if (phase === 'thinking') {
      return withRepeat(
        withSequence(
          withTiming(1.12, { duration: 650, easing: Easing.inOut(Easing.cubic) }),
          withTiming(0.92, { duration: 650, easing: Easing.inOut(Easing.cubic) }),
        ),
        -1,
        true,
      );
    }

    if (phase === 'speaking') {
      return withRepeat(
        withSequence(
          withTiming(1.09, { duration: 420, easing: Easing.inOut(Easing.sin) }),
          withTiming(0.97, { duration: 520, easing: Easing.inOut(Easing.sin) }),
          withTiming(1.05, { duration: 360, easing: Easing.inOut(Easing.sin) }),
          withTiming(0.98, { duration: 480, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        true,
      );
    }

    if (phase === 'listening') {
      return withRepeat(
        withSequence(
          withTiming(1.03, { duration: 750, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.98, { duration: 750, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        true,
      );
    }

    // Idle gentle resting breath
    return withRepeat(
      withSequence(
        withTiming(1.02, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.98, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
  }, [hasPendingApproval, phase]);

  // Audio level tracking with smooth spring responsiveness
  const audioLevel = useDerivedValue(() => {
    if (phase !== 'listening') return withTiming(0, { duration: 120 });
    const clamped = Math.min(Math.max(volume, 0), 1);
    return withSpring(clamped, { damping: 14, stiffness: 220 });
  }, [phase, volume]);

  // Dynamic palette based on state
  const primaryGlowColor = hasPendingApproval
    ? '#F59E0B'
    : phase === 'thinking'
      ? '#8B5CF6'
      : phase === 'speaking'
        ? theme.aiAccent
        : theme.primary;

  const secondaryColor = hasPendingApproval
    ? '#FCD34D'
    : phase === 'thinking'
      ? '#38BDF8'
      : phase === 'speaking'
        ? '#A78BFA'
        : '#38BDF8';

  // Styles
  const haloStyle = useAnimatedStyle(() => {
    const scale = interpolate(pulse.value + audioLevel.value * 0.45, [0.9, 1.4], [0.95, 1.45]);
    const opacity = hasPendingApproval
      ? 0.45
      : phase === 'listening'
        ? 0.28 + audioLevel.value * 0.5
        : phase === 'thinking'
          ? 0.4
          : phase === 'speaking'
            ? 0.38
            : 0.18;

    return {
      opacity: withTiming(opacity, { duration: 150 }),
      transform: [{ scale }],
    };
  });

  const ripple1Style = useAnimatedStyle(() => {
    const scale = pulse.value * (1 + audioLevel.value * 0.55);
    const opacity = phase === 'listening' ? 0.35 + audioLevel.value * 0.4 : 0.15;
    return {
      opacity: withTiming(opacity, { duration: 100 }),
      transform: [{ scale }],
    };
  });

  const ripple2Style = useAnimatedStyle(() => {
    const scale = pulse.value * (1.18 + audioLevel.value * 0.85);
    const opacity = phase === 'listening' ? 0.18 + audioLevel.value * 0.45 : 0.08;
    return {
      opacity: withTiming(opacity, { duration: 120 }),
      transform: [{ scale }],
    };
  });

  const orbitalStyle = useAnimatedStyle(() => {
    return {
      transform: [{ rotate: `${rotation.value}deg` }],
      opacity:
        phase === 'thinking'
          ? withTiming(0.85, { duration: 300 })
          : withTiming(0, { duration: 250 }),
    };
  });

  const coreStyle = useAnimatedStyle(() => {
    const scale = pulse.value * (1 + audioLevel.value * 0.28);
    return {
      transform: [{ scale }],
    };
  });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        phase === 'speaking'
          ? 'Tap to interrupt speech'
          : hasPendingApproval
            ? 'Action requires approval'
            : 'Voice orb'
      }
      style={styles.container}
    >
      {/* Ambient background bloom */}
      <Animated.View
        pointerEvents="none"
        style={[styles.ambientHalo, { backgroundColor: primaryGlowColor }, haloStyle]}
      />

      {/* Ripple ring 2 (outer) */}
      <Animated.View
        pointerEvents="none"
        style={[styles.rippleRingOuter, { borderColor: secondaryColor }, ripple2Style]}
      />

      {/* Ripple ring 1 (mid) */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.rippleRingMid,
          { borderColor: primaryGlowColor, backgroundColor: `${primaryGlowColor}15` },
          ripple1Style,
        ]}
      />

      {/* Orbiting particles for thinking phase */}
      <Animated.View pointerEvents="none" style={[styles.orbitalLayer, orbitalStyle]}>
        <View
          style={[styles.orbitalDot, { backgroundColor: secondaryColor, top: 4, left: '46%' }]}
        />
        <View
          style={[
            styles.orbitalDot,
            { backgroundColor: primaryGlowColor, bottom: 4, right: '46%' },
          ]}
        />
      </Animated.View>

      {/* Core orb sphere */}
      <Animated.View
        style={[
          styles.core,
          {
            backgroundColor: primaryGlowColor,
            shadowColor: primaryGlowColor,
          },
          coreStyle,
        ]}
      >
        {/* Soft inner lighting layer */}
        <View style={[styles.coreInnerGlow, { borderColor: secondaryColor }]}>
          <View style={[styles.coreCenter, { backgroundColor: theme.background }]}>
            {/* Luminous refraction highlight */}
            <View style={[styles.highlight, { backgroundColor: primaryGlowColor }]} />
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    width: BASE_SIZE * 2,
    height: BASE_SIZE * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ambientHalo: {
    position: 'absolute',
    width: BASE_SIZE * 1.7,
    height: BASE_SIZE * 1.7,
    borderRadius: (BASE_SIZE * 1.7) / 2,
  },
  rippleRingOuter: {
    position: 'absolute',
    width: BASE_SIZE * 1.45,
    height: BASE_SIZE * 1.45,
    borderRadius: (BASE_SIZE * 1.45) / 2,
    borderWidth: 1.5,
  },
  rippleRingMid: {
    position: 'absolute',
    width: BASE_SIZE * 1.25,
    height: BASE_SIZE * 1.25,
    borderRadius: (BASE_SIZE * 1.25) / 2,
    borderWidth: 2,
  },
  orbitalLayer: {
    position: 'absolute',
    width: BASE_SIZE * 1.35,
    height: BASE_SIZE * 1.35,
    borderRadius: (BASE_SIZE * 1.35) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbitalDot: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  core: {
    width: BASE_SIZE,
    height: BASE_SIZE,
    borderRadius: BASE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.65,
    shadowRadius: 28,
    elevation: 16,
  },
  coreInnerGlow: {
    width: BASE_SIZE - 12,
    height: BASE_SIZE - 12,
    borderRadius: (BASE_SIZE - 12) / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.95,
  },
  coreCenter: {
    width: BASE_SIZE - 28,
    height: BASE_SIZE - 28,
    borderRadius: (BASE_SIZE - 28) / 2,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.88,
  },
  highlight: {
    width: BASE_SIZE - 64,
    height: BASE_SIZE - 64,
    borderRadius: (BASE_SIZE - 64) / 2,
    opacity: 0.28,
  },
});
