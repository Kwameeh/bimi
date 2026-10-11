import { useAction } from 'convex/react';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { useTheme } from '@/hooks/use-theme';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

const HOUR_MS = 60 * 60 * 1000;

function nextAt(hour: number, dayOffset = 0): number {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  if (dayOffset === 0 && d.getTime() < Date.now() + 30 * 60 * 1000) {
    d.setDate(d.getDate() + 1);
  } else {
    d.setDate(d.getDate() + dayOffset);
  }
  return d.getTime();
}

type PresetKey = '1h' | '3h' | 'tomorrow_9am' | 'tomorrow_3pm' | 'day_after_9am';

type PresetOption = {
  key: PresetKey;
  label: string;
};

const PRESETS: PresetOption[] = [
  { key: '1h', label: 'In 1 hour' },
  { key: '3h', label: 'In 3 hours' },
  { key: 'tomorrow_9am', label: 'Tomorrow 9am' },
  { key: 'tomorrow_3pm', label: 'Tomorrow 3pm' },
  { key: 'day_after_9am', label: 'Day after 9am' },
];

function resolvePresetTime(key: PresetKey): number {
  switch (key) {
    case '1h':
      return Date.now() + HOUR_MS;
    case '3h':
      return Date.now() + 3 * HOUR_MS;
    case 'tomorrow_9am':
      return nextAt(9, 1);
    case 'tomorrow_3pm':
      return nextAt(15, 1);
    case 'day_after_9am':
      return nextAt(9, 2);
  }
}

type Props = {
  visible: boolean;
  meetingId: Id<'meetings'> | null;
  onClose: () => void;
  onDrafted?: (draftId: Id<'drafts'>) => void;
};

export function MeetingCounterSheet({ visible, meetingId, onClose, onDrafted }: Props) {
  const theme = useTheme();
  const proposeAlternate = useAction(api.meetings.proposeAlternate);
  const [selectedPreset, setSelectedPreset] = useState<PresetKey | null>(null);
  const [note, setNote] = useState('');
  const [customInput, setCustomInput] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    setSelectedPreset(null);
    setNote('');
    setCustomInput('');
    setBusy(false);
    onClose();
  };

  const resolveCustom = (): number | null => {
    if (customInput.trim().length === 0) return null;
    const d = new Date(customInput.trim());
    if (Number.isNaN(d.getTime())) return null;
    if (d.getTime() <= Date.now()) return null;
    return d.getTime();
  };

  const submit = async () => {
    if (!meetingId) return;
    const startAt = selectedPreset ? resolvePresetTime(selectedPreset) : resolveCustom();
    if (!startAt) {
      Alert.alert(
        'Pick a time',
        'Choose a preset or enter a valid future date (e.g. "2026-06-01 15:00").',
      );
      return;
    }
    setBusy(true);
    try {
      const { draftId } = await proposeAlternate({
        meetingId,
        startAt,
        note: note.trim() || undefined,
      });
      onDrafted?.(draftId);
      close();
    } catch (err) {
      Alert.alert('Failed', err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  if (!meetingId) return null;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingContainer style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.border }]}
            onPress={(e) => e.stopPropagation()}
          >
            <ThemedText type="smallBold" style={styles.title}>
              Suggest another time
            </ThemedText>

            <Text style={[styles.label, { color: theme.textSecondary }]}>Quick picks</Text>
            <View style={styles.chipRow}>
              {PRESETS.map((p) => {
                const active = selectedPreset === p.key;
                return (
                  <Pressable
                    key={p.key}
                    onPress={() => {
                      setSelectedPreset(p.key);
                      setCustomInput('');
                    }}
                    style={[
                      styles.chip,
                      {
                        borderColor: active ? theme.primary : theme.border,
                        backgroundColor: active ? theme.backgroundSelected : 'transparent',
                      },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: theme.text }]}>{p.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.label, { color: theme.textSecondary, marginTop: 12 }]}>
              Or enter a date/time
            </Text>
            <TextInput
              value={customInput}
              onChangeText={(t) => {
                setCustomInput(t);
                setSelectedPreset(null);
              }}
              placeholder="2026-06-01 15:00"
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.input,
                {
                  color: theme.text,
                  borderColor: theme.border,
                  backgroundColor: theme.backgroundElement,
                },
              ]}
            />

            <Text style={[styles.label, { color: theme.textSecondary, marginTop: 12 }]}>
              Note (optional)
            </Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="e.g. I have a conflict at 3pm"
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.input,
                {
                  color: theme.text,
                  borderColor: theme.border,
                  backgroundColor: theme.backgroundElement,
                },
              ]}
              multiline
            />

            <View style={styles.actionsRow}>
              <Pressable onPress={close} style={[styles.btn, { borderColor: theme.border }]}>
                <Text style={{ color: theme.text }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submit}
                disabled={busy}
                style={[
                  styles.btn,
                  styles.btnPrimary,
                  { backgroundColor: theme.primary },
                  busy && { opacity: 0.5 },
                ]}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={theme.primaryText} />
                ) : (
                  <Text style={{ color: theme.primaryText, fontWeight: '700' }}>Draft reply</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingContainer>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 28,
  },
  title: { marginBottom: 8 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 12, fontWeight: '600' },
  input: {
    minHeight: 40,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  actionsRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { borderWidth: 0 },
});
