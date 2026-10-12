import { FlashList } from '@shopify/flash-list';
import { useAction, useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/chat/avatar';
import { ChatAssistantSheet } from '@/components/chat/chat-assistant-sheet';
import { Composer } from '@/components/chat/composer';
import { DateSeparator } from '@/components/chat/date-separator';
import { DraftsPill } from '@/components/chat/drafts-pill';
import { FollowupSnackbar } from '@/components/chat/followup-snackbar';
import { MessageActionSheet } from '@/components/chat/message-action-sheet';
import { MessageBubble } from '@/components/chat/message-bubble';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AppIcon } from '@/components/ui/app-icon';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { useTheme } from '@/hooks/use-theme';
import { formatDateSeparator } from '@/lib/format';
import { useInstance } from '@/lib/instance';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'played' | 'error';
type Sender = 'contact' | 'user' | 'ai';

type ImageType =
  | 'payment'
  | 'receipt'
  | 'flyer'
  | 'server_error'
  | 'notice'
  | 'screenshot_text'
  | 'other';

type FlatMessage = {
  _id: Id<'messages'>;
  text: string;
  caption?: string;
  sender: Sender;
  timestamp?: number;
  deliveryStatus?: DeliveryStatus;
  participantPushName?: string;
  messageType: string;
  mediaMimeType?: string;
  mediaFileName?: string;
  mediaSeconds?: number;
  mediaPageCount?: number;
  isImportant?: boolean;
  needsReply?: boolean;
  isUrgent?: boolean;
  imageType?: ImageType;
};

type Row =
  | { kind: 'msg'; key: string; msg: FlatMessage; showParticipant: boolean }
  | { kind: 'date'; key: string; label: string };

