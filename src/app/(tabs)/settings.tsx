import { useMutation, useQuery } from 'convex/react';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { AppIcon } from '@/components/ui/app-icon';
import { Fonts, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { AI_MODE_OPTIONS, type AiMode } from '@/lib/ai-modes';
import { useInstance } from '@/lib/instance';

import { api } from '../../../convex/_generated/api';

type Tone = 'casual' | 'professional' | 'friendly' | 'concise' | 'custom';
type VoiceModePref = 'push_to_talk' | 'conversational';
type VoiceEnginePref = 'device' | 'bimi';

const VOICE_MODE_OPTIONS: { key: VoiceModePref; label: string; description: string }[] = [
  {
    key: 'push_to_talk',
    label: 'Hold to talk',
    description: 'Hold the mic, speak, let go. Predictable and quiet between turns.',
  },
  {
    key: 'conversational',
    label: 'Conversation',
    description: 'Mic stays open and commits when you pause. Needs Android 13+.',
  },
];

const VOICE_ENGINE_OPTIONS: { key: VoiceEnginePref; label: string; description: string }[] = [
  {
    key: 'device',
    label: 'Device voice',
    description: 'Free and offline. Starts instantly and can be cut off mid-word.',
  },
  {
    key: 'bimi',
    label: 'Bimi voice',
    description: 'Warmer and the same on every device. Takes about a second to start.',
  },
];

const TONE_OPTIONS: { key: Tone; label: string; description: string }[] = [
  {
    key: 'casual',
    label: 'Casual',
    description: 'Short, conversational. Default.',
  },
  {
    key: 'professional',
    label: 'Professional',
    description: 'Polished and complete sentences.',
  },
  { key: 'friendly', label: 'Friendly', description: 'Warm and welcoming.' },
  { key: 'concise', label: 'Concise', description: 'As short as possible.' },
  {
    key: 'custom',
    label: 'Custom',
    description: 'Free-form tone instruction.',
  },
];

const MORE_SCREENS: {
  route: '/approvals' | '/memory' | '/contacts';
  label: string;
  description: string;
}[] = [
  {
    route: '/approvals',
    label: 'Approvals',
    description: 'Drafts waiting for your review.',
  },
  {
    route: '/memory',
    label: 'Memory',
    description: 'What Bimi remembers about you and your contacts.',
  },
  {
    route: '/contacts',
    label: 'Contact sync',
    description: 'Match cloud contacts with your phone address book.',
  },
];

const MEMORY_INTERVAL_OPTIONS: {
  hours: number;
  label: string;
  description: string;
}[] = [
  {
    hours: 0,
    label: 'Off',
    description: 'Do not run scheduled memory profile updates.',
  },
  { hours: 1, label: 'Every hour', description: 'Best for heavy chat days.' },
  {
    hours: 5,
    label: 'Every 5 hours',
    description: 'Balanced updates during the day.',
  },
  {
    hours: 24,
    label: 'Daily',
    description: 'Summarize each active chat once per day.',
  },
];

function localTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export default function SettingsTabScreen() {
  const scheme = useColorScheme();
  const themeLabel = scheme === 'dark' ? 'Dark' : 'Light';
  const theme = useTheme();
  const router = useRouter();
  const instance = useInstance();
  const pref = useQuery(api.userPreferences.get, { instance });
  const setDefaultTone = useMutation(api.userPreferences.setDefaultTone);
  const setReplyStyleLearning = useMutation(api.userPreferences.setReplyStyleLearning);
  const setDefaultAiMode = useMutation(api.userPreferences.setDefaultAiMode);
  const setOwnerProfile = useMutation(api.userPreferences.setOwnerProfile);
  const setAutoExtractTasks = useMutation(api.userPreferences.setAutoExtractTasks);
  const setMemoryExtractionSchedule = useMutation(api.userPreferences.setMemoryExtractionSchedule);
  const setVoicePreferences = useMutation(api.userPreferences.setVoicePreferences);
  const autoExtractEnabled = pref?.autoExtractTasks !== false;
  const [busyAutoExtract, setBusyAutoExtract] = useState(false);
  const [busyMemorySchedule, setBusyMemorySchedule] = useState<number | null>(null);
  const [busyStyleLearning, setBusyStyleLearning] = useState(false);
  const [busyVoice, setBusyVoice] = useState<string | null>(null);
  const styleLearningEnabled = pref?.replyStyleLearningEnabled !== false;

  const toggleAutoExtract = async () => {
    if (busyAutoExtract) return;
    setBusyAutoExtract(true);
    try {
      await setAutoExtractTasks({ instance, enabled: !autoExtractEnabled });
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAutoExtract(false);
    }
  };

  const toggleStyleLearning = async () => {
    if (busyStyleLearning) return;
    setBusyStyleLearning(true);
    try {
      await setReplyStyleLearning({
        instance,
        enabled: !styleLearningEnabled,
      });
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusyStyleLearning(false);
    }
  };

  const voiceMode: VoiceModePref = pref?.voiceMode ?? 'push_to_talk';
  const voiceEngine: VoiceEnginePref = pref?.voiceTtsEngine ?? 'device';
  const voiceAutoSpeak = pref?.voiceAutoSpeak !== false;

  const saveVoice = async (
    patch: { mode?: VoiceModePref; ttsEngine?: VoiceEnginePref; autoSpeak?: boolean },
    key: string,
  ) => {
    if (busyVoice) return;
    setBusyVoice(key);
    try {
      await setVoicePreferences({ instance, ...patch });
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusyVoice(null);
    }
  };

  const currentTone: Tone = (pref?.defaultTone as Tone | undefined) ?? 'casual';
  const currentAiMode: AiMode = (pref?.defaultAiMode as AiMode | undefined) ?? 'manual';
  const [customInput, setCustomInput] = useState('');
  const [busy, setBusy] = useState<Tone | null>(null);
  const [busyAiMode, setBusyAiMode] = useState<AiMode | null>(null);
  const [ownerNameInput, setOwnerNameInput] = useState('');
  const [ownerAliasesInput, setOwnerAliasesInput] = useState('');
  const [memoryDailyTimeInput, setMemoryDailyTimeInput] = useState('21:00');
  const [busyIdentity, setBusyIdentity] = useState(false);

  const [syncedPrefId, setSyncedPrefId] = useState<string | null>(null);

  if (pref && syncedPrefId !== pref._id) {
    setSyncedPrefId(pref._id);
    setOwnerNameInput(pref.ownerName ?? '');
    setOwnerAliasesInput(pref.ownerAliases ? pref.ownerAliases.join(', ') : '');
    setMemoryDailyTimeInput(pref.memoryExtractionDailyTime ?? '21:00');
    setCustomInput(pref.customTone ?? '');
  }

  const selectMemoryInterval = async (hours: number) => {
    if (busyMemorySchedule !== null) return;
    setBusyMemorySchedule(hours);
    try {
      await setMemoryExtractionSchedule({
        instance,
        intervalHours: hours,
        dailyTime: memoryDailyTimeInput.trim() || undefined,
        timezone: localTimezone(),
      });
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusyMemorySchedule(null);
    }
  };

  const saveIdentity = async () => {
    if (busyIdentity) return;
    setBusyIdentity(true);
    try {
      const aliases = ownerAliasesInput
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      await setOwnerProfile({
        instance,
        ownerName: ownerNameInput.trim() || undefined,
        ownerAliases: aliases,
      });
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusyIdentity(false);
    }
  };

  const selectAiMode = async (mode: AiMode) => {
    if (busyAiMode) return;
    setBusyAiMode(mode);
    try {
      await setDefaultAiMode({ instance, aiMode: mode });
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAiMode(null);
    }
  };

  const selectTone = async (tone: Tone) => {
    if (busy) return;
    if (tone === 'custom' && customInput.trim().length === 0) {
      Alert.alert('Custom tone', 'Type a custom tone instruction first.');
      return;
    }
    setBusy(tone);
    try {
      await setDefaultTone({
        instance,
        tone,
        customTone: tone === 'custom' ? customInput.trim() : undefined,
      });
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingContainer style={{ flex: 1 }}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.header}>
            <ThemedText style={styles.headerTitle}>Settings</ThemedText>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            <ThemedView type="backgroundElement" style={styles.section}>
              {MORE_SCREENS.map((item, i) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${item.label}`}
                  key={item.route}
                  onPress={() => router.push(item.route)}
                  style={[styles.toneRow, { borderColor: theme.border }, i > 0 && { marginTop: 8 }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.toneLabel, { color: theme.text }]}>{item.label}</Text>
                    <Text style={[styles.toneDesc, { color: theme.textSecondary }]}>
                      {item.description}
                    </Text>
                  </View>
                  <AppIcon name="chevronRight" tintColor={theme.textSecondary} size={18} />
                </Pressable>
              ))}
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="smallBold">Voice</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                How the mic behaves when you open voice mode, and what Bimi sounds like.
              </ThemedText>

              <View style={styles.toneList}>
                {VOICE_MODE_OPTIONS.map((option) => {
                  const active = voiceMode === option.key;
                  return (
                    <Pressable
                      key={option.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => saveVoice({ mode: option.key }, `mode:${option.key}`)}
                      disabled={busyVoice !== null}
                      style={[
                        styles.toneRow,
                        {
                          borderColor: active ? theme.primary : theme.border,
                          backgroundColor: active ? theme.backgroundSelected : 'transparent',
                        },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.toneLabel, { color: theme.text }]}>
                          {option.label}
                        </Text>
                        <Text style={[styles.toneDesc, { color: theme.textSecondary }]}>
                          {option.description}
                        </Text>
                      </View>
                      {busyVoice === `mode:${option.key}` ? (
                        <ActivityIndicator size="small" color={theme.primary} />
                      ) : active ? (
                        <AppIcon name="check" tintColor={theme.primary} size={18} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>

              <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: 8 }}>
                Bimi&apos;s voice
              </ThemedText>
              <View style={styles.toneList}>
                {VOICE_ENGINE_OPTIONS.map((option) => {
                  const active = voiceEngine === option.key;
                  return (
                    <Pressable
                      key={option.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => saveVoice({ ttsEngine: option.key }, `engine:${option.key}`)}
                      disabled={busyVoice !== null}
                      style={[
                        styles.toneRow,
                        {
                          borderColor: active ? theme.primary : theme.border,
                          backgroundColor: active ? theme.backgroundSelected : 'transparent',
                        },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.toneLabel, { color: theme.text }]}>
                          {option.label}
                        </Text>
                        <Text style={[styles.toneDesc, { color: theme.textSecondary }]}>
                          {option.description}
                        </Text>
                      </View>
                      {busyVoice === `engine:${option.key}` ? (
                        <ActivityIndicator size="small" color={theme.primary} />
                      ) : active ? (
                        <AppIcon name="check" tintColor={theme.primary} size={18} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: voiceAutoSpeak }}
                onPress={() => saveVoice({ autoSpeak: !voiceAutoSpeak }, 'autoSpeak')}
                disabled={busyVoice !== null}
                style={[
                  styles.toneRow,
                  {
                    borderColor: voiceAutoSpeak ? theme.primary : theme.border,
                    backgroundColor: voiceAutoSpeak ? theme.backgroundSelected : 'transparent',
                    marginTop: 8,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.toneLabel, { color: theme.text }]}>
                    {voiceAutoSpeak ? 'Speaks answers aloud' : 'Stays silent'}
                  </Text>
                  <Text style={[styles.toneDesc, { color: theme.textSecondary }]}>
                    Turn this off to read replies on screen without hearing them.
                  </Text>
                </View>
                {busyVoice === 'autoSpeak' ? (
                  <ActivityIndicator size="small" color={theme.primary} />
                ) : voiceAutoSpeak ? (
                  <Text style={[styles.check, { color: theme.primary }]}>✓</Text>
                ) : null}
              </Pressable>
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="smallBold">Learn my reply style</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Learns shortness, wording, casing, and emoji habits per contact. Your explicit tone
                setting still wins.
              </ThemedText>
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: styleLearningEnabled }}
                onPress={toggleStyleLearning}
                disabled={busyStyleLearning}
                style={[
                  styles.toneRow,
                  {
                    borderColor: styleLearningEnabled ? theme.primary : theme.border,
                    backgroundColor: styleLearningEnabled
                      ? theme.backgroundSelected
                      : 'transparent',
                    marginTop: 8,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.toneLabel, { color: theme.text }]}>
                    {styleLearningEnabled ? 'Enabled' : 'Disabled'}
                  </Text>
                  <Text style={[styles.toneDesc, { color: theme.textSecondary }]}>
                    Uses messages you wrote and drafts you approved or edited.
                  </Text>
                </View>
                {busyStyleLearning ? (
                  <ActivityIndicator size="small" color={theme.primary} />
                ) : styleLearningEnabled ? (
                  <Text style={[styles.check, { color: theme.primary }]}>✓</Text>
                ) : null}
              </Pressable>
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="smallBold">Your identity</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Used to detect when someone mentions you in a group.
              </ThemedText>
              {pref?.ownerPhone ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Phone: {pref.ownerPhone}
                </ThemedText>
              ) : null}
              <Text style={[styles.toneDesc, { color: theme.textSecondary, marginTop: 8 }]}>
                Your name (as people address you)
              </Text>
              <TextInput
                value={ownerNameInput}
                onChangeText={setOwnerNameInput}
                placeholder="Sydney"
                placeholderTextColor={theme.textSecondary}
                style={[
                  styles.customInput,
                  {
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.background,
                  },
                ]}
              />
              <Text style={[styles.toneDesc, { color: theme.textSecondary, marginTop: 8 }]}>
                Nicknames (comma-separated)
              </Text>
              <TextInput
                value={ownerAliasesInput}
                onChangeText={setOwnerAliasesInput}
                placeholder="Syd, Sydney T"
                placeholderTextColor={theme.textSecondary}
                style={[
                  styles.customInput,
                  {
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.background,
                  },
                ]}
              />
              <Pressable
                onPress={saveIdentity}
                disabled={busyIdentity}
                style={[
                  styles.saveBtn,
                  { backgroundColor: theme.primary, marginTop: 8 },
                  busyIdentity && { opacity: 0.5 },
                ]}
              >
                {busyIdentity ? (
                  <ActivityIndicator size="small" color={theme.primaryText} />
                ) : (
                  <Text style={{ color: theme.primaryText, fontWeight: '700' }}>Save identity</Text>
                )}
              </Pressable>
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="smallBold">Default AI mode</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Applies to contacts you haven&apos;t set a per-chat mode for.
              </ThemedText>
              <View style={styles.toneList}>
                {AI_MODE_OPTIONS.map((opt) => {
                  const selected = currentAiMode === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => selectAiMode(opt.value)}
                      disabled={busyAiMode !== null}
                      style={[
                        styles.toneRow,
                        {
                          borderColor: selected ? theme.primary : theme.border,
                          backgroundColor: selected ? theme.backgroundSelected : 'transparent',
                        },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.toneLabel, { color: theme.text }]}>{opt.label}</Text>
                        <Text style={[styles.toneDesc, { color: theme.textSecondary }]}>
                          {opt.description}
                        </Text>
                      </View>
                      {busyAiMode === opt.value ? (
                        <ActivityIndicator size="small" color={theme.primary} />
                      ) : selected ? (
                        <AppIcon name="check" tintColor={theme.primary} size={18} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="smallBold">Auto-extract tasks</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Let Bimi automatically pull tasks, reminders, and deadlines out of incoming
                messages.
              </ThemedText>
              <Pressable
                onPress={toggleAutoExtract}
                disabled={busyAutoExtract}
                style={[
                  styles.toneRow,
                  {
                    borderColor: autoExtractEnabled ? theme.primary : theme.border,
                    backgroundColor: autoExtractEnabled ? theme.backgroundSelected : 'transparent',
                    marginTop: 8,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.toneLabel, { color: theme.text }]}>
                    {autoExtractEnabled ? 'Enabled' : 'Disabled'}
                  </Text>
                  <Text style={[styles.toneDesc, { color: theme.textSecondary }]}>
                    {autoExtractEnabled
                      ? 'Tasks appear in the Tasks tab automatically.'
                      : 'Tap to enable. You can still create tasks manually.'}
                  </Text>
                </View>
                {busyAutoExtract ? (
                  <ActivityIndicator size="small" color={theme.primary} />
                ) : autoExtractEnabled ? (
                  <AppIcon name="check" tintColor={theme.primary} size={18} />
                ) : null}
              </Pressable>
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="smallBold">Contact memory extraction</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Builds the living memory profile on each contact and group from recent chats.
              </ThemedText>
              <View style={styles.toneList}>
                {MEMORY_INTERVAL_OPTIONS.map((opt) => {
                  const selected = (pref?.memoryExtractionIntervalHours ?? 24) === opt.hours;
                  return (
                    <Pressable
                      key={opt.hours}
                      onPress={() => selectMemoryInterval(opt.hours)}
                      disabled={busyMemorySchedule !== null}
                      style={[
                        styles.toneRow,
                        {
                          borderColor: selected ? theme.primary : theme.border,
                          backgroundColor: selected ? theme.backgroundSelected : 'transparent',
                        },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.toneLabel, { color: theme.text }]}>{opt.label}</Text>
                        <Text style={[styles.toneDesc, { color: theme.textSecondary }]}>
                          {opt.description}
                        </Text>
                      </View>
                      {busyMemorySchedule === opt.hours ? (
                        <ActivityIndicator size="small" color={theme.primary} />
                      ) : selected ? (
                        <AppIcon name="check" tintColor={theme.primary} size={18} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
              <Text style={[styles.toneDesc, { color: theme.textSecondary, marginTop: 8 }]}>
                Daily time
              </Text>
              <TextInput
                value={memoryDailyTimeInput}
                onChangeText={setMemoryDailyTimeInput}
                placeholder="21:00"
                placeholderTextColor={theme.textSecondary}
                style={[
                  styles.customInput,
                  {
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.background,
                  },
                ]}
              />
              <Pressable
                onPress={() => selectMemoryInterval(pref?.memoryExtractionIntervalHours ?? 24)}
                disabled={busyMemorySchedule !== null}
                style={[
                  styles.saveBtn,
                  { backgroundColor: theme.primary, marginTop: 8 },
                  busyMemorySchedule !== null && { opacity: 0.5 },
                ]}
              >
                {busyMemorySchedule !== null ? (
                  <ActivityIndicator size="small" color={theme.primaryText} />
                ) : (
                  <Text style={{ color: theme.primaryText, fontWeight: '700' }}>
                    Save memory schedule
                  </Text>
                )}
              </Pressable>
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="smallBold">Default reply tone</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Bimi uses this tone when drafting replies. You can override per draft.
              </ThemedText>
              <View style={styles.toneList}>
                {TONE_OPTIONS.map((opt) => {
                  const selected = currentTone === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      onPress={() => selectTone(opt.key)}
                      disabled={busy !== null}
                      style={[
                        styles.toneRow,
                        {
                          borderColor: selected ? theme.primary : theme.border,
                          backgroundColor: selected ? theme.backgroundSelected : 'transparent',
                        },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.toneLabel, { color: theme.text }]}>{opt.label}</Text>
                        <Text style={[styles.toneDesc, { color: theme.textSecondary }]}>
                          {opt.description}
                        </Text>
                      </View>
                      {busy === opt.key ? (
                        <ActivityIndicator size="small" color={theme.primary} />
                      ) : selected ? (
                        <AppIcon name="check" tintColor={theme.primary} size={18} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
              {currentTone === 'custom' || customInput.length > 0 ? (
                <View style={styles.customWrap}>
                  <TextInput
                    value={customInput}
                    onChangeText={setCustomInput}
                    placeholder='e.g. "in pidgin" or "more apologetic"'
                    placeholderTextColor={theme.textSecondary}
                    style={[
                      styles.customInput,
                      {
                        color: theme.text,
                        borderColor: theme.border,
                        backgroundColor: theme.background,
                      },
                    ]}
                  />
                  <Pressable
                    onPress={() => selectTone('custom')}
                    disabled={busy !== null || customInput.trim().length === 0}
                    style={[
                      styles.saveBtn,
                      { backgroundColor: theme.primary },
                      (busy !== null || customInput.trim().length === 0) && {
                        opacity: 0.5,
                      },
                    ]}
                  >
                    {busy === 'custom' ? (
                      <ActivityIndicator size="small" color={theme.primaryText} />
                    ) : (
                      <Text style={{ color: theme.primaryText, fontWeight: '700' }}>
                        Save custom tone
                      </Text>
                    )}
                  </Pressable>
                </View>
              ) : null}
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="smallBold">Appearance</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Following system theme — currently {themeLabel.toLowerCase()}.
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Manual override coming soon.
              </ThemedText>
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="smallBold">About</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Bimi · {Constants.expoConfig?.version ?? 'dev'}
              </ThemedText>
            </ThemedView>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingContainer>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  header: { gap: Spacing.one },
  headerTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontFamily: Fonts.sansBold,
    letterSpacing: -0.4,
  },
  scrollContent: { gap: Spacing.four, paddingBottom: 88 },
  section: { borderRadius: 12, padding: Spacing.three, gap: Spacing.one },
  toneList: { gap: 8, marginTop: 8 },
  toneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  toneLabel: { fontSize: 15, fontFamily: Fonts.sansSemiBold },
  toneDesc: { fontSize: 12, marginTop: 2, fontFamily: Fonts.sans },
  check: { fontSize: 18, fontFamily: Fonts.sansBold },
  customWrap: { gap: 8, marginTop: 8 },
  customInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    fontFamily: Fonts.sans,
  },
  saveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
