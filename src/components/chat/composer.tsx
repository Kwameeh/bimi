import React, { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { AppIcon } from '@/components/ui/app-icon';

type Props = {
  onSend: (text: string) => Promise<void> | void;
  placeholder?: string;
};

export function Composer({ onSend, placeholder = 'Message' }: Props) {
  const theme = useTheme();
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    const trimmed = value.trim();
    if (trimmed.length === 0 || sending) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setValue('');
    } finally {
      setSending(false);
    }
  };

  const canSend = value.trim().length > 0 && !sending;

  return (
    <View
      style={[
        styles.container,
        { borderTopColor: theme.border, backgroundColor: theme.background },
      ]}
    >
      <View style={[styles.inputWrap, { backgroundColor: theme.backgroundElement }]}>
        <TextInput
          value={value}
          onChangeText={setValue}
          placeholder={placeholder}
          placeholderTextColor={theme.textSecondary}
          multiline
          style={[styles.input, { color: theme.text }]}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send message"
        onPress={handleSend}
        disabled={!canSend}
        style={({ pressed }) => [
          styles.sendButton,
          {
            backgroundColor: canSend ? theme.primary : theme.backgroundSelected,
          },
          pressed && canSend && { opacity: 0.85 },
        ]}
      >
        {sending ? (
          <ActivityIndicator color={theme.primaryText} />
        ) : (
          <AppIcon
            name="send"
            tintColor={canSend ? theme.primaryText : theme.textSecondary}
            size={20}
          />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inputWrap: {
    flex: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 10 : 4,
    minHeight: 44,
    maxHeight: 140,
    justifyContent: 'center',
  },
  input: {
    fontSize: 16,
    lineHeight: 20,
    paddingTop: Platform.OS === 'android' ? 6 : 0,
    paddingBottom: Platform.OS === 'android' ? 6 : 0,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