function isSameDay(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  const da = new Date(a > 1e12 ? a : a * 1000);
  const db = new Date(b > 1e12 ? b : b * 1000);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export default function ConversationScreen() {
  const { contactId } = useLocalSearchParams<{ contactId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const instance = useInstance();
  const [activeMessageId, setActiveMessageId] = useState<Id<'messages'> | null>(null);
  const [activeImportant, setActiveImportant] = useState(false);
  const [activeMessageType, setActiveMessageType] = useState<string | undefined>(undefined);
  const [assistantOpen, setAssistantOpen] = useState(false);

  const validContactId =
    contactId && contactId !== '__demo__' ? (contactId as Id<'contacts'>) : null;

  const contact = useQuery(
    api.contacts.getContact,
    validContactId ? { contactId: validContactId } : 'skip',
  );

  const messagesQuery = usePaginatedQuery(
    api.messages.listForContact,
    validContactId ? { contactId: validContactId } : 'skip',
    { initialNumItems: 30 },
  );

  const sendMessage = useAction(api.messages.send);
  const markRead = useMutation(api.contacts.markRead);

  useFocusEffect(
    useCallback(() => {
      if (validContactId) {
        void markRead({ contactId: validContactId });
      }
    }, [validContactId, markRead]),
  );

  const rows: Row[] = useMemo(() => {
    if (!messagesQuery.results) return [];
    const messages = messagesQuery.results;
    const result: Row[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const previous = messages[i + 1];
      const showParticipant =
        contact?.isGroup === true &&
        m.sender === 'contact' &&
        m.participantPushName !== undefined &&
        (!previous || previous.participantPushName !== m.participantPushName);
      result.push({
        kind: 'msg',
        key: `m:${m._id}`,
        msg: {
          _id: m._id as Id<'messages'>,
          text: m.text,
          caption: m.caption,
          sender: m.sender as Sender,
          timestamp: m.timestamp,
          deliveryStatus: m.deliveryStatus as DeliveryStatus | undefined,
          participantPushName: m.participantPushName,
          messageType: m.messageType,
          mediaMimeType: m.mediaMimeType,
          mediaFileName: m.mediaFileName,
          mediaSeconds: m.mediaSeconds,
          mediaPageCount: m.mediaPageCount,
          isImportant: m.isImportant,
          needsReply: m.needsReply,
          isUrgent: m.isUrgent,
          imageType: m.imageType,
        },
        showParticipant,
      });
      if (!previous || !isSameDay(previous.timestamp, m.timestamp)) {
        result.push({
          kind: 'date',
          key: `d:${m._id}`,
          label: formatDateSeparator(m.timestamp),
        });
      }
    }
    return result;
  }, [messagesQuery.results, contact?.isGroup]);
  const chronologicalRows = useMemo(() => [...rows].reverse(), [rows]);

  const handleSend = async (text: string) => {
    if (!validContactId) return;
    await sendMessage({ contactId: validContactId, text });
  };

  const handleLongPress = useCallback(
    (id: Id<'messages'>) => {
      const found = messagesQuery.results?.find((m) => m._id === id);
      setActiveImportant(found?.isImportant === true);
      setActiveMessageType(found?.messageType);
      setActiveMessageId(id);
    },
    [messagesQuery.results],
  );

  if (!validContactId) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safe}>
          <Header onBack={() => router.back()} title="Conversation" />
          <View style={styles.center}>
            <ThemedText type="smallBold">Demo route</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Tap a real chat to load a conversation.
            </ThemedText>
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingContainer style={styles.safe}>
        <SafeAreaView style={styles.safe}>
          <Header
            onBack={() => router.back()}
            title={contact?.displayName ?? '…'}
            subtitle={contact?.isGroup ? `${contact.groupSize ?? ''} members`.trim() : undefined}
            avatarName={contact?.displayName}
            avatarUrl={contact?.avatarUrl ?? undefined}
            isGroup={contact?.isGroup}
            rightSlot={
              <View style={styles.headerRight}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open Assistant copilot"
                  onPress={() => setAssistantOpen(true)}
                  hitSlop={10}
                  style={({ pressed }) => [
                    styles.sparkleBtn,
                    {
                      backgroundColor: theme.aiAccent,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <AppIcon name="sparkles" tintColor="#FFFFFF" size={17} />
                </Pressable>
                <DraftsPill instance={instance} contactId={validContactId} />
              </View>
            }
            onTapHeader={() =>
              router.push({
                pathname: '/contact/[contactId]',
                params: { contactId: validContactId },
              })
            }
          />
          {messagesQuery.results === undefined ? (
            <View style={styles.center}>
              <ActivityIndicator color={theme.primary} />
            </View>
          ) : rows.length === 0 ? (
            <View style={styles.center}>
              <ThemedText type="small" themeColor="textSecondary">
                No messages yet. Say hi.
              </ThemedText>
            </View>
          ) : (
            <FlashList
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              keyboardShouldPersistTaps="handled"
              data={chronologicalRows}
              keyExtractor={(item) => item.key}
              contentContainerStyle={styles.listContent}
              maintainVisibleContentPosition={{
                startRenderingFromBottom: true,
                autoscrollToBottomThreshold: 120,
              }}
              onStartReachedThreshold={0.4}
              onStartReached={() => {
                if (messagesQuery.status === 'CanLoadMore') {
                  messagesQuery.loadMore(30);
                }
              }}
              renderItem={({ item }) => {
                if (item.kind === 'date') {
                  return <DateSeparator label={item.label} />;
                }
                return (
                  <MessageBubble
                    messageId={item.msg._id}
                    text={item.msg.text}
                    caption={item.msg.caption}
                    messageType={item.msg.messageType}
                    sender={item.msg.sender}
                    timestamp={item.msg.timestamp}
                    deliveryStatus={item.msg.deliveryStatus}
                    showParticipant={item.showParticipant}
                    participantPushName={item.msg.participantPushName}
                    mediaMimeType={item.msg.mediaMimeType}
                    mediaFileName={item.msg.mediaFileName}
                    mediaSeconds={item.msg.mediaSeconds}
                    mediaPageCount={item.msg.mediaPageCount}
                    isImportant={item.msg.isImportant}
                    needsReply={item.msg.needsReply}
                    isUrgent={item.msg.isUrgent}
                    imageType={item.msg.imageType}
                    onLongPress={handleLongPress}
                  />
                );
              }}
            />
          )}
          <FollowupSnackbar contactId={validContactId} />
          <Composer onSend={handleSend} />
        </SafeAreaView>
      </KeyboardAvoidingContainer>
      <MessageActionSheet
        visible={activeMessageId !== null}
        messageId={activeMessageId}
        isImportant={activeImportant}
        messageType={activeMessageType}
        onClose={() => setActiveMessageId(null)}
      />
      <ChatAssistantSheet
        visible={assistantOpen}
        contactId={validContactId}
        isGroup={contact?.isGroup === true}
        onClose={() => setAssistantOpen(false)}
      />
    </ThemedView>
  );
}

function Header(props: {
  onBack: () => void;
  title: string;
  subtitle?: string;
  avatarName?: string;
  avatarUrl?: string;
  isGroup?: boolean;
  rightSlot?: React.ReactNode;
  onTapHeader?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.header, { borderBottomColor: theme.border }]}>
      <Pressable onPress={props.onBack} hitSlop={12} style={styles.backButton}>
        <AppIcon name="back" tintColor={theme.primary} size={22} />
      </Pressable>
      <Pressable
        onPress={props.onTapHeader}
        style={styles.headerCenter}
        disabled={!props.onTapHeader}
      >
        <Avatar
          name={props.avatarName}
          isGroup={props.isGroup}
          size={36}
          imageUrl={props.avatarUrl}
        />
        <View style={{ flex: 1 }}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {props.title}
          </ThemedText>
          {props.subtitle ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {props.subtitle}
            </ThemedText>
          ) : null}
        </View>
      </Pressable>
      {props.rightSlot ?? null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: {
    flex: 1,
    width: '100%',
    maxWidth: 960,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: { padding: 8 },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
    gap: 6,
    padding: 24,
  },
  listContent: { paddingVertical: 12 },
});
