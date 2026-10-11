import { useAction, useQuery } from 'convex/react';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import React, { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AppIcon } from '@/components/ui/app-icon';
import { useTheme } from '@/hooks/use-theme';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

type Props = {
  messageId: Id<'messages'>;
  durationSeconds?: number;
  transcript?: string;
  isOutgoing?: boolean;
};

function formatDuration(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return '0:00';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function VoiceMessage({ messageId, durationSeconds, transcript, isOutgoing }: Props) {
  const theme = useTheme();
  const mediaInfo = useQuery(api.media.getMediaUrl, { messageId });
  const ensureMediaFetched = useAction(api.media.ensureMediaFetched);

  useEffect(() => {
    if (mediaInfo && mediaInfo.url === null && mediaInfo.status !== 'failed') {
      void ensureMediaFetched({ messageId });
    }
  }, [mediaInfo, messageId, ensureMediaFetched]);

  const player = useAudioPlayer(mediaInfo?.url ? { uri: mediaInfo.url } : null);
  const status = useAudioPlayerStatus(player);

  const handleToggle = () => {
    if (!player) return;
    if (status.playing) {
      player.pause();
    } else {
      if (
        status.didJustFinish ||
        (status.duration && status.currentTime >= status.duration - 0.05)
      ) {
        player.seekTo(0);
      }
      player.play();
    }
  };

  const accent = isOutgoing ? 'rgba(255,255,255,0.95)' : theme.primary;
  const muted = isOutgoing ? 'rgba(255,255,255,0.75)' : theme.textSecondary;
  const isLoading = !mediaInfo?.url && mediaInfo?.status !== 'failed';
  const isFailed = mediaInfo?.status === 'failed';

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Pressable
          onPress={handleToggle}
          disabled={!mediaInfo?.url}
          style={[styles.playButton, { backgroundColor: accent }]}
        >
          {isLoading ? (
            <ActivityIndicator color={isOutgoing ? theme.bubbleSent : theme.background} />
          ) : (
            <AppIcon
              name={status.playing ? 'pause' : 'play'}
              tintColor={isOutgoing ? theme.bubbleSent : theme.primaryText}
              size={16}
            />
          )}
        </Pressable>
        <View style={styles.middle}>
          <View style={[styles.track, { backgroundColor: muted }]} />
          <Text style={[styles.duration, { color: muted }]}>
            {isFailed
              ? 'Unavailable'
              : status.playing && status.duration
                ? formatDuration(status.duration - status.currentTime)
                : formatDuration(durationSeconds ?? status.duration)}
          </Text>
        </View>
      </View>
      {transcript ? (
        <ThemedText
          type="small"
          style={{
            color: isOutgoing ? 'rgba(255,255,255,0.85)' : theme.textSecondary,
          }}
        >
          {transcript}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, minWidth: 200 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: { flex: 1, gap: 4 },
  track: { height: 3, borderRadius: 2, opacity: 0.6 },
  duration: { fontSize: 11 },
});
