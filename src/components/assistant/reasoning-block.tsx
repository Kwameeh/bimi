import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Props = {
  reasoning: string;
  isStreaming?: boolean;
};

/** Last line of thinking, shown collapsed so the block gives an informative preview. */
function lastLine(reasoning: string): string {
  const parts = reasoning
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.startsWith('{') && !p.endsWith('}'));
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

export function ReasoningBlock({ reasoning, isStreaming }: Props) {
  const theme = useTheme();
  const [open, setOpen] = useState<boolean>(!!isStreaming);
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

  if (!reasoning || reasoning.trim().length === 0) return null;

  const toggle = () => {
    userDecided.current = true;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((o) => !o);
  };

  const peek = lastLine(reasoning);

  return (
    <View
      style={[
        styles.wrap,
        {
          borderColor: isStreaming ? `${theme.aiAccent}40` : theme.border,
          backgroundColor: theme.backgroundElement,
        },
      ]}
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
          <View
            style={[
              styles.iconSlot,
              {
                backgroundColor: isStreaming ? `${theme.aiAccent}1A` : `${theme.textSecondary}15`,
              },
            ]}
          >
            {isStreaming ? (
              <ActivityIndicator size="small" color={theme.aiAccent} />
            ) : (
              <AppIcon name="sparkles" tintColor={theme.aiAccent} size={14} />
            )}
          </View>
          <View style={styles.titleCol}>
            <Text
              style={[
                styles.headerLabel,
                { color: isStreaming ? theme.aiAccent : theme.textSecondary },
              ]}
            >
              {isStreaming ? 'Thinking…' : 'Thought for a moment'}
            </Text>
            {!open && peek.length > 0 ? (
              <Text style={[styles.peek, { color: theme.textSecondary }]} numberOfLines={1}>
                {peek}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.chevronWrap}>
          <AppIcon
            name={open ? 'chevronUp' : 'chevronDown'}
            tintColor={theme.textSecondary}
            size={14}
          />
        </View>
      </Pressable>

      {open ? (
        <View style={[styles.body, { borderTopColor: theme.border }]}>
          <View style={[styles.accentLine, { backgroundColor: `${theme.aiAccent}50` }]} />
          <Text style={[styles.bodyText, { color: theme.textSecondary }]}>{reasoning.trim()}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    marginBottom: 8,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  iconSlot: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  headerLabel: {
    fontSize: 12,
    fontFamily: Fonts.sansSemiBold,
    letterSpacing: -0.1,
  },
  peek: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: Fonts.sans,
  },
  chevronWrap: {
    paddingLeft: 4,
  },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
    gap: 12,
  },
  accentLine: {
    width: 2,
    borderRadius: 1,
    marginVertical: 2,
  },
  bodyText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: Fonts.sans,
  },
});
