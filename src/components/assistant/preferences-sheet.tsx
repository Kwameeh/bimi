import { useMutation, useQuery } from 'convex/react';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { useTheme } from '@/hooks/use-theme';

import { api } from '../../../convex/_generated/api';

type Props = {
  instance: string;
  visible: boolean;
  onClose: () => void;
};

const PLACEHOLDER =
  "e.g. 'Be brief, no preamble. I'm a freelancer juggling 6 clients. Always include the contact name when mentioning a message.'";

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function normalizeHHmm(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return '';
  const m = /^(\d{1,2}):?(\d{2})$/.exec(trimmed);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function PreferencesSheet({ instance, visible, onClose }: Props) {
  const theme = useTheme();
  const existing = useQuery(
    api.assistantPreferences.get,
    visible ? { instance } : 'skip',
  );
  const userPref = useQuery(
    api.userPreferences.get,
    visible ? { instance } : 'skip',
  );
  const save = useMutation(api.assistantPreferences.set);
  const saveQuiet = useMutation(api.userPreferences.setQuietHours);
  const saveMemoryMode = useMutation(api.userPreferences.setMemoryWriteMode);

  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  // Quiet hours form state
  const [qhEnabled, setQhEnabled] = useState(false);
  const [qhStart, setQhStart] = useState('22:00');
  const [qhEnd, setQhEnd] = useState('07:00');
  const [qhTz, setQhTz] = useState<string>(deviceTimezone());
  const [qhAllowVip, setQhAllowVip] = useState(true);

  // Memory write mode
  const [memoryMode, setMemoryMode] = useState<'auto' | 'approval' | 'off'>(
    'auto',
  );

  useEffect(() => {
    if (visible) {
      setText(existing?.preferences ?? '');
    }
  }, [visible, existing]);

  useEffect(() => {
    if (visible && userPref) {
      setQhEnabled(userPref.quietHoursEnabled === true);
      setQhStart(userPref.quietHoursStart ?? '22:00');
      setQhEnd(userPref.quietHoursEnd ?? '07:00');
      setQhTz(userPref.quietHoursTimezone ?? deviceTimezone());
      setQhAllowVip(userPref.quietHoursAllowVip !== false);
      setMemoryMode(
        (userPref.memoryWriteMode as 'auto' | 'approval' | 'off' | undefined) ??
          'auto',
      );
    }
  }, [visible, userPref]);

  const onSave = async () => {
    if (saving) return;

    const normStart = normalizeHHmm(qhStart);
    const normEnd = normalizeHHmm(qhEnd);
    if (qhEnabled) {
      if (normStart === null) {
        Alert.alert('Invalid time', 'Quiet hours start must be HH:MM (00:00–23:59).');
        return;
      }
      if (normEnd === null) {
        Alert.alert('Invalid time', 'Quiet hours end must be HH:MM (00:00–23:59).');
        return;
      }
    }

    setSaving(true);
    try {
      await save({ instance, preferences: text.trim() });
      await saveQuiet({
        instance,
        enabled: qhEnabled,
        start: normStart || '22:00',
        end: normEnd || '07:00',
        timezone: qhTz.trim() || deviceTimezone(),
        allowVip: qhAllowVip,
      });
      await saveMemoryMode({ instance, mode: memoryMode });
      onClose();
    } catch (err) {
      Alert.alert('Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}>
      <KeyboardAvoidingContainer style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: theme.background, borderColor: theme.border },
          ]}
          onPress={(e) => e.stopPropagation()}>
          <ScrollView>
            <ThemedText type="smallBold">Your preferences</ThemedText>
            <ThemedText
              type="small"
              themeColor="textSecondary"
              style={{ marginTop: 4, marginBottom: 10 }}>
              Tell Bimi how you want it to respond. The assistant reads this on every turn.
            </ThemedText>

            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              placeholder={PLACEHOLDER}
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

            <View style={[styles.section, { borderTopColor: theme.border }]}>
              <View style={styles.rowBetween}>
                <ThemedText type="smallBold">Quiet hours</ThemedText>
                <Switch value={qhEnabled} onValueChange={setQhEnabled} />
              </View>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={{ marginTop: 4 }}>
                During quiet hours: auto-replies become drafts, the assistant defers sends, and non-urgent push is silenced.
              </ThemedText>

              <View style={styles.timeRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: theme.textSecondary }]}>Start</Text>
                  <TextInput
                    value={qhStart}
                    onChangeText={setQhStart}
                    placeholder="22:00"
                    placeholderTextColor={theme.textSecondary}
                    editable={qhEnabled}
                    style={[
                      styles.timeInput,
                      {
                        color: theme.text,
                        borderColor: theme.border,
                        backgroundColor: theme.backgroundElement,
                        opacity: qhEnabled ? 1 : 0.5,
                      },
                    ]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: theme.textSecondary }]}>End</Text>
                  <TextInput
                    value={qhEnd}
                    onChangeText={setQhEnd}
                    placeholder="07:00"
                    placeholderTextColor={theme.textSecondary}
                    editable={qhEnabled}
                    style={[
                      styles.timeInput,
                      {
                        color: theme.text,
                        borderColor: theme.border,
                        backgroundColor: theme.backgroundElement,
                        opacity: qhEnabled ? 1 : 0.5,
                      },
                    ]}
                  />
                </View>
              </View>

              <Text style={[styles.label, { color: theme.textSecondary, marginTop: 8 }]}>
                Timezone
              </Text>
              <TextInput
                value={qhTz}
                onChangeText={setQhTz}
                placeholder="Africa/Accra"
                placeholderTextColor={theme.textSecondary}
                editable={qhEnabled}
                style={[
                  styles.timeInput,
                  {
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.backgroundElement,
                    opacity: qhEnabled ? 1 : 0.5,
                  },
                ]}
              />

              <View style={[styles.rowBetween, { marginTop: 10 }]}>
                <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600' }}>
                  Let VIP contacts bypass
                </Text>
                <Switch
                  value={qhAllowVip}
                  onValueChange={setQhAllowVip}
                  disabled={!qhEnabled}
                />
              </View>
            </View>

            <View style={[styles.section, { borderTopColor: theme.border }]}>
              <ThemedText type="smallBold">Memory write mode</ThemedText>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={{ marginTop: 4, marginBottom: 8 }}>
                How Bimi adds memories from your chats. Auto writes high-confidence facts directly; Approval queues everything for your review; Off keeps existing memories but writes nothing new.
              </ThemedText>
              <View style={styles.modeRow}>
                {(['auto', 'approval', 'off'] as const).map((m) => {
                  const active = memoryMode === m;
                  return (
                    <Pressable
                      key={m}
                      onPress={() => setMemoryMode(m)}
                      style={[
                        styles.modeChip,
                        { borderColor: theme.border },
                        active && {
                          backgroundColor: theme.primary,
                          borderColor: theme.primary,
                        },
                      ]}>
                      <Text
                        style={{
                          color: active ? theme.primaryText : theme.text,
                          fontWeight: '600',
                          fontSize: 13,
                        }}>
                        {m === 'auto' ? 'Auto' : m === 'approval' ? 'Approval' : 'Off'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.actions}>
              <Pressable
                onPress={onClose}
                style={[styles.btn, { borderColor: theme.border }]}>
                <Text style={{ color: theme.text, fontWeight: '600' }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={onSave}
                disabled={saving}
                style={[
                  styles.btn,
                  styles.btnPrimary,
                  { backgroundColor: theme.primary },
                  saving && { opacity: 0.6 },
                ]}>
                {saving ? (
                  <ActivityIndicator color={theme.primaryText} size="small" />
                ) : (
                  <Text style={{ color: theme.primaryText, fontWeight: '700' }}>
                    Save
                  </Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
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
    maxHeight: '90%',
  },
  input: {
    minHeight: 100,
    maxHeight: 200,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  section: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timeRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  label: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  timeInput: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 14,
  },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { borderWidth: 0 },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
});
