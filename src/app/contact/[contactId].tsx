import { useAction, useMutation, useQuery } from 'convex/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';

import { Avatar } from '@/components/chat/avatar';
import { AppIcon } from '@/components/ui/app-icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  SelectButton,
  SelectionBar,
  SelectionCheck,
  confirmDestructive,
} from '@/components/ui/selection-bar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteInChunks, useSelection } from '@/hooks/use-selection';
import { AI_MODE_OPTIONS } from '@/lib/ai-modes';

import { api } from '../../../convex/_generated/api';
import type { Doc, Id } from '../../../convex/_generated/dataModel';

export default function ContactDetailsScreen() {
  const { contactId } = useLocalSearchParams<{ contactId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const validContactId = contactId ? (contactId as Id<'contacts'>) : null;
  const contact = useQuery(
    api.contacts.getContact,
    validContactId ? { contactId: validContactId } : 'skip',
  );
  const refreshGroupInfo = useAction(api.contacts.refreshGroupInfo);
  const [refreshing, setRefreshing] = useState(false);

  if (!validContactId || contact === undefined) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.center}>
          <ActivityIndicator color={theme.primary} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (contact === null) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.center}>
          <ThemedText>Contact not found.</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const isGroup = contact.isGroup === true;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshGroupInfo({ contactId: validContactId });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <AppIcon name="back" tintColor={theme.primary} size={22} />
          </Pressable>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.identity}>
            <Avatar
              name={contact.displayName}
              isGroup={isGroup}
              size={108}
              imageUrl={contact.avatarUrl ?? (isGroup ? contact.groupPictureUrl : undefined)}
            />
            <ThemedText type="title">{contact.displayName ?? contact.remoteJid}</ThemedText>
            {isGroup ? (
              <ThemedText type="small" themeColor="textSecondary">
                {contact.groupSize !== undefined ? `${contact.groupSize} members` : 'Group chat'}
              </ThemedText>
            ) : contact.phoneNumber ? (
              <ThemedText type="small" themeColor="textSecondary">
                {contact.phoneNumber}
              </ThemedText>
            ) : null}
          </View>

          <Pressable
            onPress={() =>
              router.push({
                pathname: '/search',
                params: { contactId: validContactId },
              })
            }
            style={({ pressed }) => [
              styles.section,
              { backgroundColor: theme.backgroundElement },
              pressed && { opacity: 0.85 },
            ]}
          >
            <ThemedText type="smallBold">Search in chat</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Find messages exchanged with this contact.
            </ThemedText>
          </Pressable>

          <ContactMemorySection
            contactId={validContactId}
            contactName={contact.displayName ?? contact.pushName ?? undefined}
          />

          <ContactGoalsSection
            contactId={validContactId}
            contactLabel={contact.displayName ?? contact.pushName ?? 'this contact'}
          />

          <ContactReplyStyleSection contactId={validContactId} />

          <ChatSettingsSection contactId={validContactId} />

          {isGroup ? (
            <>
              {contact.groupDescription ? (
                <View style={[styles.section, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="smallBold">Description</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {contact.groupDescription}
                  </ThemedText>
                </View>
              ) : null}

              <View style={[styles.section, { backgroundColor: theme.backgroundElement }]}>
                <View style={styles.sectionHeader}>
                  <ThemedText type="smallBold">
                    Participants
                    {contact.groupParticipants ? ` (${contact.groupParticipants.length})` : ''}
                  </ThemedText>
                  <Pressable
                    onPress={handleRefresh}
                    disabled={refreshing}
                    hitSlop={8}
                    style={({ pressed }) => [pressed && { opacity: 0.65 }]}
                  >
                    {refreshing ? (
                      <ActivityIndicator color={theme.primary} />
                    ) : (
                      <ThemedText type="smallBold" style={{ color: theme.primary }}>
                        Refresh
                      </ThemedText>
                    )}
                  </Pressable>
                </View>
                {contact.groupParticipants && contact.groupParticipants.length > 0 ? (
                  <View style={styles.participantList}>
                    {contact.groupParticipants.map((p) => (
                      <View key={p.id} style={styles.participantRow}>
                        <Avatar name={p.id.split('@')[0]} size={36} />
                        <View style={{ flex: 1 }}>
                          <ThemedText type="small">{p.id.split('@')[0]}</ThemedText>
                          {p.admin ? (
                            <ThemedText type="small" themeColor="textSecondary">
                              {p.admin === 'superadmin' ? 'Group owner' : 'Admin'}
                            </ThemedText>
                          ) : null}
                        </View>
                      </View>
                    ))}
                  </View>
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">
                    Tap Refresh to load participants from the server.
                  </ThemedText>
                )}
              </View>
            </>
          ) : (
            <View style={[styles.section, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold">About</ThemedText>
              {contact.source ? <Row label="Source" value={contact.source} /> : null}
              {contact.pushName ? <Row label="WhatsApp name" value={contact.pushName} /> : null}
              {contact.deviceContactId ? <Row label="Device contact" value="Synced" /> : null}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="small">{value}</ThemedText>
    </View>
  );
}

const PRIORITY_OPTIONS: {
  value: 'urgent' | 'high' | 'normal' | 'low';
  label: string;
}[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

type IncomingMessageMode = 'save_and_process' | 'save_only' | 'ignore';

const INCOMING_MESSAGE_MODE_OPTIONS: {
  value: IncomingMessageMode;
  label: string;
  description: string;
}[] = [
  {
    value: 'save_and_process',
    label: 'Save & process',
    description: 'Save new incoming messages and run Bimi’s automatic AI features.',
  },
  {
    value: 'save_only',
    label: 'Save only',
    description: 'Keep new incoming messages, but use AI only when you explicitly ask.',
  },
  {
    value: 'ignore',
    label: 'Ignore',
    description: 'Do not save or process new incoming messages from this chat.',
  },
];

type Relationship =
  | 'vip'
  | 'client'
  | 'family'
  | 'friend'
  | 'classmate'
  | 'team'
  | 'low_priority'
  | 'unknown';

const RELATIONSHIP_OPTIONS: { value: Relationship; label: string }[] = [
  { value: 'vip', label: 'VIP' },
  { value: 'client', label: 'Client' },
  { value: 'family', label: 'Family' },
  { value: 'friend', label: 'Friend' },
  { value: 'classmate', label: 'Classmate' },
  { value: 'team', label: 'Team' },
  { value: 'low_priority', label: 'Low priority' },
  { value: 'unknown', label: 'Unknown' },
];

function daysAgoLabel(ms?: number): string {
  if (!ms) return 'never';
  const days = Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function ChatSettingsSection({ contactId }: { contactId: Id<'contacts'> }) {
  const theme = useTheme();
  const settings = useQuery(api.chatSettings.getChatSettings, { contactId });
  const setPriority = useMutation(api.chatSettings.setPriority);
  const setMuted = useMutation(api.chatSettings.setMuted);
  const setAiMode = useMutation(api.chatSettings.setAiMode);
  const setIncomingMessageMode = useMutation(api.chatSettings.setIncomingMessageMode);
  const setAutoReplyRules = useMutation(api.chatSettings.setAutoReplyRules);
  const setRelationship = useMutation(api.chatSettings.setRelationship);
  const setCheckInCadence = useMutation(api.chatSettings.setCheckInCadence);
  const setMemoryEnabled = useMutation(api.contacts.setMemoryEnabled);
  const [savingIncomingMode, setSavingIncomingMode] = useState(false);

  const saveIncomingMode = async (mode: IncomingMessageMode) => {
    setSavingIncomingMode(true);
    try {
      await setIncomingMessageMode({ contactId, mode });
    } catch (error) {
      Alert.alert(
        'Could not update message handling',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setSavingIncomingMode(false);
    }
  };

  const chooseIncomingMode = (mode: IncomingMessageMode) => {
    if (savingIncomingMode || mode === settings?.incomingMessageMode) return;
    if (mode !== 'ignore') {
      void saveIncomingMode(mode);
      return;
    }
    Alert.alert(
      'Ignore new incoming messages?',
      'Messages received while this is enabled will not appear in Bimi and cannot be recovered inside Bimi. Existing history and sent messages are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Ignore messages',
          style: 'destructive',
          onPress: () => void saveIncomingMode('ignore'),
        },
      ],
    );
  };

  if (!settings) {
    return (
      <View style={[styles.section, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold">Bimi settings</ThemedText>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.section, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold">Bimi settings</ThemedText>

      <View style={settingsStyles.fieldGroup}>
        <ThemedText type="small" themeColor="textSecondary">
          New incoming messages
        </ThemedText>
        {INCOMING_MESSAGE_MODE_OPTIONS.map((opt) => {
          const active = settings.incomingMessageMode === opt.value;
          return (
            <Pressable
              key={opt.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: active, disabled: savingIncomingMode }}
              disabled={savingIncomingMode}
              onPress={() => chooseIncomingMode(opt.value)}
              style={[
                settingsStyles.modeRow,
                { borderColor: theme.border },
                active && {
                  borderColor: theme.primary,
                  backgroundColor: theme.backgroundSelected,
                },
                savingIncomingMode && { opacity: 0.6 },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontWeight: '600' }}>{opt.label}</Text>
                <Text style={{ color: theme.textSecondary, fontSize: 12 }}>{opt.description}</Text>
              </View>
              <View
                style={[
                  settingsStyles.radio,
                  { borderColor: theme.border },
                  active && {
                    backgroundColor: theme.primary,
                    borderColor: theme.primary,
                  },
                ]}
              />
            </Pressable>
          );
        })}
        <ThemedText type="small" themeColor="textSecondary">
          This is separate from AI reply mode and applies only to future incoming messages.
        </ThemedText>
      </View>

      <View style={settingsStyles.fieldGroup}>
        <ThemedText type="small" themeColor="textSecondary">
          Relationship
        </ThemedText>
        <View style={settingsStyles.chipRow}>
          {RELATIONSHIP_OPTIONS.map((opt) => {
            const active = (settings.relationship ?? 'unknown') === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setRelationship({ contactId, relationship: opt.value })}
                style={[
                  settingsStyles.chip,
                  { borderColor: theme.border },
                  active && {
                    backgroundColor: theme.primary,
                    borderColor: theme.primary,
                  },
                ]}
              >
                <Text
                  style={{
                    color: active ? theme.primaryText : theme.text,
                    fontWeight: '600',
                    fontSize: 12,
                  }}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={settingsStyles.fieldGroup}>
        <ThemedText type="small" themeColor="textSecondary">
          Check-in cadence (days, 0 = off)
        </ThemedText>
        <View style={settingsStyles.cadenceRow}>
          <Pressable
            onPress={() =>
              setCheckInCadence({
                contactId,
                days: Math.max(0, (settings.checkInCadenceDays ?? 0) - 1),
                weekday: settings.checkInWeekday,
              })
            }
            style={[settingsStyles.stepBtn, { borderColor: theme.border }]}
          >
            <Text style={{ color: theme.text, fontWeight: '700' }}>−</Text>
          </Pressable>
          <Text style={[settingsStyles.cadenceValue, { color: theme.text }]}>
            {settings.checkInCadenceDays ?? 0}
          </Text>
          <Pressable
            onPress={() =>
              setCheckInCadence({
                contactId,
                days: Math.min(365, (settings.checkInCadenceDays ?? 0) + 1),
                weekday: settings.checkInWeekday,
              })
            }
            style={[settingsStyles.stepBtn, { borderColor: theme.border }]}
          >
            <Text style={{ color: theme.text, fontWeight: '700' }}>+</Text>
          </Pressable>
          <Text style={[settingsStyles.cadenceHint, { color: theme.textSecondary }]}>
            Last sent: {daysAgoLabel(settings.lastUserMessageAt)}
          </Text>
        </View>
      </View>

      <View style={settingsStyles.fieldGroup}>
        <ThemedText type="small" themeColor="textSecondary">
          Priority
        </ThemedText>
        <View style={settingsStyles.chipRow}>
          {PRIORITY_OPTIONS.map((opt) => {
            const active = settings.priority === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setPriority({ contactId, priority: opt.value })}
                style={[
                  settingsStyles.chip,
                  { borderColor: theme.border },
                  active && {
                    backgroundColor: theme.primary,
                    borderColor: theme.primary,
                  },
                ]}
              >
                <Text
                  style={{
                    color: active ? theme.primaryText : theme.text,
                    fontWeight: '600',
                    fontSize: 12,
                  }}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={settingsStyles.row}>
        <View style={{ flex: 1 }}>
          <ThemedText type="small">Mute chat</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Don&apos;t notify for this chat.
          </ThemedText>
        </View>
        <Switch
          value={settings.muted}
          onValueChange={(v) => {
            void setMuted({ contactId, muted: v });
          }}
        />
      </View>

      <View style={settingsStyles.row}>
        <View style={{ flex: 1 }}>
          <ThemedText type="small">Memory for this contact</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            When off, Bimi stops capturing new facts. Existing entries still inform replies.
          </ThemedText>
        </View>
        <Switch
          value={settings.memoryEnabled !== false}
          onValueChange={(v) => {
            void setMemoryEnabled({ contactId, enabled: v });
          }}
        />
      </View>

      <View style={settingsStyles.fieldGroup}>
        <ThemedText type="small" themeColor="textSecondary">
          AI mode
        </ThemedText>
        {AI_MODE_OPTIONS.map((opt) => {
          const active = settings.aiMode === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => setAiMode({ contactId, aiMode: opt.value })}
              style={[
                settingsStyles.modeRow,
                { borderColor: theme.border },
                active && {
                  borderColor: theme.primary,
                  backgroundColor: theme.backgroundSelected,
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontWeight: '600' }}>{opt.label}</Text>
                <Text style={{ color: theme.textSecondary, fontSize: 12 }}>{opt.description}</Text>
              </View>
              <View
                style={[
                  settingsStyles.radio,
                  { borderColor: theme.border },
                  active && {
                    backgroundColor: theme.primary,
                    borderColor: theme.primary,
                  },
                ]}
              />
            </Pressable>
          );
        })}
      </View>

      <View style={settingsStyles.fieldGroup}>
        <ThemedText type="small" themeColor="textSecondary">
          Auto-reply rules
        </ThemedText>
        <ToggleRow
          label="Allow greetings"
          value={settings.autoReplyAllowGreetings}
          onChange={(v) => setAutoReplyRules({ contactId, autoReplyAllowGreetings: v })}
        />
        <ToggleRow
          label="Allow acknowledgments"
          value={settings.autoReplyAllowAcknowledgments}
          onChange={(v) => setAutoReplyRules({ contactId, autoReplyAllowAcknowledgments: v })}
        />
        <ToggleRow
          label="Allow small talk"
          value={settings.autoReplyAllowSmallTalk}
          onChange={(v) => setAutoReplyRules({ contactId, autoReplyAllowSmallTalk: v })}
        />
        <ToggleRow
          label="Block all auto-reply"
          value={settings.autoReplyBlocked}
          onChange={(v) => setAutoReplyRules({ contactId, autoReplyBlocked: v })}
        />
      </View>
    </View>
  );
}

function ToggleRow(props: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void | Promise<unknown>;
}) {
  return (
    <View style={settingsStyles.row}>
      <ThemedText type="small" style={{ flex: 1 }}>
        {props.label}
      </ThemedText>
      <Switch
        value={props.value}
        onValueChange={(v) => {
          void props.onChange(v);
        }}
      />
    </View>
  );
}

const MEMORY_TYPES: ('fact' | 'preference' | 'commitment' | 'ongoing' | 'relationship')[] = [
  'fact',
  'preference',
  'commitment',
  'ongoing',
  'relationship',
];

const MEMORY_TYPE_COLOR: Record<string, string> = {
  fact: '#2563EB',
  preference: '#7C3AED',
  commitment: '#DC2626',
  ongoing: '#0891B2',
  relationship: '#16A34A',
};

function ContactMemorySection({
  contactId,
  contactName,
}: {
  contactId: Id<'contacts'>;
  contactName?: string;
}) {
  const theme = useTheme();
  const profile = useQuery(api.contactMemory.getProfile, { contactId });
  const refreshProfile = useAction(api.contactMemory.refreshContactProfile);
  const rows = useQuery(api.memories.list, {
    instance: '',
    contactId,
    scope: 'contact',
    status: 'active',
    limit: 50,
  });
  // The query takes `instance` for fan-out, but the index keys off
  // contactId — so we pass empty string here; the contactId index path
  // ignores instance.
  const pin = useMutation(api.memories.pin);
  const dismiss = useMutation(api.memories.dismiss);
  const [adding, setAdding] = useState(false);
  const [refreshingProfile, setRefreshingProfile] = useState(false);

  // Sort: pinned first, then by updatedAt
  const sorted = (rows ?? []).slice().sort((a, b) => {
    const ap = a.pinned ? 1 : 0;
    const bp = b.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return b.updatedAt - a.updatedAt;
  });

  return (
    <View style={[styles.section, { backgroundColor: theme.backgroundElement }]}>
      <View style={memoryStyles.headerRow}>
        <View style={{ flex: 1 }}>
          <ThemedText type="smallBold">Memory</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            What Bimi knows about {contactName ?? 'this contact'}. Loaded into every reply.
          </ThemedText>
        </View>
        <Pressable
          onPress={() => setAdding(true)}
          style={[memoryStyles.addBtn, { backgroundColor: theme.primary }]}
        >
          <Text style={{ color: theme.primaryText, fontWeight: '700' }}>+ Add</Text>
        </Pressable>
      </View>

      <View
        style={[
          memoryStyles.profileBox,
          { borderColor: theme.border, backgroundColor: theme.background },
        ]}
      >
        <View style={memoryStyles.profileHeader}>
          <ThemedText type="smallBold">Profile</ThemedText>
          <Pressable
            onPress={async () => {
              if (refreshingProfile) return;
              setRefreshingProfile(true);
              try {
                await refreshProfile({ contactId });
              } catch (err) {
                Alert.alert('Refresh failed', err instanceof Error ? err.message : String(err));
              } finally {
                setRefreshingProfile(false);
              }
            }}
            disabled={refreshingProfile}
            hitSlop={8}
          >
            {refreshingProfile ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : (
              <Text
                style={{
                  color: theme.primary,
                  fontWeight: '700',
                  fontSize: 12,
                }}
              >
                Refresh
              </Text>
            )}
          </Pressable>
        </View>
        {profile === undefined ? (
          <ActivityIndicator color={theme.primary} style={{ marginTop: 8 }} />
        ) : profile === null ? (
          <ThemedText type="small" themeColor="textSecondary">
            No profile yet. Tap Refresh after you have messages with this chat.
          </ThemedText>
        ) : (
          <View style={{ gap: 8 }}>
            <Text style={[memoryStyles.profileText, { color: theme.text }]}>{profile.summary}</Text>
            {profile.relationshipNotes ? (
              <ProfileLine label="Relationship" value={profile.relationshipNotes} />
            ) : null}
            <ProfileList label="Preferences" items={profile.preferences} />
            <ProfileList label="Current topics" items={profile.currentTopics} />
            <ProfileList label="Commitments" items={profile.commitments} />
            <ThemedText type="code" themeColor="textSecondary">
              Updated {daysAgoLabel(profile.updatedAt)}
            </ThemedText>
          </View>
        )}
      </View>

      {rows === undefined ? (
        <ActivityIndicator color={theme.primary} style={{ marginTop: 12 }} />
      ) : sorted.length === 0 ? (
        <ThemedText
          type="small"
          themeColor="textSecondary"
          style={{ marginTop: 12, fontStyle: 'italic' }}
        >
          Nothing saved yet. Tap + Add to write your first fact, or Bimi will pick things up as you
          chat.
        </ThemedText>
      ) : (
        <View style={{ marginTop: 8 }}>
          {sorted.map((m) => (
            <Pressable
              key={m._id}
              onLongPress={() => {
                Alert.alert(m.content, undefined, [
                  {
                    text: m.pinned ? 'Unpin' : 'Pin',
                    onPress: () => pin({ memoryId: m._id, pinned: !m.pinned }),
                  },
                  {
                    text: 'Dismiss',
                    style: 'destructive',
                    onPress: () => dismiss({ memoryId: m._id }),
                  },
                  { text: 'Cancel', style: 'cancel' },
                ]);
              }}
              delayLongPress={350}
              style={({ pressed }) => [
                memoryStyles.row,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.background,
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <View style={memoryStyles.rowTop}>
                <View
                  style={[
                    memoryStyles.typePill,
                    {
                      backgroundColor: MEMORY_TYPE_COLOR[m.type] ?? theme.textSecondary,
                    },
                  ]}
                >
                  <Text style={memoryStyles.typePillText}>{m.type}</Text>
                </View>
                {m.pinned ? <Text style={{ fontSize: 12 }}>📌</Text> : null}
                <View style={{ flex: 1 }} />
                <Text style={[memoryStyles.confLabel, { color: theme.textSecondary }]}>
                  {Math.round(m.confidence * 100)}%
                </Text>
              </View>
              <Text style={[memoryStyles.body, { color: theme.text }]}>{m.content}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {adding ? (
        <AddContactMemoryModal
          visible={adding}
          contactId={contactId}
          contactName={contactName}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </View>
  );
}

function ProfileLine({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Text style={[memoryStyles.profileLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[memoryStyles.profileText, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

function ProfileList({ label, items }: { label: string; items: string[] }) {
  const theme = useTheme();
  if (items.length === 0) return null;
  return (
    <View style={{ gap: 3 }}>
      <Text style={[memoryStyles.profileLabel, { color: theme.textSecondary }]}>{label}</Text>
      {items.map((item, index) => (
        <Text key={`${label}-${index}`} style={[memoryStyles.profileText, { color: theme.text }]}>
          • {item}
        </Text>
      ))}
    </View>
  );
}

function ContactReplyStyleSection({ contactId }: { contactId: Id<'contacts'> }) {
  const theme = useTheme();
  const profile = useQuery(api.replyStyle.getForContact, { contactId });
  const reset = useMutation(api.replyStyle.resetForContact);
  const [busy, setBusy] = useState(false);

  const resetProfile = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await reset({ contactId });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.section, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.sectionHeader}>
        <View style={{ flex: 1 }}>
          <ThemedText type="smallBold">Learned reply style</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {profile
              ? `${profile.summary}. ${profile.sampleCount} examples.`
              : 'Still learning from messages you write and drafts you approve.'}
          </ThemedText>
          {profile?.commonEmojis.length ? (
            <ThemedText type="small" themeColor="textSecondary">
              Familiar emojis: {profile.commonEmojis.join(' ')}
            </ThemedText>
          ) : null}
        </View>
        {profile ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset learned reply style"
            onPress={resetProfile}
            disabled={busy}
            hitSlop={8}
          >
            {busy ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : (
              <Text style={{ color: theme.primary, fontWeight: '700', fontSize: 12 }}>Reset</Text>
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

type GoalKind = 'check_in' | 'meeting' | 'relationship' | 'custom';
type GoalRecurrence = 'once' | 'daily' | 'weekly' | 'interval' | 'until_done';
type GoalMode = 'draft' | 'auto';

// Mirrors goalRules.ts. STALL_CAP tracks ignored goal attempts, while
// GOAL_MAX_TURNS caps all attempts over the goal's lifetime.
const STALL_CAP = 5;
const GOAL_MAX_TURNS = 8;
const RELATIONSHIP_STALL_CAP = 2;
const RELATIONSHIP_MAX_TURNS = 4;

const GOAL_KIND_OPTIONS: { value: GoalKind; label: string }[] = [
  { value: 'check_in', label: 'Check in' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'relationship', label: 'Relationship' },
  { value: 'custom', label: 'Custom' },
];

const GOAL_RECURRENCE_OPTIONS: { value: GoalRecurrence; label: string }[] = [
  { value: 'until_done', label: 'Until done' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'interval', label: 'Interval' },
  { value: 'once', label: 'Once' },
];

const GOAL_MODE_OPTIONS: {
  value: GoalMode;
  label: string;
  hint: string;
}[] = [
  {
    value: 'draft',
    label: 'Draft it',
    hint: 'Lands in Approvals for you to send with one tap.',
  },
  {
    value: 'auto',
    label: 'Send it',
    hint: 'Bimi sends the message itself, without asking you first.',
  },
];

function formatGoalTime(value?: number): string {
  if (!value) return 'Not scheduled';
  return new Date(value).toLocaleString();
}

/**
 * Open-ended goals have no appointment to show — any inbound reply preempts
 * nextRunAt — so phrase it as a relative "if they stay silent" horizon.
 */
function formatRelativeFuture(value?: number): string {
  if (!value) return 'not scheduled';
  const deltaMs = value - Date.now();
  if (deltaMs <= 0) return 'any moment';
  const hours = Math.round(deltaMs / 3_600_000);
  if (hours < 1) return 'under an hour';
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function goalMetaLine(goal: {
  kind: string;
  recurrence: string;
  nextRunAt?: number;
  unansweredCount?: number;
  turnsUsed?: number;
  lastStrategyAction?: string;
  strategyDeferredUntil?: number;
}): string {
  const kind = goal.kind.replace('_', ' ');
  if (goal.recurrence !== 'until_done') {
    return `${kind} • ${goal.recurrence} • next ${formatGoalTime(goal.nextRunAt)}`;
  }
  const parts = [kind, 'until done'];
  // How much of the goal's lifetime message budget has been used.
  const maxTurns = goal.kind === 'relationship' ? RELATIONSHIP_MAX_TURNS : GOAL_MAX_TURNS;
  const stallCap = goal.kind === 'relationship' ? RELATIONSHIP_STALL_CAP : STALL_CAP;
  parts.push(`${goal.turnsUsed ?? 0}/${maxTurns} messages`);
  const tries = goal.unansweredCount ?? 0;
  if (tries > 0) parts.push(`${tries}/${stallCap} unanswered`);
  if (goal.lastStrategyAction === 'wait' || goal.lastStrategyAction === 'reply_only') {
    parts.push(
      `waiting for a natural opening; check in ${formatRelativeFuture(
        goal.strategyDeferredUntil ?? goal.nextRunAt,
      )}`,
    );
  } else {
    parts.push(`if quiet, check in ${formatRelativeFuture(goal.nextRunAt)}`);
  }
  return parts.join(' • ');
}

function pausedGoalLabel(reason?: string): string {
  if (reason === 'declined') return 'Paused — they declined or set a boundary';
  if (reason === 'low_reciprocity') return 'Paused — the interest was not being returned';
  if (reason === 'unsafe') return 'Paused — the goal needs a safer approach';
  if (reason === 'strategy_pause') return 'Paused — Bimi decided not to keep pushing';
  if (reason === 'stall_cap') return `Paused — no reply after ${STALL_CAP} tries`;
  if (reason === 'turn_budget') {
    return `Paused — sent ${GOAL_MAX_TURNS} messages without getting there`;
  }
  if (reason === 'expired') return 'Paused — ran out of time';
  return 'Paused';
}

type GoalDoc = Doc<'contactGoals'>;

function GoalRow({
  goal,
  contactLabel,
  selectMode,
  selected,
  onSelectToggle,
  onStartSelect,
}: {
  goal: GoalDoc;
  contactLabel: string;
  selectMode?: boolean;
  selected?: boolean;
  onSelectToggle?: () => void;
  onStartSelect?: () => void;
}) {
  const theme = useTheme();
  const updateStatus = useMutation(api.contactGoals.updateStatus);
  const updateMode = useMutation(api.contactGoals.updateMode);
  const removeGoal = useMutation(api.contactGoals.remove);
  const runNow = useMutation(api.contactGoals.runNow);
  const [runningNow, setRunningNow] = useState(false);

  const isAuto = goal.mode === 'auto';
  const isPaused = goal.status === 'paused';

  const onRunNow = async () => {
    if (runningNow) return;
    setRunningNow(true);
    try {
      const res = await runNow({ goalId: goal._id });
      if (!res.success) {
        Alert.alert('Goal', res.message);
      }
    } catch (err) {
      Alert.alert('Goal', err instanceof Error ? err.message : String(err));
    } finally {
      setRunningNow(false);
    }
  };

  const toggleMode = () => {
    if (isAuto) {
      void updateMode({ goalId: goal._id, mode: 'draft' });
      return;
    }
    // Switching to auto grants Bimi authority to message a third party without
    // review — the one control here that deserves a confirmation.
    Alert.alert(
      'Let Bimi send these?',
      `Bimi will send messages for "${goal.title}" to ${contactLabel} without asking you first.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send automatically',
          onPress: () => void updateMode({ goalId: goal._id, mode: 'auto' }),
        },
      ],
    );
  };

  return (
    <Pressable
      onPress={selectMode ? onSelectToggle : undefined}
      onLongPress={selectMode ? undefined : onStartSelect}
      delayLongPress={350}
      style={[
        memoryStyles.goalRow,
        { borderColor: theme.border, backgroundColor: theme.background },
        isPaused && { opacity: 0.75 },
        selectMode &&
          selected === true && {
            borderColor: theme.primary,
            backgroundColor: theme.backgroundSelected,
          },
      ]}
    >
      {selectMode ? <SelectionCheck checked={selected === true} /> : null}
      <View style={{ flex: 1, gap: 4 }}>
        <View style={memoryStyles.goalTitleRow}>
          <Text
            style={{
              color: theme.text,
              fontWeight: '700',
              fontSize: 14,
              flexShrink: 1,
            }}
          >
            {goal.title}
          </Text>
          <Pressable
            onPress={toggleMode}
            disabled={selectMode === true}
            hitSlop={6}
            style={[
              memoryStyles.modeBadge,
              isAuto
                ? { backgroundColor: theme.primary, borderColor: theme.primary }
                : { borderColor: theme.border },
            ]}
          >
            <Text
              style={{
                color: isAuto ? theme.primaryText : theme.textSecondary,
                fontSize: 10,
                fontWeight: '700',
              }}
            >
              {isAuto ? 'AUTO' : 'DRAFT'}
            </Text>
          </Pressable>
        </View>
        <Text style={{ color: theme.textSecondary, fontSize: 12 }}>{goal.instructions}</Text>
        {goal.lastDraftId ? (
          <Text style={{ color: theme.primary, fontSize: 11, fontWeight: '600' }}>
            ✦ Draft queued in Approvals
          </Text>
        ) : null}
        {isPaused ? (
          <Text style={{ color: theme.textSecondary, fontSize: 11 }}>
            {pausedGoalLabel(goal.pausedReason)}
          </Text>
        ) : (
          <Text style={{ color: theme.textSecondary, fontSize: 11 }}>{goalMetaLine(goal)}</Text>
        )}
      </View>
      {selectMode ? null : (
        <View style={memoryStyles.goalActions}>
          {isPaused ? (
            <Pressable
              onPress={() => void updateStatus({ goalId: goal._id, status: 'active' })}
              hitSlop={8}
            >
              <Text
                style={{
                  color: theme.primary,
                  fontWeight: '700',
                  fontSize: 12,
                }}
              >
                Resume
              </Text>
            </Pressable>
          ) : (
            <>
              <Pressable onPress={() => void onRunNow()} disabled={runningNow} hitSlop={8}>
                <Text
                  style={{
                    color: runningNow ? theme.textSecondary : theme.primary,
                    fontWeight: '700',
                    fontSize: 12,
                  }}
                >
                  {runningNow ? 'Running...' : 'Run now'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void updateStatus({ goalId: goal._id, status: 'paused' })}
                hitSlop={8}
              >
                <Text
                  style={{
                    color: theme.primary,
                    fontWeight: '700',
                    fontSize: 12,
                  }}
                >
                  Pause
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void updateStatus({ goalId: goal._id, status: 'done' })}
                hitSlop={8}
              >
                <Text
                  style={{
                    color: theme.primary,
                    fontWeight: '700',
                    fontSize: 12,
                  }}
                >
                  Done
                </Text>
              </Pressable>
            </>
          )}
          <Pressable
            onPress={() =>
              confirmDestructive({
                title: 'Delete goal?',
                message: goal.title,
                confirmLabel: 'Delete',
                onConfirm: () => void removeGoal({ goalId: goal._id }),
              })
            }
            hitSlop={8}
          >
            <Text style={{ color: '#DC2626', fontWeight: '700', fontSize: 12 }}>Delete</Text>
          </Pressable>
        </View>
      )}
    </Pressable>
  );
}

function ContactGoalsSection({
  contactId,
  contactLabel,
}: {
  contactId: Id<'contacts'>;
  contactLabel: string;
}) {
  const theme = useTheme();
  const goals = useQuery(api.contactGoals.listForContact, {
    contactId,
    status: 'active',
    limit: 20,
  });
  const pausedGoals = useQuery(api.contactGoals.listForContact, {
    contactId,
    status: 'paused',
    limit: 10,
  });
  const [adding, setAdding] = useState(false);
  const removeMany = useMutation(api.contactGoals.removeMany);
  const selection = useSelection<Id<'contactGoals'>>();
  const [deleting, setDeleting] = useState(false);

  // Active and paused goals are shown as two lists but delete as one set.
  const allIds = [...(goals ?? []), ...(pausedGoals ?? [])].map((g) => g._id);

  const deleteSelected = async () => {
    setDeleting(true);
    try {
      await deleteInChunks(selection.selected, (goalIds) => removeMany({ goalIds }));
      selection.exit();
    } finally {
      setDeleting(false);
    }
  };

  const rowProps = (goalId: Id<'contactGoals'>) => ({
    selectMode: selection.active,
    selected: selection.isSelected(goalId),
    onSelectToggle: () => selection.toggle(goalId),
    onStartSelect: () => selection.begin(goalId),
  });

  return (
    <View style={[styles.section, { backgroundColor: theme.backgroundElement }]}>
      <View style={memoryStyles.headerRow}>
        <View style={{ flex: 1 }}>
          <ThemedText type="smallBold">Goals</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            What Bimi should work towards in this chat. Each goal either drafts for your approval or
            sends on its own.
          </ThemedText>
        </View>
        {allIds.length > 1 && !selection.active ? <SelectButton onPress={selection.enter} /> : null}
        <Pressable
          onPress={() => setAdding(true)}
          style={[memoryStyles.addBtn, { backgroundColor: theme.primary }]}
        >
          <Text style={{ color: theme.primaryText, fontWeight: '700' }}>+ Goal</Text>
        </Pressable>
      </View>

      {selection.active ? (
        <SelectionBar
          count={selection.count}
          total={allIds.length}
          noun="goal"
          busy={deleting}
          onSelectAll={() => selection.setAll(allIds)}
          onDelete={() => void deleteSelected()}
          onCancel={selection.exit}
        />
      ) : null}

      {goals === undefined ? (
        <ActivityIndicator color={theme.primary} style={{ marginTop: 12 }} />
      ) : goals.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: 8 }}>
          No active goals yet.
        </ThemedText>
      ) : (
        <View style={{ gap: 8, marginTop: 8 }}>
          {goals.map((goal) => (
            <GoalRow
              key={goal._id}
              goal={goal}
              contactLabel={contactLabel}
              {...rowProps(goal._id)}
            />
          ))}
        </View>
      )}

      {pausedGoals !== undefined && pausedGoals.length > 0 ? (
        <View style={{ gap: 8, marginTop: 12 }}>
          <Text style={[memoryStyles.label, { color: theme.textSecondary }]}>Paused</Text>
          {pausedGoals.map((goal) => (
            <GoalRow
              key={goal._id}
              goal={goal}
              contactLabel={contactLabel}
              {...rowProps(goal._id)}
            />
          ))}
        </View>
      ) : null}

      {/* Mounted only while open, so every open starts from clean state
          instead of needing an effect to reset the fields. */}
      {adding ? <AddGoalModal contactId={contactId} onClose={() => setAdding(false)} /> : null}
    </View>
  );
}

/** Presets for the goal kinds that have an obvious default phrasing. */
const GOAL_KIND_PRESETS: Partial<
  Record<GoalKind, { title: string; instructions: string; successCriteria: string }>
> = {
  check_in: {
    title: 'Check in',
    instructions: 'Ask how they are doing in a warm, short way.',
    successCriteria: 'They reply and the conversation feels caught up.',
  },
  meeting: {
    title: 'Find a time to meet',
    instructions: 'Ask when they are available and follow up politely.',
    successCriteria: 'They agree to a specific day and time.',
  },
  relationship: {
    title: 'Express interest',
    instructions:
      'Build warmth naturally, express interest confidently, and invite them out when the moment fits. Do not pressure them or keep pursuing after a clear no.',
    successCriteria:
      'They clearly reciprocate interest, accept or decline an invitation, or set a boundary.',
  },
};

function AddGoalModal({ contactId, onClose }: { contactId: Id<'contacts'>; onClose: () => void }) {
  const theme = useTheme();
  const createGoal = useMutation(api.contactGoals.create);
  const enhanceDraft = useAction(api.contactGoals.enhanceDraft);
  const [kind, setKind] = useState<GoalKind>('meeting');
  const [recurrence, setRecurrence] = useState<GoalRecurrence>('until_done');
  const [mode, setMode] = useState<GoalMode>('draft');
  const [title, setTitle] = useState('Find a time to meet');
  const [instructions, setInstructions] = useState(
    'Ask when they are available and follow up politely.',
  );
  const [successCriteria, setSuccessCriteria] = useState('They agree to a specific day and time.');
  const [preferredTime, setPreferredTime] = useState('09:00');
  const [intervalHours, setIntervalHours] = useState('5');
  const [nudgeHours, setNudgeHours] = useState('24');
  const [busy, setBusy] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanced, setEnhanced] = useState(false);

  const openEnded = recurrence === 'until_done';

  const onEnhance = async () => {
    if (enhancing || busy) return;
    if (!instructions.trim()) {
      Alert.alert('Write the instruction first, then enhance it.');
      return;
    }
    setEnhancing(true);
    try {
      const result = await enhanceDraft({
        contactId,
        kind,
        instructions,
        title,
        successCriteria,
      });
      // Everything lands in the normal fields, still editable — this is a
      // suggestion the user accepts by saving, not a decision made for them.
      setTitle(result.title);
      setInstructions(result.instructions);
      setSuccessCriteria(result.successCriteria);
      setEnhanced(true);
    } catch (err) {
      Alert.alert('Enhance failed', err instanceof Error ? err.message : String(err));
    } finally {
      setEnhancing(false);
    }
  };

  // Picking a kind is an event, not something to synchronise in an effect.
  const pickKind = (next: GoalKind) => {
    setKind(next);
    const preset = GOAL_KIND_PRESETS[next];
    if (!preset) return;
    setTitle(preset.title);
    setInstructions(preset.instructions);
    setSuccessCriteria(preset.successCriteria);
    // The preset just overwrote the enhanced text, so the badge would be a lie.
    setEnhanced(false);
  };

  const onSave = async () => {
    if (busy) return;
    if (!title.trim() || !instructions.trim()) {
      Alert.alert('Goal needs a title and instruction.');
      return;
    }
    setBusy(true);
    try {
      await createGoal({
        contactId,
        title: title.trim(),
        instructions: instructions.trim(),
        kind,
        recurrence,
        // For an open-ended goal intervalHours is the base nudge cadence used
        // when the contact goes quiet; for `interval` it is the fixed period.
        intervalHours: openEnded
          ? Math.max(6, Number(nudgeHours) || 24)
          : recurrence === 'interval'
            ? Math.max(1, Number(intervalHours) || 5)
            : undefined,
        preferredTime: openEnded ? undefined : preferredTime.trim() || undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        successCriteria: successCriteria.trim() || undefined,
        mode,
      });
      onClose();
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingContainer style={{ flex: 1 }}>
        <Pressable style={memoryStyles.backdrop} onPress={onClose}>
          <Pressable
            style={[
              memoryStyles.sheet,
              { backgroundColor: theme.background, borderColor: theme.border },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={memoryStyles.grabber} />
              <ThemedText type="smallBold">Add contact goal</ThemedText>

              <Text style={[memoryStyles.label, { color: theme.textSecondary }]}>Type</Text>
              <View style={memoryStyles.typeGrid}>
                {GOAL_KIND_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.value}
                    onPress={() => pickKind(opt.value)}
                    style={[
                      memoryStyles.typeChip,
                      {
                        borderColor: theme.border,
                        backgroundColor: theme.backgroundElement,
                      },
                      kind === opt.value && {
                        backgroundColor: theme.primary,
                        borderColor: theme.primary,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: kind === opt.value ? theme.primaryText : theme.text,
                        fontSize: 13,
                        fontWeight: '600',
                      }}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[memoryStyles.label, { color: theme.textSecondary }]}>Title</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Find a time to meet"
                placeholderTextColor={theme.textSecondary}
                style={[
                  memoryStyles.input,
                  {
                    minHeight: 46,
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.backgroundElement,
                  },
                ]}
              />

              <View style={memoryStyles.labelRow}>
                <Text style={[memoryStyles.label, { color: theme.textSecondary }]}>
                  Instruction
                </Text>
                <Pressable
                  onPress={() => void onEnhance()}
                  disabled={enhancing || busy || instructions.trim().length === 0}
                  hitSlop={8}
                  style={[
                    memoryStyles.enhanceBtn,
                    { borderColor: theme.aiAccent },
                    (enhancing || instructions.trim().length === 0) && {
                      opacity: 0.5,
                    },
                  ]}
                >
                  {enhancing ? (
                    <ActivityIndicator size="small" color={theme.aiAccent} />
                  ) : (
                    <Text
                      style={{
                        color: theme.aiAccent,
                        fontSize: 12,
                        fontWeight: '700',
                      }}
                    >
                      ✦ Enhance
                    </Text>
                  )}
                </Pressable>
              </View>
              <TextInput
                value={instructions}
                onChangeText={(text) => {
                  setInstructions(text);
                  if (enhanced) setEnhanced(false);
                }}
                placeholder="Say it however you like — e.g. get him to send the invoice"
                placeholderTextColor={theme.textSecondary}
                multiline
                style={[
                  memoryStyles.input,
                  {
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.backgroundElement,
                  },
                ]}
              />
              <ThemedText type="small" themeColor="textSecondary">
                {enhanced
                  ? '✦ Rewritten for Bimi, along with the title and finish line. Edit anything that reads wrong.'
                  : 'Write it in your own words. Enhance rewrites it for Bimi and fills in the title and finish line.'}
              </ThemedText>

              <Text style={[memoryStyles.label, { color: theme.textSecondary }]}>Repeats</Text>
              <View style={memoryStyles.typeGrid}>
                {GOAL_RECURRENCE_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.value}
                    onPress={() => setRecurrence(opt.value)}
                    style={[
                      memoryStyles.typeChip,
                      {
                        borderColor: theme.border,
                        backgroundColor: theme.backgroundElement,
                      },
                      recurrence === opt.value && {
                        backgroundColor: theme.primary,
                        borderColor: theme.primary,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: recurrence === opt.value ? theme.primaryText : theme.text,
                        fontSize: 13,
                        fontWeight: '600',
                      }}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {openEnded ? (
                <>
                  <View style={memoryStyles.labelRow}>
                    <Text style={[memoryStyles.label, { color: theme.textSecondary }]}>
                      Done when
                    </Text>
                    {/* Same call as the instruction's button: the finish line is
                    judged against the instruction, so rewriting one without the
                    other is how they drift apart. */}
                    <Pressable
                      onPress={() => void onEnhance()}
                      disabled={enhancing || busy || instructions.trim().length === 0}
                      hitSlop={8}
                      style={[
                        memoryStyles.enhanceBtn,
                        { borderColor: theme.aiAccent },
                        (enhancing || instructions.trim().length === 0) && {
                          opacity: 0.5,
                        },
                      ]}
                    >
                      {enhancing ? (
                        <ActivityIndicator size="small" color={theme.aiAccent} />
                      ) : (
                        <Text
                          style={{
                            color: theme.aiAccent,
                            fontSize: 12,
                            fontWeight: '700',
                          }}
                        >
                          ✦ Enhance
                        </Text>
                      )}
                    </Pressable>
                  </View>
                  <TextInput
                    value={successCriteria}
                    onChangeText={setSuccessCriteria}
                    multiline
                    placeholder="Leave blank and Enhance will suggest one"
                    placeholderTextColor={theme.textSecondary}
                    style={[
                      memoryStyles.input,
                      {
                        color: theme.text,
                        borderColor: theme.border,
                        backgroundColor: theme.backgroundElement,
                      },
                    ]}
                  />
                  <ThemedText type="small" themeColor="textSecondary">
                    Bimi keeps working the chat until this is true, then stops on its own.
                  </ThemedText>

                  <Text style={[memoryStyles.label, { color: theme.textSecondary }]}>
                    If they go quiet, nudge every (hours)
                  </Text>
                  <TextInput
                    value={nudgeHours}
                    onChangeText={setNudgeHours}
                    keyboardType="number-pad"
                    placeholder="24"
                    placeholderTextColor={theme.textSecondary}
                    style={[
                      memoryStyles.input,
                      {
                        minHeight: 46,
                        color: theme.text,
                        borderColor: theme.border,
                        backgroundColor: theme.backgroundElement,
                      },
                    ]}
                  />
                  <ThemedText type="small" themeColor="textSecondary">
                    Waits longer after each unanswered nudge. Stops after {STALL_CAP} ignored
                    nudges, {GOAL_MAX_TURNS} messages in total, or two weeks — whichever comes
                    first.
                  </ThemedText>
                </>
              ) : recurrence === 'interval' ? (
                <>
                  <Text style={[memoryStyles.label, { color: theme.textSecondary }]}>
                    Interval hours
                  </Text>
                  <TextInput
                    value={intervalHours}
                    onChangeText={setIntervalHours}
                    keyboardType="number-pad"
                    placeholder="5"
                    placeholderTextColor={theme.textSecondary}
                    style={[
                      memoryStyles.input,
                      {
                        minHeight: 46,
                        color: theme.text,
                        borderColor: theme.border,
                        backgroundColor: theme.backgroundElement,
                      },
                    ]}
                  />
                </>
              ) : (
                <>
                  <Text style={[memoryStyles.label, { color: theme.textSecondary }]}>Time</Text>
                  <TextInput
                    value={preferredTime}
                    onChangeText={setPreferredTime}
                    placeholder="09:00"
                    placeholderTextColor={theme.textSecondary}
                    style={[
                      memoryStyles.input,
                      {
                        minHeight: 46,
                        color: theme.text,
                        borderColor: theme.border,
                        backgroundColor: theme.backgroundElement,
                      },
                    ]}
                  />
                </>
              )}

              <Text style={[memoryStyles.label, { color: theme.textSecondary }]}>
                When it has something to say
              </Text>
              <View style={memoryStyles.typeGrid}>
                {GOAL_MODE_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.value}
                    onPress={() => setMode(opt.value)}
                    style={[
                      memoryStyles.typeChip,
                      {
                        borderColor: theme.border,
                        backgroundColor: theme.backgroundElement,
                      },
                      mode === opt.value && {
                        backgroundColor: theme.primary,
                        borderColor: theme.primary,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: mode === opt.value ? theme.primaryText : theme.text,
                        fontSize: 13,
                        fontWeight: '600',
                      }}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {GOAL_MODE_OPTIONS.find((o) => o.value === mode)?.hint}
              </ThemedText>

              <View style={memoryStyles.actions}>
                <Pressable
                  onPress={onClose}
                  style={[memoryStyles.bigBtn, { borderColor: theme.border }]}
                >
                  <Text style={{ color: theme.text, fontWeight: '600' }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={onSave}
                  disabled={busy}
                  style={[
                    memoryStyles.bigBtn,
                    { backgroundColor: theme.primary, borderWidth: 0 },
                    busy && { opacity: 0.5 },
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator color={theme.primaryText} size="small" />
                  ) : (
                    <Text style={{ color: theme.primaryText, fontWeight: '700' }}>Save goal</Text>
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

function AddContactMemoryModal({
  visible,
  contactId,
  contactName,
  onClose,
}: {
  visible: boolean;
  contactId: Id<'contacts'>;
  contactName?: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const create = useMutation(api.memories.create);
  const contact = useQuery(api.contacts.getContact, { contactId });
  const [type, setType] = useState<
    'fact' | 'preference' | 'commitment' | 'ongoing' | 'relationship'
  >('fact');
  const [content, setContent] = useState('');
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSave = async () => {
    if (busy) return;
    const c = content.trim();
    if (c.length === 0) {
      Alert.alert('Write a short fact about this contact.');
      return;
    }
    if (!contact?.instance) {
      Alert.alert('Contact has no instance');
      return;
    }
    setBusy(true);
    try {
      await create({
        instance: contact.instance,
        scope: 'contact',
        contactId,
        type,
        content: c,
        pinned,
      });
      onClose();
    } catch (err) {
      Alert.alert('Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingContainer style={{ flex: 1 }}>
        <Pressable style={memoryStyles.backdrop} onPress={onClose}>
          <Pressable
            style={[
              memoryStyles.sheet,
              { backgroundColor: theme.background, borderColor: theme.border },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={memoryStyles.grabber} />
            <ThemedText type="smallBold">Add fact about {contactName ?? 'contact'}</ThemedText>

            <Text style={[memoryStyles.label, { color: theme.textSecondary }]}>Type</Text>
            <View style={memoryStyles.typeGrid}>
              {MEMORY_TYPES.map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setType(t)}
                  style={[
                    memoryStyles.typeChip,
                    {
                      borderColor: theme.border,
                      backgroundColor: theme.backgroundElement,
                    },
                    type === t && {
                      backgroundColor: theme.primary,
                      borderColor: theme.primary,
                    },
                  ]}
                >
                  <View
                    style={[
                      memoryStyles.typeDot,
                      {
                        backgroundColor: type === t ? theme.primaryText : MEMORY_TYPE_COLOR[t],
                      },
                    ]}
                  />
                  <Text
                    style={{
                      color: type === t ? theme.primaryText : theme.text,
                      fontSize: 13,
                      fontWeight: '600',
                    }}
                  >
                    {t}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={[memoryStyles.label, { color: theme.textSecondary }]}>Fact</Text>
            <TextInput
              value={content}
              onChangeText={setContent}
              placeholder={`e.g. "${
                contactName ?? 'They'
              } prefers concise messages, works at Wartech on the backend."`}
              placeholderTextColor={theme.textSecondary}
              multiline
              autoFocus
              style={[
                memoryStyles.input,
                {
                  color: theme.text,
                  borderColor: theme.border,
                  backgroundColor: theme.backgroundElement,
                },
              ]}
            />

            <Pressable
              onPress={() => setPinned((p) => !p)}
              style={[
                memoryStyles.pinToggle,
                { borderColor: theme.border },
                pinned && {
                  backgroundColor: theme.backgroundSelected,
                  borderColor: theme.primary,
                },
              ]}
            >
              <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>
                {pinned ? '📌 Pinned — loaded every turn' : '📍 Pin to load every turn'}
              </Text>
            </Pressable>

            <View style={memoryStyles.actions}>
              <Pressable
                onPress={onClose}
                style={[memoryStyles.bigBtn, { borderColor: theme.border }]}
              >
                <Text style={{ color: theme.text, fontWeight: '600' }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={onSave}
                disabled={busy}
                style={[
                  memoryStyles.bigBtn,
                  { backgroundColor: theme.primary, borderWidth: 0 },
                  busy && { opacity: 0.5 },
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={theme.primaryText} size="small" />
                ) : (
                  <Text style={{ color: theme.primaryText, fontWeight: '700' }}>Save</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingContainer>
    </Modal>
  );
}

const memoryStyles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  profileBox: {
    marginTop: 12,
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profileLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  profileText: {
    fontSize: 13,
    lineHeight: 18,
  },
  goalRow: {
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
  },
  goalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  goalActions: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 8,
  },
  row: {
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 6,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  typePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  typePillText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  confLabel: { fontSize: 10, fontWeight: '600' },
  body: { fontSize: 14, lineHeight: 19 },
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
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: '90%',
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(120,120,120,0.4)',
    marginBottom: 12,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 12,
    marginBottom: 6,
  },
  // Keeps the Enhance control on the field's own label line, so it reads as
  // belonging to that field rather than to the form.
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  enhanceBtn: {
    minWidth: 84,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  typeDot: { width: 8, height: 8, borderRadius: 4 },
  input: {
    minHeight: 100,
    maxHeight: 200,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: 'top',
  },
  pinToggle: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    alignItems: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  bigBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const settingsStyles = StyleSheet.create({
  fieldGroup: { gap: 8, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
  },
  cadenceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cadenceValue: {
    fontSize: 16,
    fontWeight: '700',
    minWidth: 30,
    textAlign: 'center',
  },
  cadenceHint: { fontSize: 12, flex: 1 },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  body: { padding: Spacing.four, gap: Spacing.four },
  identity: { alignItems: 'center', gap: Spacing.two },
  section: { padding: Spacing.three, borderRadius: 12, gap: Spacing.two },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  participantList: { gap: Spacing.two },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
});
