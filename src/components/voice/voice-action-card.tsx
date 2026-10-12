import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';

import { AppIcon, type AppIconName } from '@/components/ui/app-icon';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Doc } from '../../../convex/_generated/dataModel';

type Props = {
  row: Doc<'assistantMessages'>;
  onApprove: () => Promise<void>;
  onDeny: () => Promise<void>;
  onSelectChoice?: (choice: string) => Promise<void>;
};

function formatActionTitle(
  toolName: string,
  args: Record<string, unknown>,
): { title: string; icon: AppIconName } {
  const contact = typeof args.contactName === 'string' ? args.contactName : 'Contact';
  switch (toolName) {
    case 'sendWhatsappMessage':
      return { title: `Send WhatsApp to ${contact}`, icon: 'send' };
    case 'draftReply':
      return { title: `Save Draft for ${contact}`, icon: 'compose' };
    case 'createTask':
      return { title: 'Create Task', icon: 'checklist' };
    case 'markTaskDone':
      return { title: 'Mark Task Done', icon: 'check' };
    case 'deleteTask':
      return { title: 'Delete Task', icon: 'close' };
    case 'createReminder':
      return { title: 'Set Reminder', icon: 'sparkles' };
    case 'dismissReminder':
      return { title: 'Dismiss Reminder', icon: 'close' };
    case 'acceptMeeting':
      return { title: 'Accept Meeting', icon: 'check' };
    case 'declineMeeting':
      return { title: 'Decline Meeting', icon: 'close' };
    case 'rememberThis':
      return { title: `Save Memory for ${contact}`, icon: 'knowledge' };
    case 'saveKnowledge':
      return { title: 'Save to Knowledge Base', icon: 'knowledge' };
    default:
      return { title: 'Action Confirmation', icon: 'sparkles' };
  }
}

