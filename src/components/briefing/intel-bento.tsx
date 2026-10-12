import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type IntelDocument = {
  key: string;
  contactName: string;
  fileName?: string;
  onPress: () => void;
};

export type IntelAutoReply = {
  key: string;
  contactName: string;
  preview: string;
  onPress: () => void;
};

export type IntelFyi = {
  key: string;
  contactName: string;
  preview: string;
  onPress: () => void;
};

export type IntelTrend = {
  key: string;
  label: string;
  subtitle?: string;
  onPress?: () => void;
};

type Props = {
  documents: IntelDocument[];
  autoReplied: IntelAutoReply[];
  fyi: IntelFyi[];
  trends: IntelTrend[];
};

export function IntelBento({ documents, autoReplied, fyi, trends }: Props) {
  const theme = useTheme();
  const [showAiDetails, setShowAiDetails] = useState(false);

  const hasAny =
    documents.length > 0 || autoReplied.length > 0 || fyi.length > 0 || trends.length > 0;

  if (!hasAny) return null;

  const totalHandled = autoReplied.length + fyi.length;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Activity & Intelligence</Text>
      </View>

      {/* Documents */}
      {documents.length > 0 ? (
        <View style={styles.group}>
          <Text style={[styles.groupLabel, { color: theme.textSecondary }]}>
            DOCUMENTS RECEIVED ({documents.length})
          </Text>
          <View style={styles.docGrid}>
            {documents.map((doc) => (
              <Pressable
                key={doc.key}
                onPress={doc.onPress}
                style={({ pressed }) => [
                  styles.docCard,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <View style={[styles.docIconWrap, { backgroundColor: '#14B8A618' }]}>
                  <Text style={styles.docIcon}>📄</Text>
                </View>
                <View style={styles.docInfo}>
                  <Text numberOfLines={1} style={[styles.docTitle, { color: theme.text }]}>
                    {doc.fileName ?? 'Attachment'}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.docSender, { color: theme.textSecondary }]}
                  >
                    From {doc.contactName}
                  </Text>
                </View>
                <Text style={[styles.arrow, { color: theme.textSecondary }]}>›</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* Handled by AI Summary */}
      {totalHandled > 0 ? (
        <View
          style={[
            styles.aiCard,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
            },
          ]}
        >
          <Pressable onPress={() => setShowAiDetails((prev) => !prev)} style={styles.aiCardHeader}>
            <View style={styles.aiLeftGroup}>
              <View style={[styles.sparkleIcon, { backgroundColor: `${theme.aiAccent}1A` }]}>
                <Text style={[styles.sparkleText, { color: theme.aiAccent }]}>✦</Text>
              </View>
              <View>
                <Text style={[styles.aiTitle, { color: theme.text }]}>Handled by Bimi</Text>
                <Text style={[styles.aiSubtitle, { color: theme.textSecondary }]}>
                  {autoReplied.length > 0 ? `${autoReplied.length} auto-replied` : ''}
                  {autoReplied.length > 0 && fyi.length > 0 ? ' · ' : ''}
                  {fyi.length > 0 ? `${fyi.length} FYI updates logged` : ''}
                </Text>
              </View>
            </View>
            <Text style={[styles.chevron, { color: theme.textSecondary }]}>
              {showAiDetails ? '⌃' : '⌄'}
            </Text>
          </Pressable>

          {showAiDetails ? (
            <View style={styles.aiDetailsList}>
              {autoReplied.map((item) => (
                <Pressable key={`auto-${item.key}`} onPress={item.onPress} style={styles.aiItem}>
                  <View style={[styles.itemDot, { backgroundColor: '#22C55E' }]} />
                  <View style={styles.itemTextContainer}>
                    <Text style={[styles.itemContact, { color: theme.text }]}>
                      Auto-reply to {item.contactName}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[styles.itemPreview, { color: theme.textSecondary }]}
                    >
                      {item.preview}
                    </Text>
                  </View>
                  <Text style={[styles.arrow, { color: theme.textSecondary }]}>›</Text>
                </Pressable>
              ))}

              {fyi.map((item) => (
                <Pressable key={`fyi-${item.key}`} onPress={item.onPress} style={styles.aiItem}>
                  <View style={[styles.itemDot, { backgroundColor: '#64748B' }]} />
                  <View style={styles.itemTextContainer}>
                    <Text style={[styles.itemContact, { color: theme.text }]}>
                      FYI from {item.contactName}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[styles.itemPreview, { color: theme.textSecondary }]}
                    >
                      {item.preview}
                    </Text>
                  </View>
                  <Text style={[styles.arrow, { color: theme.textSecondary }]}>›</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Trends & Patterns */}
      {trends.length > 0 ? (
        <View style={styles.group}>
          <Text style={[styles.groupLabel, { color: theme.textSecondary }]}>
            NOTABLE TRENDS & PATTERNS
          </Text>
          <View style={styles.trendsRow}>
            {trends.map((t) => (
              <Pressable
                key={t.key}
                onPress={t.onPress}
                disabled={!t.onPress}
                style={({ pressed }) => [
                  styles.trendChip,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                    opacity: pressed && t.onPress ? 0.75 : 1,
                  },
                ]}
              >
                <Text style={styles.trendIcon}>⌁</Text>
                <View>
                  <Text style={[styles.trendTitle, { color: theme.text }]}>{t.label}</Text>
                  {t.subtitle ? (
                    <Text style={[styles.trendSubtitle, { color: theme.textSecondary }]}>
                      {t.subtitle}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 14,
    paddingTop: 4,
  },
  sectionHeader: {
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: Fonts.sansBold,
    letterSpacing: -0.2,
  },
  group: {
    gap: 8,
  },
  groupLabel: {
    fontSize: 11,
    fontFamily: Fonts.sansBold,
    letterSpacing: 0.6,
  },
  docGrid: {
    gap: 8,
  },
  docCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  docIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docIcon: {
    fontSize: 18,
  },
  docInfo: {
    flex: 1,
    gap: 2,
  },
  docTitle: {
    fontSize: 14,
    fontFamily: Fonts.sansSemiBold,
  },
  docSender: {
    fontSize: 12,
    fontFamily: Fonts.sans,
  },
  aiCard: {
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
  },
  aiCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  aiLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sparkleIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkleText: {
    fontSize: 16,
    fontFamily: Fonts.sansBold,
  },
  aiTitle: {
    fontSize: 14,
    fontFamily: Fonts.sansBold,
  },
  aiSubtitle: {
    fontSize: 12,
    fontFamily: Fonts.sans,
  },
  chevron: {
    fontSize: 16,
    fontFamily: Fonts.sansBold,
  },
  aiDetailsList: {
    paddingTop: 6,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(150, 150, 150, 0.2)',
  },
  aiItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  itemDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  itemTextContainer: {
    flex: 1,
    gap: 2,
  },
  itemContact: {
    fontSize: 13,
    fontFamily: Fonts.sansSemiBold,
  },
  itemPreview: {
    fontSize: 12,
    fontFamily: Fonts.sans,
  },
  trendsRow: {
    gap: 8,
  },
  trendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  trendIcon: {
    fontSize: 16,
    color: '#EC4899',
    fontWeight: '800',
  },
  trendTitle: {
    fontSize: 13,
    fontFamily: Fonts.sansSemiBold,
  },
  trendSubtitle: {
    fontSize: 11,
    fontFamily: Fonts.sans,
  },
  arrow: {
    fontSize: 16,
    fontFamily: Fonts.sansBold,
  },
});
