import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type AttentionItem = {
  id: string;
  contactId: string;
  contactName: string;
  preview: string;
  type: 'urgent' | 'needsReply';
  onPress: () => void;
};

type Props = {
  items: AttentionItem[];
};

export function AttentionFeed({ items }: Props) {
  const theme = useTheme();

  if (items.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Needs Your Attention</Text>
        <View style={[styles.countBadge, { backgroundColor: `${theme.primary}1A` }]}>
          <Text style={[styles.countBadgeText, { color: theme.primary }]}>{items.length}</Text>
        </View>
      </View>

      <View style={styles.list}>
        {items.map((item) => {
          const isUrgent = item.type === 'urgent';
          const badgeColor = isUrgent ? theme.danger : theme.primary;
          const badgeBg = isUrgent ? `${theme.danger}15` : `${theme.primary}15`;
          const badgeLabel = isUrgent ? 'URGENT' : 'NEEDS REPLY';
          const initial = item.contactName.trim().slice(0, 1).toUpperCase() || '?';

          return (
            <Pressable
              key={`${item.type}-${item.id}`}
              onPress={item.onPress}
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: isUrgent ? `${theme.danger}40` : theme.border,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <View style={styles.cardHeader}>
                <View style={styles.senderGroup}>
                  <View style={[styles.avatar, { backgroundColor: badgeBg }]}>
                    <Text style={[styles.avatarText, { color: badgeColor }]}>{initial}</Text>
                  </View>
                  <Text numberOfLines={1} style={[styles.senderName, { color: theme.text }]}>
                    {item.contactName}
                  </Text>
                </View>

                <View style={[styles.typeBadge, { backgroundColor: badgeBg }]}>
                  <Text style={[styles.typeBadgeText, { color: badgeColor }]}>{badgeLabel}</Text>
                </View>
              </View>

              <Text numberOfLines={3} style={[styles.previewText, { color: theme.textSecondary }]}>
                {item.preview}
              </Text>

              <View style={styles.cardFooter}>
                <View style={styles.footerAction}>
                  <Text style={[styles.actionLabel, { color: theme.primary }]}>Open chat</Text>
                  <Text style={[styles.actionArrow, { color: theme.primary }]}>›</Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: Fonts.sansBold,
    letterSpacing: -0.2,
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  countBadgeText: {
    fontSize: 11,
    fontFamily: Fonts.sansBold,
  },
  list: {
    gap: 10,
  },
  card: {
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  senderGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 13,
    fontFamily: Fonts.sansBold,
  },
  senderName: {
    fontSize: 14,
    fontFamily: Fonts.sansBold,
    flex: 1,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  typeBadgeText: {
    fontSize: 10,
    fontFamily: Fonts.sansBold,
    letterSpacing: 0.5,
  },
  previewText: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Fonts.sans,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: 2,
  },
  footerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionLabel: {
    fontSize: 12,
    fontFamily: Fonts.sansSemiBold,
  },
  actionArrow: {
    fontSize: 15,
    fontFamily: Fonts.sansBold,
  },
});
