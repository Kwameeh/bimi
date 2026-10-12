import { useAction, useQuery } from 'convex/react';
import { Image } from 'expo-image';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { Fonts } from '@/constants/theme';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

export default function MediaViewerScreen() {
  const { messageId } = useLocalSearchParams<{ messageId: string }>();
  const router = useRouter();

  const validId = messageId ? (messageId as Id<'messages'>) : null;
  const message = useQuery(api.messages.getMessage, validId ? { messageId: validId } : 'skip');
  const mediaInfo = useQuery(api.media.getMediaUrl, validId ? { messageId: validId } : 'skip');
  const ensureMediaFetched = useAction(api.media.ensureMediaFetched);

  useEffect(() => {
    if (validId && mediaInfo && mediaInfo.url === null && mediaInfo.status !== 'failed') {
      void ensureMediaFetched({ messageId: validId });
    }
  }, [validId, mediaInfo, ensureMediaFetched]);

  if (!validId || message === undefined || mediaInfo === undefined) {
    return (
      <Backdrop onClose={() => router.back()}>
        <ActivityIndicator color="#FFFFFF" />
      </Backdrop>
    );
  }

  if (message === null || mediaInfo === null) {
    return (
      <Backdrop onClose={() => router.back()}>
        <Text style={styles.light}>Message not found.</Text>
      </Backdrop>
    );
  }

  if (mediaInfo.status === 'failed') {
    return (
      <Backdrop onClose={() => router.back()}>
        <View style={styles.card}>
          <Text style={styles.lightTitle}>Media unavailable</Text>
          <Text style={styles.light}>The file could not be downloaded.</Text>
        </View>
      </Backdrop>
    );
  }

  switch (message.messageType) {
    case 'imageMessage':
      return (
        <Backdrop onClose={() => router.back()}>
          {mediaInfo.url ? (
            <Image source={{ uri: mediaInfo.url }} style={styles.fullImage} contentFit="contain" />
          ) : (
            <ActivityIndicator color="#FFFFFF" />
          )}
        </Backdrop>
      );

    case 'audioMessage':
      return (
        <Backdrop onClose={() => router.back()}>
          <View style={styles.audioCard}>
            <Text style={styles.lightTitle}>Voice note</Text>
            <AudioPanel url={mediaInfo.url} />
            {message.text ? (
              <ScrollView style={styles.transcriptScroll}>
                <Text style={styles.light}>{message.text.replace(/^\[Voice note\]\s*/, '')}</Text>
              </ScrollView>
            ) : null}
          </View>
        </Backdrop>
      );

    case 'documentMessage':
      return (
        <Backdrop onClose={() => router.back()}>
          <View style={styles.docCard}>
            <Text style={styles.lightTitle}>{message.mediaFileName ?? 'Document'}</Text>
            {message.mediaPageCount ? (
              <Text style={styles.lightSubtle}>
                {message.mediaPageCount} {message.mediaPageCount === 1 ? 'page' : 'pages'}
              </Text>
            ) : null}
            <ScrollView style={styles.summaryScroll}>
              <Text style={styles.light}>{message.text}</Text>
            </ScrollView>
            {mediaInfo.url ? (
              <Pressable
                onPress={() => WebBrowser.openBrowserAsync(mediaInfo.url!)}
                style={({ pressed }) => [styles.openButton, pressed && { opacity: 0.85 }]}
              >
                <AppIcon name="external" tintColor="#FFFFFF" size={18} />
                <Text style={styles.openButtonText}>Open document</Text>
              </Pressable>
            ) : (
              <ActivityIndicator color="#FFFFFF" />
            )}
          </View>
        </Backdrop>
      );

    default:
      return (
        <Backdrop onClose={() => router.back()}>
          <Text style={styles.light}>This media type cannot be previewed.</Text>
        </Backdrop>
      );
  }
}

function AudioPanel({ url }: { url: string | null }) {
  const player = useAudioPlayer(url ? { uri: url } : null);
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

  return (
    <View style={styles.audioPanel}>
      <Pressable
        onPress={handleToggle}
        disabled={!url}
        style={({ pressed }) => [styles.playButton, pressed && { opacity: 0.85 }]}
      >
        {!url ? (
          <ActivityIndicator color="#000000" />
        ) : (
          <AppIcon name={status.playing ? 'pause' : 'play'} tintColor="#000000" size={24} />
        )}
      </Pressable>
      <Text style={styles.lightSubtle}>
        {status.duration ? formatSeconds(status.currentTime) : '0:00'} /{' '}
        {status.duration ? formatSeconds(status.duration) : '0:00'}
      </Text>
    </View>
  );
}

function formatSeconds(s: number): string {
  if (!Number.isFinite(s)) return '0:00';
  const total = Math.round(s);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close media"
        onPress={onClose}
        hitSlop={12}
        style={styles.closeBtn}
      >
        <AppIcon name="close" tintColor="#FFFFFF" size={22} />
      </Pressable>
      <View onStartShouldSetResponder={() => true}>{children}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  closeBtn: {
    position: 'absolute',
    top: 48,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  fullImage: { width: '100%', height: '100%' },
  card: { gap: 8, alignItems: 'center' },
  audioCard: {
    gap: 16,
    padding: 20,
    width: '100%',
    maxWidth: 420,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
  },
  audioPanel: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  transcriptScroll: { maxHeight: 240 },
  docCard: {
    gap: 12,
    padding: 20,
    width: '100%',
    maxWidth: 480,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
  },
  summaryScroll: { maxHeight: 320 },
  openButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#208AEF',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  openButtonText: { color: '#FFFFFF', fontFamily: Fonts.sansBold, fontSize: 15 },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightTitle: { color: '#FFFFFF', fontSize: 18, fontFamily: Fonts.sansBold },
  lightSubtle: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontFamily: Fonts.sans },
  light: { color: '#FFFFFF', fontSize: 14, lineHeight: 20, fontFamily: Fonts.sans },
});
