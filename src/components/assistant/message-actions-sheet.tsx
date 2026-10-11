import React from 'react';
import { Modal, Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export type MessageAction =
  | { kind: 'copy' }
  | { kind: 'regenerate' }
  | { kind: 'retry' }
  | { kind: 'edit' };

type Props = {
  visible: boolean;
  role: 'user' | 'assistant';
  onSelect: (action: MessageAction) => void;
  onClose: () => void;
};

export function MessageActionsSheet({ visible, role, onSelect, onClose }: Props) {
  const theme = useTheme();

  const items: { label: string; sub?: string; action: MessageAction }[] =
    role === 'assistant'
      ? [
          { label: 'Copy', sub: 'Copy this answer to clipboard', action: { kind: 'copy' } },
          {
            label: 'Regenerate',
            sub: 'Re-answer the most recent question',
            action: { kind: 'regenerate' },
          },
          {
            label: 'Retry from here',
            sub: 'Discard everything after this and try again',
            action: { kind: 'retry' },
          },
        ]
      : [
          { label: 'Copy', sub: 'Copy this message to clipboard', action: { kind: 'copy' } },
          {
            label: 'Edit & resend',
            sub: 'Change this message — the assistant re-answers',
            action: { kind: 'edit' },
          },
        ];

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          {items.map((it) => (
            <Pressable
              key={it.label}
              onPress={() => {
                onSelect(it.action);
                onClose();
              }}
              style={({ pressed }) => [
                styles.row,
                { borderBottomColor: theme.border },
                pressed && { opacity: 0.6 },
              ]}
            >
              <Text style={[styles.label, { color: theme.text }]}>{it.label}</Text>
              {it.sub ? (
                <Text style={[styles.sub, { color: theme.textSecondary }]}>{it.sub}</Text>
              ) : null}
            </Pressable>
          ))}
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.cancel,
              { backgroundColor: theme.backgroundElement },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={{ color: theme.text, fontWeight: '600' }}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 28,
  },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: 15, fontWeight: '600' },
  sub: { fontSize: 12, marginTop: 2 },
  cancel: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
  },
});
