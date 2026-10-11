import { useAction, useQuery } from 'convex/react';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

type Props = {
  messageId: Id<'messages'>;
  caption?: string;
};

export function ImageMessage({ messageId, caption }: Props) {
  const theme = useTheme();
  const router = useRouter();
  const mediaInfo = useQuery(api.media.getMediaUrl, { messageId });
  const ensureMediaFetched = useAction(api.media.ensureMediaFetched);

  useEffect(() => {
    if (mediaInfo && mediaInfo.url === null && mediaInfo.status !== 'failed') {
      void ensureMediaFetched({ messageId });
    }
  }, [mediaInfo, messageId, ensureMediaFetched]);

  const handlePress = () => {
    router.push({
      pathname: '/media/[messageId]',
      params: { messageId },
    });
  };

  return (
    <Pressable onPress={handlePress} style={styles.container}>
      <View style={[styles.frame, { backgroundColor: theme.backgroundElement }]}>
        {mediaInfo?.url ? (
          <Image
            source={{ uri: mediaInfo.url }}
            style={styles.image}
            contentFit="cover"
            transition={150}
          />
        ) : mediaInfo?.status === 'failed' ? (
          <View style={styles.placeholder}>
            <ThemedText type="small" themeColor="textSecondary">
              Image unavailable
            </ThemedText>
          </View>
        ) : (
          <View style={styles.placeholder}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        )}
      </View>
      {caption ? (
        <ThemedText type="small" style={styles.caption}>
          {caption}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { gap: 4 },
  frame: { width: 220, height: 220, borderRadius: 12, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  caption: { marginTop: 4 },
});
