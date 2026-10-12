import { useQuery } from 'convex/react';
import React from 'react';
import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { formatMessageTime } from '@/lib/format';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

import { AiBadge } from './ai-badge';
import { DocumentMessage } from './document-message';
import { ImageMessage } from './image-message';
import { MeetingCard } from './meeting-card';
import { MessageStatusTicks } from './message-status-ticks';
import { VoiceMessage } from './voice-message';

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

const IMAGE_TYPE_BADGE: Record<ImageType, { label: string; bg: string; fg: string }> = {
  payment: { label: 'Payment', bg: '#FEF3C7', fg: '#92400E' },
  receipt: { label: 'Receipt', bg: '#DCFCE7', fg: '#166534' },
  flyer: { label: 'Flyer', bg: '#DBEAFE', fg: '#1E40AF' },
  server_error: { label: 'Server error', bg: '#FEE2E2', fg: '#B91C1C' },
  notice: { label: 'Notice', bg: '#EDE9FE', fg: '#5B21B6' },
  screenshot_text: { label: 'Screenshot', bg: '#F1F5F9', fg: '#475569' },
  other: { label: '', bg: '', fg: '' },
};

const IMAGE_TYPE_BADGE_DARK: Record<ImageType, { label: string; bg: string; fg: string }> = {
  payment: { label: 'Payment', bg: 'rgba(245, 158, 11, 0.22)', fg: '#FDE68A' },
  receipt: { label: 'Receipt', bg: 'rgba(16, 185, 129, 0.22)', fg: '#A7F3D0' },
  flyer: { label: 'Flyer', bg: 'rgba(59, 130, 246, 0.22)', fg: '#BAE6FD' },
  server_error: { label: 'Server error', bg: 'rgba(239, 68, 68, 0.22)', fg: '#FCA5A5' },
  notice: { label: 'Notice', bg: 'rgba(139, 92, 246, 0.22)', fg: '#DDD6FE' },
  screenshot_text: { label: 'Screenshot', bg: 'rgba(148, 163, 184, 0.22)', fg: '#E2E8F0' },
  other: { label: '', bg: '', fg: '' },
};

export type MessageBubbleProps = {
  messageId: Id<'messages'>;
  text: string;
  caption?: string;
  messageType: string;
  sender: Sender;
  timestamp?: number;
  deliveryStatus?: DeliveryStatus;
  showParticipant?: boolean;
  participantPushName?: string;
  mediaMimeType?: string;
  mediaFileName?: string;
  mediaSeconds?: number;
  mediaPageCount?: number;
  isImportant?: boolean;
  needsReply?: boolean;
  isUrgent?: boolean;
  imageType?: ImageType;
  onLongPress?: (messageId: Id<'messages'>) => void;
};

export function MessageBubble(props: MessageBubbleProps) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const isOutgoing = props.sender !== 'contact';
  const isAi = props.sender === 'ai';

  const meeting = useQuery(
    api.meetings.getForMessage,
    !isOutgoing ? { messageId: props.messageId } : 'skip',
  );

  const mediaContent = renderMediaContent(props, isOutgoing);
  const showText = mediaContent === null && props.text.length > 0;

  const handleLongPress = () => {
    props.onLongPress?.(props.messageId);
  };

  const flagText = isOutgoing ? 'rgba(255,255,255,0.85)' : theme.aiAccent;

  return (
    <View style={[styles.row, isOutgoing ? styles.rowRight : styles.rowLeft]}>
      <Pressable
        onLongPress={handleLongPress}
        delayLongPress={250}
        style={({ pressed }) => [
          styles.bubble,
          isOutgoing
            ? { backgroundColor: theme.bubbleSent, borderTopRightRadius: 4 }
            : { backgroundColor: theme.bubbleReceived, borderTopLeftRadius: 4 },
          isAi && {
            borderLeftWidth: 2,
            borderLeftColor: theme.aiAccent,
            paddingLeft: 10,
          },
          props.isImportant && {
            borderRightWidth: 2,
            borderRightColor: '#F59E0B',
          },
          pressed && { opacity: 0.85 },
        ]}
      >
        {props.showParticipant && props.participantPushName ? (
          <Text style={[styles.participant, { color: theme.aiAccent }]} numberOfLines={1}>
            {props.participantPushName}
          </Text>
        ) : null}
        {isAi ? (
          <View style={styles.aiBadgeRow}>
            <AiBadge />
          </View>
        ) : null}
        {props.isUrgent || props.needsReply || props.isImportant ? (
          <View style={styles.flagRow}>
            {props.isUrgent ? (
              <Text style={[styles.flagText, { color: flagText }]}>● Urgent</Text>
            ) : null}
            {props.needsReply ? (
              <Text style={[styles.flagText, { color: flagText }]}>↩ Needs reply</Text>
            ) : null}
            {props.isImportant ? (
              <Text style={[styles.flagText, { color: '#F59E0B' }]}>★ Important</Text>
            ) : null}
          </View>
        ) : null}
        {props.imageType && props.imageType !== 'other' ? (
          (() => {
            const badgeDef = (isDark ? IMAGE_TYPE_BADGE_DARK : IMAGE_TYPE_BADGE)[props.imageType];
            return (
              <View style={[styles.imageTypeBadge, { backgroundColor: badgeDef.bg }]}>
                <Text style={[styles.imageTypeText, { color: badgeDef.fg }]}>{badgeDef.label}</Text>
              </View>
            );
          })()
        ) : null}
        {mediaContent}
        {showText ? (
          <Text
            style={[
              styles.text,
              { color: isOutgoing ? theme.bubbleSentText : theme.bubbleReceivedText },
            ]}
          >
            {props.text}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          <Text
            style={[
              styles.timestamp,
              {
                color: isOutgoing ? 'rgba(255,255,255,0.75)' : theme.textSecondary,
              },
            ]}
          >
            {formatMessageTime(props.timestamp)}
          </Text>
          {isOutgoing ? <MessageStatusTicks status={props.deliveryStatus} /> : null}
        </View>
      </Pressable>
      {meeting ? <MeetingCard meeting={meeting} /> : null}
    </View>
  );
}

function renderMediaContent(
  props: MessageBubbleProps,
  isOutgoing: boolean,
): React.ReactNode | null {
  switch (props.messageType) {
    case 'imageMessage':
      return <ImageMessage messageId={props.messageId} caption={props.caption} />;
    case 'audioMessage':
      return (
        <VoiceMessage
          messageId={props.messageId}
          durationSeconds={props.mediaSeconds}
          transcript={props.text.replace(/^\[Voice note\]\s*/, '').trim()}
          isOutgoing={isOutgoing}
        />
      );
    case 'documentMessage':
      return (
        <DocumentMessage
          messageId={props.messageId}
          fileName={props.mediaFileName}
          pageCount={props.mediaPageCount}
          text={props.text}
          isOutgoing={isOutgoing}
        />
      );
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 12, marginVertical: 2 },
  rowLeft: { alignItems: 'flex-start' },
  rowRight: { alignItems: 'flex-end' },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    gap: 4,
  },
  text: { fontSize: 15, lineHeight: 20 },
  participant: { fontSize: 12, fontWeight: '600', marginBottom: 2 },
  aiBadgeRow: { marginBottom: 2 },
  flagRow: { flexDirection: 'row', gap: 8, marginBottom: 2, flexWrap: 'wrap' },
  flagText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  imageTypeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
  },
  imageTypeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-end',
    marginTop: 2,
  },
  timestamp: { fontSize: 11 },
});
