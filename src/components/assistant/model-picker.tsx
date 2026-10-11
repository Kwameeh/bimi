import React from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

import {
  ASSISTANT_MODELS,
  DEFAULT_ASSISTANT_MODEL_ID,
  type AssistantModelId,
} from '../../../convex/providers/models';

type Props = {
  visible: boolean;
  currentModelId: AssistantModelId | string | null | undefined;
  onSelect: (id: string) => void;
  onClose: () => void;
};

export function ModelPicker({ visible, currentModelId, onSelect, onClose }: Props) {
  const theme = useTheme();
  const catalog = useQuery(api.assistant.listModels);

  const active = (currentModelId as AssistantModelId | null | undefined) ?? catalog?.defaultModelId;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          <ThemedText type="smallBold" style={{ marginBottom: 8 }}>
            Model
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: 12 }}>
            Pick a configured provider and model for this conversation.
          </ThemedText>
          <ScrollView style={{ maxHeight: 380 }}>
            {catalog === undefined ? (
              <ThemedText type="small">Loading models…</ThemedText>
            ) : catalog.models.length === 0 ? (
              <ThemedText type="small">No AI providers are configured yet.</ThemedText>
            ) : null}
            {catalog?.models.map((m) => {
              const isActive = m.id === active;
              return (
                <Pressable
                  key={m.id}
                  onPress={() => {
                    onSelect(m.id);
                    onClose();
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      borderColor: theme.border,
                      backgroundColor: isActive ? theme.backgroundSelected : 'transparent',
                    },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.title, { color: theme.text }]}>{m.label}</Text>
                    <Text
                      style={[styles.subtitle, { color: theme.textSecondary }]}
                      numberOfLines={2}
                    >
                      {m.blurb}
                    </Text>
                  </View>
                  {isActive ? (
                    <Text style={{ color: theme.primary, fontWeight: '700' }}>✓</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function modelLabelFor(id: AssistantModelId | string | null | undefined): string {
  const resolved = (id ?? DEFAULT_ASSISTANT_MODEL_ID) as AssistantModelId;
  if (!id) return 'Default model';
  return ASSISTANT_MODELS.find((m) => m.id === resolved)?.label ?? id;
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
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 28,
    maxHeight: '80%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    marginVertical: 4,
  },
  title: { fontSize: 14, fontWeight: '600' },
  subtitle: { fontSize: 11, marginTop: 2 },
});
