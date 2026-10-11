import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { initialsFor } from '@/lib/format';

type Props = {
  name?: string;
  size?: number;
  isGroup?: boolean;
  isAi?: boolean;
  /** WhatsApp profile picture, when one has been fetched for this contact. */
  imageUrl?: string;
  /**
   * Called when the picture fails to load, which usually means WhatsApp rotated
   * the signed URL. The backend re-fetches on this signal.
   */
  onImageError?: () => void;
};

function colorForName(name: string | undefined): string {
  const palette = ['#208AEF', '#0E9F88', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#10B981'];
  if (!name) return palette[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

export function Avatar({ name, size = 48, isGroup, isAi, imageUrl, onImageError }: Props) {
  const theme = useTheme();
  // A URL that just failed should fall back to initials for the rest of this
  // render, rather than leaving a blank circle until the refetch lands.
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    setFailed(false);
  }, [imageUrl]);

  const bg = isGroup ? theme.backgroundSelected : colorForName(name);
  const showImage = imageUrl !== undefined && !failed;

  return (
    <View
      style={[
        styles.root,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          borderWidth: isAi ? 2 : 0,
          borderColor: isAi ? theme.aiAccent : 'transparent',
        },
      ]}>
      {showImage ? (
        <Image
          source={{ uri: imageUrl }}
          style={[styles.image, { width: size, height: size, borderRadius: size / 2 }]}
          contentFit="cover"
          // Keeps the picture on screen across list re-renders and app restarts,
          // so scrolling the chat list does not re-download every avatar.
          cachePolicy="memory-disk"
          transition={120}
          onError={() => {
            setFailed(true);
            onImageError?.();
          }}
        />
      ) : (
        <ThemedText
          style={{
            color: isGroup ? theme.text : '#FFFFFF',
            fontSize: size * 0.4,
            fontWeight: '600',
          }}>
          {isGroup ? '#' : initialsFor(name)}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  image: { position: 'absolute' },
});
