import React from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AppIcon } from '@/components/ui/app-icon';
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
                  {isActive ? <AppIcon name="check" tintColor={theme.primary} size={18} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const KNOWN_LABELS: Record<string, string> = {
  'dahl/deepseek-ai/DeepSeek-V4-Flash-0731': 'DeepSeek V4 Flash',
  'dahl/zai-org/GLM-5.3-Flash': 'GLM 5.3 Flash',
  'dahl/MiniMaxAI/MiniMax-M2.7': 'MiniMax M2.7',
};

export function modelLabelFor(id: AssistantModelId | string | null | undefined): string {
  if (!id) return 'Default model';
  const resolved = id as AssistantModelId;
  const cf = ASSISTANT_MODELS.find((m) => m.id === resolved);
  if (cf) return cf.label;
  if (KNOWN_LABELS[id]) return KNOWN_LABELS[id];
  const parts = id.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : id;
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
