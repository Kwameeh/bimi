import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AppIcon } from '@/components/ui/app-icon';
import { useTheme } from '@/hooks/use-theme';

import type { Id } from '../../../convex/_generated/dataModel';

type Props = {
  messageId: Id<'messages'>;
  fileName?: string;
  pageCount?: number;
  text: string;
  isOutgoing?: boolean;
};

function parseSummary(rawText: string): {
  header: string | null;
  body: string;
} {
  const trimmed = rawText.trim();
  const match = trimmed.match(/^\[(.*?)\]\s*\n([\s\S]+)$/);
  if (match) return { header: match[1], body: match[2].trim() };
  return { header: null, body: trimmed };
}

export function DocumentMessage({ messageId, fileName, pageCount, text, isOutgoing }: Props) {
  const theme = useTheme();
  const router = useRouter();
  const { header, body } = parseSummary(text);
  const titleColor = isOutgoing ? theme.bubbleSentText : theme.bubbleReceivedText;
  const subColor = isOutgoing ? 'rgba(255,255,255,0.8)' : theme.textSecondary;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/media/[messageId]', params: { messageId } })}
      style={({ pressed }) => [styles.wrap, pressed && { opacity: 0.85 }]}
    >
      <View
        style={[
          styles.headerRow,
          {
            backgroundColor: isOutgoing ? 'rgba(255,255,255,0.18)' : theme.backgroundSelected,
          },
        ]}
      >
        <AppIcon name="document" tintColor={titleColor} size={20} />
        <View style={{ flex: 1 }}>
          <ThemedText type="smallBold" style={{ color: titleColor }} numberOfLines={1}>
            {fileName ?? 'Document'}
          </ThemedText>
          {pageCount ? (
            <ThemedText type="small" style={{ color: subColor }}>
              {pageCount} {pageCount === 1 ? 'page' : 'pages'}
            </ThemedText>
          ) : header ? (
            <ThemedText type="small" style={{ color: subColor }}>
              {header}
            </ThemedText>
          ) : null}
        </View>
      </View>
      {body ? (
        <ThemedText type="small" style={{ color: titleColor }} numberOfLines={6}>
          {body}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, minWidth: 240, maxWidth: 280 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 10,
  },
});
