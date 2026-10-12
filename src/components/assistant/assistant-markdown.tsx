import React, { useEffect, useMemo, type ReactNode } from 'react';
import { Platform, Pressable, type TextStyle, Text, View } from 'react-native';
import Markdown, { Renderer, type MarkedStyles } from 'react-native-marked';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import type { Id } from '../../../convex/_generated/dataModel';

type Props = {
  text: string;
  variant: 'assistant' | 'user';
  isStreaming?: boolean;
  onOpenContact?: (id: Id<'contacts'>) => void;
  onOpenMessage?: (id: Id<'messages'>) => void;
};

/**
 * Custom Renderer that turns markdown links with `contact:` / `message:`
 * schemes into tappable chips. Falls back to default rendering for normal URLs.
 */
class CitationRenderer extends Renderer {
  constructor(
    private opts: {
      chipColor: string;
      chipBgColor: string;
      defaultLinkColor: string;
      onOpenContact?: (id: Id<'contacts'>) => void;
      onOpenMessage?: (id: Id<'messages'>) => void;
    },
  ) {
    super();
  }

  link(children: string | ReactNode[], href: string, styles?: TextStyle): ReactNode {
    if (href.startsWith('contact:')) {
      const id = href.slice('contact:'.length) as Id<'contacts'>;
      const label = Array.isArray(children) ? children : [children];
      return (
        <Pressable
          key={this.getKey()}
          onPress={() => this.opts.onOpenContact?.(id)}
          hitSlop={4}
          style={{
            backgroundColor: this.opts.chipBgColor,
            paddingHorizontal: 6,
            paddingVertical: 1,
            borderRadius: 6,
            alignSelf: 'flex-start',
          }}
        >
          <Text
            style={{
              color: this.opts.chipColor,
              fontWeight: '600',
              fontSize: 13,
            }}
          >
            @{label}
          </Text>
        </Pressable>
      );
    }
    if (href.startsWith('message:')) {
      const id = href.slice('message:'.length) as Id<'messages'>;
      const label = Array.isArray(children) ? children : [children];
      return (
        <Pressable
          key={this.getKey()}
          onPress={() => this.opts.onOpenMessage?.(id)}
          hitSlop={4}
          style={{
            backgroundColor: this.opts.chipBgColor,
            paddingHorizontal: 6,
            paddingVertical: 1,
            borderRadius: 6,
            alignSelf: 'flex-start',
          }}
        >
          <Text
            style={{
              color: this.opts.chipColor,
              fontWeight: '600',
              fontSize: 13,
            }}
          >
            {label}
          </Text>
        </Pressable>
      );
    }
    return super.link(children, href, {
      ...styles,
      color: this.opts.defaultLinkColor,
      textDecorationLine: 'underline',
    });
  }
}

export function AssistantMarkdown({
  text,
  variant,
  isStreaming,
  onOpenContact,
  onOpenMessage,
}: Props) {
  const theme = useTheme();

  const textColor = variant === 'user' ? theme.bubbleSentText : theme.bubbleReceivedText;
  const mutedColor = variant === 'user' ? theme.bubbleSentText : theme.textSecondary;

  const renderer = useMemo(
    () =>
      new CitationRenderer({
        chipColor: variant === 'user' ? theme.bubbleSentText : theme.primary,
        chipBgColor: variant === 'user' ? 'rgba(255,255,255,0.18)' : theme.backgroundElement,
        defaultLinkColor: variant === 'user' ? theme.bubbleSentText : theme.primary,
        onOpenContact,
        onOpenMessage,
      }),
    [variant, theme, onOpenContact, onOpenMessage],
  );

  const styles: MarkedStyles = useMemo(
    () => ({
      paragraph: {
        paddingVertical: 0,
        flexWrap: 'wrap',
        flexDirection: 'row',
        flexShrink: 1,
        maxWidth: '100%',
      },
      text: {
        color: textColor,
        fontSize: 15,
        lineHeight: 22,
        flexShrink: 1,
        ...(Platform.OS === 'web'
          ? ({ overflowWrap: 'anywhere', wordBreak: 'break-word' } as TextStyle)
          : null),
      },
      strong: { fontWeight: '700', color: textColor },
      em: { fontStyle: 'italic', color: textColor },
      link: {
        color: variant === 'user' ? theme.bubbleSentText : theme.primary,
        textDecorationLine: 'underline',
      },
      list: { paddingLeft: 0, marginVertical: 2 },
      li: { marginVertical: 1 },
      h1: {
        color: textColor,
        fontSize: 18,
        fontWeight: '700',
        marginVertical: 4,
      },
      h2: {
        color: textColor,
        fontSize: 16,
        fontWeight: '700',
        marginVertical: 4,
      },
      h3: {
        color: textColor,
        fontSize: 15,
        fontWeight: '700',
        marginVertical: 4,
      },
      h4: {
        color: textColor,
        fontSize: 14,
        fontWeight: '700',
        marginVertical: 4,
      },
      h5: {
        color: textColor,
        fontSize: 13,
        fontWeight: '700',
        marginVertical: 4,
      },
      h6: {
        color: textColor,
        fontSize: 12,
        fontWeight: '700',
        marginVertical: 4,
      },
      codespan: {
        color: textColor,
        backgroundColor: variant === 'user' ? 'rgba(255,255,255,0.18)' : theme.backgroundElement,
        fontFamily: Fonts.mono,
        fontSize: 13,
        paddingHorizontal: 4,
        borderRadius: 4,
      },
      code: {
        backgroundColor: variant === 'user' ? 'rgba(255,255,255,0.18)' : theme.backgroundElement,
        padding: 8,
        borderRadius: 6,
        marginVertical: 4,
        maxWidth: '100%',
        flexShrink: 1,
      },
      blockquote: {
        borderLeftWidth: 3,
        borderLeftColor: mutedColor,
        paddingLeft: 8,
        marginVertical: 4,
      },
      hr: {
        borderBottomWidth: 1,
        borderBottomColor: mutedColor,
        marginVertical: 6,
      },
      table: {
        borderColor: mutedColor,
        borderWidth: 1,
        marginVertical: 4,
        maxWidth: '100%',
        flexShrink: 1,
      },
      tableRow: { borderBottomWidth: 1, borderBottomColor: mutedColor },
      tableCell: { padding: 4 },
      image: { marginVertical: 4, borderRadius: 6 },
    }),
    [textColor, mutedColor, theme, variant],
  );

  return (
    <View style={{ width: '100%', minWidth: 0, maxWidth: '100%' }}>
      <Markdown
        value={text}
        renderer={renderer}
        flatListProps={{
          scrollEnabled: false,
          contentContainerStyle: { paddingVertical: 0 },
          style: { backgroundColor: 'transparent' },
        }}
        styles={styles}
      />
      {isStreaming ? <StreamingCaret color={mutedColor} /> : null}
    </View>
  );
}

/**
 * The "still typing" cursor. Drawn as a view rather than a text glyph: the
 * block characters that read well on iOS (U+258D and friends) are missing from
 * many Android system fonts and render as an empty box or a question mark.
 */
function StreamingCaret({ color }: { color: string }) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(withTiming(0.15, { duration: 480 }), withTiming(1, { duration: 480 })),
      -1,
      true,
    );
  }, [opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        {
          width: 7,
          height: 15,
          borderRadius: 2,
          marginTop: 3,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}
