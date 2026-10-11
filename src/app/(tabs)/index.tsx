import { FlashList } from '@shopify/flash-list';
import { useAction, useMutation, useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatListRow } from '@/components/chat/chat-list-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AppIcon } from '@/components/ui/app-icon';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useInstance } from '@/lib/instance';

import { api } from '../../../convex/_generated/api';

function isUnresolvedGroupName(contact: {
  displayName?: string | null;
  groupSubject?: string | null;
  isGroup?: boolean | null;
  remoteJid: string;
}) {
  if (contact.isGroup !== true) return false;
  const name = (contact.groupSubject ?? contact.displayName ?? '').trim();
  if (name.length === 0) return true;
  if (name.toLowerCase() === contact.remoteJid.toLowerCase()) return true;
  return /^\d+(?:-\d+)?@g\.us$/i.test(name);
}

export default function ChatsTabScreen() {
  const theme = useTheme();
  const router = useRouter();
  const instance = useInstance();
  const chats = useQuery(api.contacts.listChats, instance ? { instance, limit: 100 } : 'skip');
  const refreshGroupInfo = useAction(api.contacts.refreshGroupInfo);
  const reportAvatarBroken = useMutation(api.contacts.reportAvatarBroken);
  const refreshAttempts = useRef(new Set<string>());
  // A broken avatar means WhatsApp rotated the signed URL. Report it once per
  // contact per session; the backend rate-limits and re-fetches a fresh one.
  const avatarReports = useRef(new Set<string>());

  useEffect(() => {
    if (!chats) return;

    const unresolvedGroups = chats
      .map((item) => item.contact)
      .filter(isUnresolvedGroupName)
      .slice(0, 5);

    for (const contact of unresolvedGroups) {
      if (refreshAttempts.current.has(contact._id)) continue;
      refreshAttempts.current.add(contact._id);
      void refreshGroupInfo({ contactId: contact._id }).catch((error) => {
        console.warn('Failed to refresh group info', error);
      });
    }
  }, [chats, refreshGroupInfo]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <ThemedText type="title">Chats</ThemedText>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Bimi Assistant"
              onPress={() => router.push('/(tabs)/assistant')}
              hitSlop={12}
              style={({ pressed }) => [
                styles.sparkleBtn,
                {
                  backgroundColor: theme.aiAccent,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={styles.sparkleText}>✦</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search chats"
              onPress={() => router.push('/search')}
              hitSlop={12}
              style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.6 }]}
            >
              <AppIcon name="search" tintColor={theme.text} size={22} />
            </Pressable>
          </View>
        </View>
        {chats === undefined ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.primary} />
          </View>
        ) : chats.length === 0 ? (
          <View style={styles.center}>
            <ThemedText type="smallBold">No chats yet</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Tap the button below to start one, or wait for a message.
            </ThemedText>
          </View>
        ) : (
          <FlashList
            contentInsetAdjustmentBehavior="automatic"
            data={chats}
            keyExtractor={(item) => item.contact._id}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: theme.border }]} />
            )}
            renderItem={({ item }) => (
              <ChatListRow
                displayName={item.contact.displayName ?? item.contact.remoteJid}
                isGroup={item.contact.isGroup}
                unreadCount={item.unreadCount}
                lastMessage={item.lastMessage}
                badges={item.badges}
                priority={item.priority}
                avatarUrl={item.contact.avatarUrl ?? undefined}
                onAvatarError={() => {
                  const id = item.contact._id;
                  if (avatarReports.current.has(id)) return;
                  avatarReports.current.add(id);
                  void reportAvatarBroken({ contactId: id }).catch((error) => {
                    console.warn('Failed to report broken avatar', error);
                  });
                }}
                onPress={() =>
                  router.push({
                    pathname: '/chat/[contactId]',
                    params: { contactId: item.contact._id },
                  })
                }
              />
            )}
          />
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start a new chat"
          onPress={() => router.push('/new-chat')}
          style={({ pressed }) => [
            styles.fab,
            { backgroundColor: theme.primary },
            pressed && { opacity: 0.88 },
          ]}
        >
          <AppIcon name="compose" tintColor={theme.primaryText} size={23} />
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
  },
  iconButton: { padding: 4 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sparkleBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkleText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 80 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 28,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 6,
  },
});
