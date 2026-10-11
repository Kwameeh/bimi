import React, { useEffect, useRef, useState } from 'react';
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { useTheme } from '@/hooks/use-theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Props = {
  reasoning: string;
  isStreaming?: boolean;
};

/** Last line of thinking, shown collapsed so the block says something useful. */
function lastLine(reasoning: string): string {
  const parts = reasoning
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

export function ReasoningBlock({ reasoning, isStreaming }: Props) {
  const theme = useTheme();
  const [open, setOpen] = useState<boolean>(!!isStreaming);
  // Once the reader opens or closes it themselves, the component stops
  // deciding for them. Without this the auto-collapse fired 600ms after every
  // manual open, so the block appeared to slam shut on its own.
  const userDecided = useRef(false);
  const wasStreaming = useRef(!!isStreaming);

  useEffect(() => {
    const streaming = !!isStreaming;
    if (streaming === wasStreaming.current) return;
    wasStreaming.current = streaming;
    if (userDecided.current) return;
    // Follow the run: unfold while it thinks, fold away once it's finished.
    setOpen(streaming);
  }, [isStreaming]);

  if (!reasoning || reasoning.length === 0) return null;

  const toggle = () => {
    userDecided.current = true;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((o) => !o);
  };

  const peek = lastLine(reasoning);

  return (
    <View
      style={[styles.wrap, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? 'Hide reasoning' : 'Show reasoning'}
        onPress={toggle}
        hitSlop={6}
        style={styles.header}
      >
        <View style={styles.headerLeft}>
          <Text style={[styles.headerLabel, { color: theme.textSecondary }]}>
            {isStreaming ? 'Thinking' : 'Thought for a moment'}
          </Text>
          {!open && peek.length > 0 ? (
            <Text style={[styles.peek, { color: theme.textSecondary }]} numberOfLines={1}>
              {peek}
            </Text>
          ) : null}
        </View>
        <AppIcon
          name={open ? 'chevronUp' : 'chevronDown'}
          tintColor={theme.textSecondary}
          size={16}
        />
      </Pressable>
      {open ? (
        <View style={[styles.body, { borderTopColor: theme.border }]}>
          <Text style={[styles.bodyText, { color: theme.textSecondary }]}>{reasoning}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    marginBottom: 8,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerLeft: { flex: 1, gap: 2 },
  headerLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  peek: { fontSize: 12, lineHeight: 16 },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
  },
  bodyText: {
    fontSize: 13,
    lineHeight: 19,
  },
});
