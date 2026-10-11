import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/chat/avatar';
import { useTheme } from '@/hooks/use-theme';

import type { Id } from '../../../convex/_generated/dataModel';

export type CitedRow = {
  messageId: Id<'messages'>;
  contactId: Id<'contacts'>;
  contactName?: string | null;
  preview: string;
};

type Props = {
  rows: CitedRow[];
  onOpen: (contactId: Id<'contacts'>) => void;
};

export function ToolResultCard({ rows, onOpen }: Props) {
  const theme = useTheme();
  if (rows.length === 0) return null;
  return (
    <View
      style={[
        styles.card,
        { borderColor: theme.border, backgroundColor: theme.backgroundElement },
      ]}>
      {rows.map((r) => (
        <Pressable
          key={r.messageId}
          onPress={() => onOpen(r.contactId)}
          style={({ pressed }) => [
            styles.row,
            { borderTopColor: theme.border },
            pressed && { opacity: 0.7 },
          ]}>
          <Avatar name={r.contactName ?? undefined} size={32} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
              {r.contactName ?? 'Unknown'}
            </Text>
            <Text
              style={[styles.preview, { color: theme.textSecondary }]}
              numberOfLines={2}>
              {r.preview}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    marginTop: 6,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  name: { fontSize: 13, fontWeight: '600' },
  preview: { fontSize: 12, marginTop: 2 },
});
