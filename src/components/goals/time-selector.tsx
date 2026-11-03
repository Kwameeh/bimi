import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

export type TimeSelectorProps = {
  value: string; // "HH:mm" in 24h format, e.g. "09:00" or "14:30"
  onChange: (value: string) => void;
};

const PRESETS: { label: string; time24: string }[] = [
  { label: 'Morning (9:00 AM)', time24: '09:00' },
  { label: 'Noon (12:00 PM)', time24: '12:00' },
  { label: 'Afternoon (3:00 PM)', time24: '15:00' },
  { label: 'Evening (7:00 PM)', time24: '19:00' },
];

const MINUTE_PRESETS = [0, 15, 30, 45];
const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function TimeSelector({ value, onChange }: TimeSelectorProps) {
  const theme = useTheme();

  // Parse incoming "HH:mm"
  const { hour12, minutes, period } = useMemo(() => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    const rawH = match ? Number(match[1]) : 9;
    const rawM = match ? Number(match[2]) : 0;
    const clampedH = Math.max(0, Math.min(23, isNaN(rawH) ? 9 : rawH));
    const clampedM = Math.max(0, Math.min(59, isNaN(rawM) ? 0 : rawM));

    const p: 'AM' | 'PM' = clampedH >= 12 ? 'PM' : 'AM';
    const h12 = clampedH % 12 === 0 ? 12 : clampedH % 12;
    return { hour12: h12, minutes: clampedM, period: p };
  }, [value]);

  const updateTime = (newH12: number, newM: number, newPeriod: 'AM' | 'PM') => {
    let h24 = newPeriod === 'PM' ? (newH12 % 12) + 12 : newH12 % 12;
    if (h24 === 24) h24 = 12;
    const formatted = `${String(h24).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
    onChange(formatted);
  };

  const setPeriod = (nextPeriod: 'AM' | 'PM') => {
    if (nextPeriod === period) return;
    updateTime(hour12, minutes, nextPeriod);
  };

  const setHour = (h: number) => {
    updateTime(h, minutes, period);
  };

  const setMinute = (m: number) => {
    updateTime(hour12, m, period);
  };

  const stepMinute = (delta: number) => {
    let nextM = (minutes + delta) % 60;
    if (nextM < 0) nextM += 60;
    updateTime(hour12, nextM, period);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      {/* Time Display & AM/PM Toggle */}
      <View style={styles.displayRow}>
        <View style={styles.timeDigitBox}>
          <Text style={[styles.timeDigitText, { color: theme.text }]}>
            {String(hour12).padStart(2, '0')} : {String(minutes).padStart(2, '0')}
          </Text>
        </View>

        <View style={[styles.periodToggle, { borderColor: theme.border, backgroundColor: theme.background }]}>
          <Pressable
            onPress={() => setPeriod('AM')}
            style={[
              styles.periodBtn,
              period === 'AM' && { backgroundColor: theme.primary },
            ]}
          >
            <Text
              style={[
                styles.periodBtnText,
                { color: period === 'AM' ? theme.primaryText : theme.textSecondary },
              ]}
            >
              AM
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setPeriod('PM')}
            style={[
              styles.periodBtn,
              period === 'PM' && { backgroundColor: theme.primary },
            ]}
          >
            <Text
              style={[
                styles.periodBtnText,
                { color: period === 'PM' ? theme.primaryText : theme.textSecondary },
              ]}
            >
              PM
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Hour Pills */}
      <View style={styles.section}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          Hour
        </ThemedText>
        <View style={styles.gridRow}>
          {HOURS.map((h) => {
            const selected = hour12 === h;
            return (
              <Pressable
                key={h}
                onPress={() => setHour(h)}
                style={[
                  styles.chip,
                  { borderColor: theme.border, backgroundColor: theme.background },
                  selected && { backgroundColor: theme.primary, borderColor: theme.primary },
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: selected ? theme.primaryText : theme.text },
                  ]}
                >
                  {h}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Minute Selector */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
            Minute
          </ThemedText>
          <View style={styles.stepperRow}>
            <Pressable
              onPress={() => stepMinute(-5)}
              style={[styles.stepBtn, { borderColor: theme.border, backgroundColor: theme.background }]}
            >
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }}>-5m</Text>
            </Pressable>
            <Pressable
              onPress={() => stepMinute(5)}
              style={[styles.stepBtn, { borderColor: theme.border, backgroundColor: theme.background }]}
            >
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }}>+5m</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.gridRow}>
          {MINUTE_PRESETS.map((m) => {
            const selected = minutes === m;
            return (
              <Pressable
                key={m}
                onPress={() => setMinute(m)}
                style={[
                  styles.minuteChip,
                  { borderColor: theme.border, backgroundColor: theme.background },
                  selected && { backgroundColor: theme.primary, borderColor: theme.primary },
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: selected ? theme.primaryText : theme.text },
                  ]}
                >
                  :{String(m).padStart(2, '0')}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Quick Presets */}
      <View style={styles.section}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          Quick Presets
        </ThemedText>
        <View style={styles.presetsRow}>
          {PRESETS.map((preset) => {
            const active = value === preset.time24;
            return (
              <Pressable
                key={preset.time24}
                onPress={() => onChange(preset.time24)}
                style={[
                  styles.presetChip,
                  { borderColor: theme.border, backgroundColor: theme.background },
                  active && { backgroundColor: theme.primary, borderColor: theme.primary },
                ]}
              >
                <Text
                  style={[
                    styles.presetText,
                    { color: active ? theme.primaryText : theme.text },
                  ]}
                >
                  {preset.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  displayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 4,
  },
  timeDigitBox: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  timeDigitText: {
    fontSize: 22,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  periodToggle: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 2,
    gap: 2,
  },
  periodBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  periodBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  section: {
    gap: 6,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  gridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    minWidth: 36,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
  },
  minuteChip: {
    flex: 1,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  stepperRow: {
    flexDirection: 'row',
    gap: 4,
  },
  stepBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  presetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  presetChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  presetText: {
    fontSize: 12,
    fontWeight: '600',
  },
});