export function VoiceActionCard({ row, onApprove, onDeny, onSelectChoice }: Props) {
  const theme = useTheme();
  const [resolving, setResolving] = useState<'approve' | 'deny' | null>(null);

  const toolName = row.toolName ?? '';
  const args = (row.toolArgs ?? {}) as Record<string, unknown>;
  const { title, icon } = formatActionTitle(toolName, args);

  const handleApprove = async () => {
    if (resolving) return;
    setResolving('approve');
    try {
      await onApprove();
    } finally {
      setResolving(null);
    }
  };

  const handleDeny = async () => {
    if (resolving) return;
    setResolving('deny');
    try {
      await onDeny();
    } finally {
      setResolving(null);
    }
  };

  // Choice options if awaiting_choice
  const isChoice = row.status === 'awaiting_choice';
  const choiceOptions =
    isChoice && Array.isArray((args as { options?: string[] }).options)
      ? ((args as { options?: string[] }).options as string[])
      : [];
  const choiceQuestion = isChoice
    ? ((args as { question?: string }).question ?? 'Choose an option:')
    : null;

  return (
    <Animated.View
      entering={FadeInDown.duration(280)}
      exiting={FadeOutDown.duration(200)}
      style={[
        styles.card,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: '#F59E0B',
          shadowColor: '#F59E0B',
        },
      ]}
    >
      {/* Header status badge */}
      <View style={styles.headerRow}>
        <View style={styles.badge}>
          <AppIcon name={icon} tintColor="#D97706" size={14} />
          <Text style={styles.badgeText}>{isChoice ? 'CHOICE REQUIRED' : 'APPROVAL REQUIRED'}</Text>
        </View>
        <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      </View>

      {/* Preview Section */}
      {toolName === 'sendWhatsappMessage' || toolName === 'draftReply' ? (
        <View
          style={[
            styles.previewBubble,
            { backgroundColor: theme.background, borderColor: theme.border },
          ]}
        >
          <View style={styles.toRow}>
            <Text style={[styles.toLabel, { color: theme.textSecondary }]}>To:</Text>
            <Text style={[styles.toValue, { color: theme.text }]}>
              {typeof args.contactName === 'string' ? args.contactName : 'Contact'}
            </Text>
          </View>
          {typeof args.quotedPreview === 'string' && args.quotedPreview.length > 0 ? (
            <View
              style={[
                styles.quotedBox,
                { borderLeftColor: theme.primary, backgroundColor: theme.backgroundElement },
              ]}
            >
              <Text numberOfLines={2} style={[styles.quotedText, { color: theme.textSecondary }]}>
                {args.quotedPreview}
              </Text>
            </View>
          ) : null}
          <Text style={[styles.messageText, { color: theme.text }]}>
            {typeof args.text === 'string' ? args.text : ''}
          </Text>
        </View>
      ) : toolName === 'createTask' || toolName === 'deleteTask' ? (
        <View
          style={[styles.itemBox, { backgroundColor: theme.background, borderColor: theme.border }]}
        >
          <Text style={[styles.itemTitle, { color: theme.text }]}>
            {typeof args.title === 'string' ? args.title : 'Task'}
          </Text>
        </View>
      ) : toolName === 'createReminder' ? (
        <View
          style={[styles.itemBox, { backgroundColor: theme.background, borderColor: theme.border }]}
        >
          <Text style={[styles.itemTitle, { color: theme.text }]}>
            {typeof args.text === 'string' ? args.text : 'Reminder'}
          </Text>
        </View>
      ) : null}

      {/* Choice Options list if awaiting choice */}
      {isChoice && choiceOptions.length > 0 ? (
        <View style={styles.choicesWrap}>
          {choiceQuestion ? (
            <Text style={[styles.choiceQuestion, { color: theme.textSecondary }]}>
              {choiceQuestion}
            </Text>
          ) : null}
          <View style={styles.choiceChips}>
            {choiceOptions.map((opt, idx) => (
              <Pressable
                key={opt}
                onPress={() => onSelectChoice?.(opt)}
                accessibilityRole="button"
                accessibilityLabel={opt}
                style={[
                  styles.choiceChip,
                  { backgroundColor: theme.background, borderColor: theme.border },
                ]}
              >
                <Text style={[styles.choiceIndex, { color: theme.primary }]}>{idx + 1}.</Text>
                <Text style={[styles.choiceText, { color: theme.text }]}>{opt}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* Voice Prompt Hint */}
      <View style={[styles.hintPill, { backgroundColor: 'rgba(245, 158, 11, 0.12)' }]}>
        <AppIcon name="waveform" tintColor="#D97706" size={13} />
        <Text style={styles.hintText}>
          {isChoice
            ? 'Say option name, or tap to choose'
            : 'Say “Yes”, “Send it” or “Approve” • or tap below'}
        </Text>
      </View>

      {/* Actions */}
      {!isChoice ? (
        <View style={styles.actionsRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Deny action"
            onPress={handleDeny}
            disabled={resolving !== null}
            style={[
              styles.btn,
              styles.denyBtn,
              { borderColor: theme.border, backgroundColor: theme.background },
            ]}
          >
            {resolving === 'deny' ? (
              <ActivityIndicator size="small" color={theme.textSecondary} />
            ) : (
              <Text style={[styles.denyText, { color: theme.textSecondary }]}>Deny</Text>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Approve action"
            onPress={handleApprove}
            disabled={resolving !== null}
            style={[styles.btn, styles.approveBtn, { backgroundColor: theme.primary }]}
          >
            {resolving === 'approve' ? (
              <ActivityIndicator size="small" color={theme.primaryText} />
            ) : (
              <View style={styles.btnContent}>
                <AppIcon name="check" tintColor={theme.primaryText} size={16} />
                <Text style={[styles.approveText, { color: theme.primaryText }]}>
                  {toolName === 'sendWhatsappMessage' ? 'Send Message' : 'Approve'}
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1.5,
    borderRadius: 20,
    padding: 16,
    gap: 12,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
    marginHorizontal: 16,
  },
  headerRow: {
    gap: 4,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: Fonts.sansBold,
    color: '#D97706',
    letterSpacing: 0.8,
  },
  title: {
    fontSize: 17,
    fontFamily: Fonts.sansBold,
    marginTop: 2,
  },
  previewBubble: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 6,
  },
  toRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toLabel: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
  },
  toValue: {
    fontSize: 13,
    fontFamily: Fonts.sansSemiBold,
  },
  quotedBox: {
    borderLeftWidth: 3,
    paddingLeft: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  quotedText: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    lineHeight: 16,
  },
  messageText: {
    fontSize: 14,
    fontFamily: Fonts.sans,
    lineHeight: 20,
  },
  itemBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  itemTitle: {
    fontSize: 14,
    fontFamily: Fonts.sansSemiBold,
  },
  choicesWrap: {
    gap: 8,
  },
  choiceQuestion: {
    fontSize: 13,
    fontFamily: Fonts.sansMedium,
  },
  choiceChips: {
    gap: 8,
  },
  choiceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  choiceIndex: {
    fontSize: 13,
    fontFamily: Fonts.sansBold,
  },
  choiceText: {
    fontSize: 14,
    fontFamily: Fonts.sansMedium,
    flex: 1,
  },
  hintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  hintText: {
    fontSize: 12,
    fontFamily: Fonts.sansSemiBold,
    color: '#B45309',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
  },
  btn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  denyBtn: {
    borderWidth: 1,
  },
  denyText: {
    fontSize: 14,
    fontFamily: Fonts.sansSemiBold,
  },
  approveBtn: {
    shadowColor: '#208AEF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  approveText: {
    fontSize: 14,
    fontFamily: Fonts.sansBold,
  },
});
