import { useMutation, useQuery } from 'convex/react';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useTheme } from '@/hooks/use-theme';

import { api } from '../../../convex/_generated/api';
import type { Doc, Id } from '../../../convex/_generated/dataModel';

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

const PRESET_OPTIONS = [
  { label: 'In 1 hour', getTime: () => Date.now() + HOUR_MS },
  { label: 'Tomorrow 9am', getTime: () => nextAt(9, 1) },
  { label: 'Tomorrow 3pm', getTime: () => nextAt(15, 1) },
];

type FollowupCardProps = {
  active: Doc<'reminders'>;
  onDismissed: (id: string) => void;
};

function FollowupCard({ active, onDismissed }: FollowupCardProps) {
  const theme = useTheme();
  const accept = useMutation(api.reminders.acceptSuggested);
  const dismiss = useMutation(api.reminders.dismissSuggested);

  const [picking, setPicking] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const onSetReminder = async (remindAt?: number) => {
    setBusy('accept');
    try {
      await accept({ reminderId: active._id, remindAt });
      onDismissed(active._id);
    } catch (err) {
      Alert.alert('Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const onDismiss = async () => {
    setBusy('dismiss');
    try {
      await dismiss({ reminderId: active._id });
      onDismissed(active._id);
    } catch (err) {
      Alert.alert('Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const resolveCustom = (): number | null => {
    const t = customInput.trim();
    if (t.length === 0) return null;
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return null;
    if (d.getTime() <= Date.now()) return null;
    return d.getTime();
  };

  return (
    <View
      style={[styles.bar, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: theme.text }]}>✦ Bimi noticed a follow-up</Text>
        <Pressable onPress={onDismiss} disabled={busy !== null} hitSlop={6}>
          <Text style={{ color: theme.textSecondary, fontSize: 18 }}>×</Text>
        </Pressable>
      </View>
      <Text style={[styles.body, { color: theme.text }]} numberOfLines={2}>
        {active.text}
      </Text>

      {!picking ? (
        <View style={styles.actionRow}>
          <Pressable
            onPress={() => setPicking(true)}
            disabled={busy !== null}
            style={[styles.btn, { borderColor: theme.border }]}
          >
            <Text style={{ color: theme.text }}>Pick time</Text>
          </Pressable>
          <Pressable
            onPress={() => onSetReminder()}
            disabled={busy !== null}
            style={[
              styles.btn,
              styles.btnPrimary,
              { backgroundColor: theme.primary },
              busy !== null && { opacity: 0.5 },
            ]}
          >
            {busy === 'accept' ? (
              <ActivityIndicator size="small" color={theme.primaryText} />
            ) : (
              <Text style={{ color: theme.primaryText, fontWeight: '700' }}>Set reminder</Text>
            )}
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: 6 }}>
          <View style={styles.chipRow}>
            {PRESET_OPTIONS.map((p) => (
              <Pressable
                key={p.label}
                onPress={() => onSetReminder(p.getTime())}
                disabled={busy !== null}
                style={[styles.chip, { borderColor: theme.border }]}
              >
                <Text style={[styles.chipText, { color: theme.text }]}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={customInput}
            onChangeText={setCustomInput}
            placeholder='or "2026-06-01 15:00"'
            placeholderTextColor={theme.textSecondary}
            style={[
              styles.input,
              {
                color: theme.text,
                borderColor: theme.border,
                backgroundColor: theme.background,
              },
            ]}
          />
          <View style={styles.actionRow}>
            <Pressable
              onPress={() => setPicking(false)}
              style={[styles.btn, { borderColor: theme.border }]}
            >
              <Text style={{ color: theme.text }}>Back</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                const ts = resolveCustom();
                if (!ts) {
                  Alert.alert('Pick a time', 'Choose a preset or enter a valid future date.');
                  return;
                }
                void onSetReminder(ts);
              }}
              disabled={busy !== null}
              style={[styles.btn, styles.btnPrimary, { backgroundColor: theme.primary }]}
            >
              {busy === 'accept' ? (
                <ActivityIndicator size="small" color={theme.primaryText} />
              ) : (
                <Text style={{ color: theme.primaryText, fontWeight: '700' }}>OK</Text>
              )}
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

type Props = { contactId: Id<'contacts'> | null };

export function FollowupSnackbar({ contactId }: Props) {
  const [sessionStart] = useState(() => Date.now());
  const suggested = useQuery(
    api.reminders.latestSuggestedForContact,
    contactId ? { contactId, sinceMs: sessionStart } : 'skip',
  );

  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const active: Doc<'reminders'> | null = suggested?.find((r) => !dismissedIds.has(r._id)) ?? null;

  if (!active) return null;

  const handleDismissed = (id: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  return <FollowupCard key={active._id} active={active} onDismissed={handleDismissed} />;
}

const styles = StyleSheet.create({
  bar: {
    marginHorizontal: 8,
    marginBottom: 6,
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 13, fontWeight: '700' },
  body: { fontSize: 13 },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 12, fontWeight: '600' },
  input: {
    minHeight: 36,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 8,
    fontSize: 13,
  },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { borderWidth: 0 },
});
