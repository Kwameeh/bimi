import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { formatChatTimestamp } from '@/lib/format';

import { Avatar } from './avatar';
import { ChatBadgeRow, type ChatBadges } from './chat-badges';
import { MessageStatusTicks } from './message-status-ticks';

type LastMessage = {
  text: string;
  fromMe: boolean;
  sentByAi: boolean;
  timestamp?: number;
  messageType: string;
  deliveryStatus?: 'pending' | 'sent' | 'delivered' | 'read' | 'played' | 'error';
  participant?: string;
  participantPushName?: string;
};

type Priority = 'urgent' | 'high' | 'normal' | 'low';

type Props = {
  displayName: string;
  isGroup?: boolean;
  unreadCount: number;
  lastMessage: LastMessage | null;
  badges?: ChatBadges;
  priority?: Priority;
  avatarUrl?: string;
  onAvatarError?: () => void;
  onPress: () => void;
};

const PRIORITY_DOT: Record<Priority, string | null> = {
  urgent: '#DC2626',
  high: '#F59E0B',
  normal: null,
  low: null,
};

function previewText(m: LastMessage): string {
  switch (m.messageType) {
    case 'imageMessage':
      return '📷 Photo';
    case 'audioMessage':
      return '🎤 Voice note';
    case 'documentMessage':
      return '📄 Document';
    case 'videoMessage':
      return '🎬 Video';
    case 'stickerMessage':
      return 'Sticker';
    default:
      return m.text;
  }
}

export function ChatListRow({
  displayName,
  isGroup,
  unreadCount,
  lastMessage,
  badges,
  priority = 'normal',
  avatarUrl,
  onAvatarError,
  onPress,
}: Props) {
  const theme = useTheme();
  const hasUnread = unreadCount > 0;
  const priorityDot = PRIORITY_DOT[priority];

  const preview = lastMessage ? previewText(lastMessage) : 'No messages yet';
  const participantPrefix =
    isGroup && lastMessage && !lastMessage.fromMe && lastMessage.participantPushName
      ? `${lastMessage.participantPushName}: `
      : '';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
      ]}>
      <Avatar
        name={displayName}
        isGroup={isGroup}
        size={52}
        imageUrl={avatarUrl}
        onImageError={onAvatarError}
      />
      <View style={styles.body}>
        <View style={styles.topLine}>
          {priorityDot ? (
            <View style={[styles.priorityDot, { backgroundColor: priorityDot }]} />
          ) : null}
          <ThemedText
            type={hasUnread ? 'smallBold' : 'small'}
            style={styles.name}
            numberOfLines={1}>
            {displayName}
          </ThemedText>
          <Text
            style={[
              styles.timestamp,
              { color: hasUnread ? theme.primary : theme.textSecondary },
            ]}>
            {formatChatTimestamp(lastMessage?.timestamp)}
          </Text>
        </View>
        <View style={styles.bottomLine}>
          {lastMessage?.fromMe ? (
            <View style={styles.statusInPreview}>
              <MessageStatusTicks status={lastMessage.deliveryStatus} size={12} />
            </View>
          ) : null}
          <Text
            numberOfLines={1}
            style={[
              styles.preview,
              { color: hasUnread ? theme.text : theme.textSecondary },
              hasUnread && { fontWeight: '500' },
            ]}>
            {participantPrefix}
            {preview}
          </Text>
          {hasUnread ? (
            <View style={[styles.badge, { backgroundColor: theme.unreadBadge }]}>
              <Text style={[styles.badgeText, { color: theme.unreadBadgeText }]}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </Text>
            </View>
          ) : null}
        </View>
        {badges ? <ChatBadgeRow badges={badges} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  body: { flex: 1, gap: 4 },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  name: { flex: 1 },
  timestamp: { fontSize: 12 },
  bottomLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  preview: { flex: 1, fontSize: 14 },
  statusInPreview: { flexDirection: 'row', alignItems: 'center' },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
});
