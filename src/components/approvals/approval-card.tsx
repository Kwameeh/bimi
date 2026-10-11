import { useAction, useMutation } from 'convex/react';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Avatar } from '@/components/chat/avatar';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

import { api } from '../../../convex/_generated/api';
import type { Doc, Id } from '../../../convex/_generated/dataModel';

type QueueItem = {
  draft: Doc<'drafts'>;
  contactDisplayName: string | null;
  contactIsGroup: boolean;
  sourceMessageText: string | null;
  sourceMessageTimestamp: number | null;
};

type Variant = 'regenerate' | 'shorter' | 'professional' | 'friendly';

const VARIANT_LABELS: { key: Variant; label: string }[] = [
  { key: 'regenerate', label: 'Regenerate' },
  { key: 'shorter', label: 'Shorter' },
  { key: 'professional', label: 'Professional' },
  { key: 'friendly', label: 'Friendlier' },
];

const PRIORITY_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  urgent: { bg: '#FEE2E2', fg: '#B91C1C', label: 'Urgent' },
  high: { bg: '#FEF3C7', fg: '#92400E', label: 'High' },
  normal: { bg: '#E0E7FF', fg: '#3730A3', label: 'Normal' },
  low: { bg: '#E2E8F0', fg: '#475569', label: 'Low' },
};

function formatRelativeTime(ts: number | null): string {
  if (!ts) return '';
  const ms = ts > 1e12 ? ts : ts * 1000;
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function humanizeReason(reason: string | undefined): string {
  if (!reason) return 'No reason recorded';
  if (reason === 'manual_mode') return 'Manual mode — user approval required';
  if (reason === 'manual_request') return 'You asked for a draft';
  if (reason === 'meeting_confirmation') return 'Meeting — pending your confirmation';
  if (reason === 'meeting_counter') return 'Counter-proposal for a meeting';
  if (reason.startsWith('check_in:')) {
    const rel = reason.slice('check_in:'.length).replace('_', ' ');
    return `Check-in (${rel}) — you haven't spoken in a while`;
  }
  if (reason === 'silent_mode') return 'Silent mode';
  if (reason === 'contact_auto_block') return 'Auto-reply blocked for this contact';
  if (reason === 'group_chat_safety') return 'Group chat — safer to confirm';
  if (reason === 'low_confidence') return 'AI was unsure — needs confirmation';
  if (reason === 'long_message') return 'Long message — review recommended';
  if (reason === 'semi_auto_not_allowed') return "Not on this contact's allow-list";
  if (reason === 'action_request') return 'Looks like a request for action';
  if (reason === 'empty_text') return 'Empty source message';
  if (reason.startsWith('keyword:')) {
    return `Contains sensitive word "${reason.slice('keyword:'.length)}"`;
  }
  if (reason.startsWith('category_blocked:')) {
    return `Sensitive category: ${reason.slice('category_blocked:'.length).replace(/_/g, ' ')}`;
  }
  if (reason.startsWith('media_type:')) {
    return `Media (${reason.slice('media_type:'.length)}) — review needed`;
  }
  if (reason === 'quiet_hours') return 'Quiet hours — held for you to send';
  if (reason === 'agent_needs_human') return 'Needs something only you know';
  if (reason === 'agent_low_confidence') return 'Not sure enough to send it';
  if (reason === 'agent_suspicious') return 'Reply looked off — held for review';
  if (reason === 'draft_mode') return 'Goal is set to draft, not auto-send';
  if (reason === 'suspicious_auto_reply') return 'Reply looked off — held for review';
  if (reason === 'send_failed') return 'Sending failed — try again from here';
  // `goal:<goalId>:<title>` — drop the id, keep the title.
  if (reason.startsWith('goal:')) {
    const rest = reason.slice('goal:'.length);
    const sep = rest.indexOf(':');
    return `Goal: ${sep >= 0 ? rest.slice(sep + 1) : rest}`;
  }
  return reason;
}

/**
 * Goal drafts carry the gate that stopped them auto-sending in `style`, as
 * `contact_goal:<gateReason>`. Reuses the reason vocabulary above.
 */
function humanizeGoalGate(style: string | undefined): string | null {
  if (!style || !style.startsWith('contact_goal:')) return null;
  const gate = style.slice('contact_goal:'.length);
  if (gate === 'goal_auto') return null; // would have sent; nothing to explain
  return humanizeReason(gate);
}

export function ApprovalCard({ item }: { item: QueueItem }) {
  const theme = useTheme();
  const sendDraft = useAction(api.drafts.send);
  const updateText = useMutation(api.drafts.updateText);
  const ignoreDraft = useMutation(api.drafts.ignoreDraft);
  const rejectAndClear = useMutation(api.drafts.rejectAndClearNeedsReply);
  const regenerate = useAction(api.messageActions.regenerateDraft);

  const { draft } = item;
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(draft.text);
  const [busy, setBusy] = useState<string | null>(null);

  const draftId = draft._id as Id<'drafts'>;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      Alert.alert('Action failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const priorityKey = (draft.priority ?? 'normal') as keyof typeof PRIORITY_STYLE;
  const priorityStyle = PRIORITY_STYLE[priorityKey] ?? PRIORITY_STYLE.normal;
  const confidencePct =
    typeof draft.confidence === 'number' ? `${Math.round(draft.confidence * 100)}%` : '—';
  const goalGate = humanizeGoalGate(draft.style);

  return (
    <View
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
    >
      <View style={styles.headerRow}>
        <Avatar
          name={item.contactDisplayName ?? undefined}
          isGroup={item.contactIsGroup}
          size={36}
        />
        <View style={{ flex: 1 }}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {item.contactDisplayName ?? 'Unknown contact'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {formatRelativeTime(item.sourceMessageTimestamp)}
          </ThemedText>
        </View>
        <View style={[styles.priorityBadge, { backgroundColor: priorityStyle.bg }]}>
          <Text style={[styles.priorityText, { color: priorityStyle.fg }]}>
            {priorityStyle.label}
          </Text>
        </View>
      </View>

      {item.sourceMessageText ? (
        <View style={styles.block}>
          <Text style={[styles.blockLabel, { color: theme.textSecondary }]}>Original</Text>
          <Text style={[styles.bodyText, { color: theme.text }]} numberOfLines={4}>
            {item.sourceMessageText}
          </Text>
        </View>
      ) : null}

      {draft.aiSummary ? (
        <View style={styles.block}>
          <Text style={[styles.blockLabel, { color: theme.textSecondary }]}>Summary</Text>
          <Text style={[styles.bodyText, { color: theme.text }]}>{draft.aiSummary}</Text>
        </View>
      ) : null}

      <View style={styles.block}>
        <Text style={[styles.blockLabel, { color: theme.textSecondary }]}>Suggested reply</Text>
        {editing ? (
          <TextInput
            value={editText}
            onChangeText={setEditText}
            multiline
            style={[
              styles.input,
              {
                color: theme.text,
                borderColor: theme.border,
                backgroundColor: theme.background,
              },
            ]}
          />
        ) : (
          <Text style={[styles.bodyText, { color: theme.text }]}>{draft.text}</Text>
        )}
      </View>

      <View style={styles.metaRow}>
        <Text style={[styles.metaText, { color: theme.textSecondary }]}>
          Reason: {humanizeReason(draft.reason)}
        </Text>
        {goalGate ? (
          <Text style={[styles.metaText, { color: theme.textSecondary }]}>Held: {goalGate}</Text>
        ) : null}
        <Text style={[styles.metaText, { color: theme.textSecondary }]}>
          Confidence: {confidencePct}
        </Text>
      </View>

      {!editing ? (
        <View style={styles.variantRow}>
          {VARIANT_LABELS.map((v) => (
            <Pressable
              key={v.key}
              onPress={() => run(v.key, () => regenerate({ draftId, variant: v.key }))}
              disabled={busy !== null}
              style={[
                styles.chip,
                { borderColor: theme.border },
                busy !== null && { opacity: 0.5 },
              ]}
            >
              {busy === v.key ? (
                <ActivityIndicator size="small" color={theme.text} />
              ) : (
                <Text style={[styles.chipText, { color: theme.text }]}>{v.label}</Text>
              )}
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.actionRow}>
        {editing ? (
          <>
            <Pressable
              onPress={() => {
                setEditing(false);
                setEditText(draft.text);
              }}
              style={[styles.btn, { borderColor: theme.border }]}
            >
              <Text style={{ color: theme.text }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                run('save', async () => {
                  await updateText({ draftId, text: editText.trim() });
                  setEditing(false);
                })
              }
              disabled={busy !== null}
              style={[styles.btn, styles.btnPrimary, { backgroundColor: theme.primary }]}
            >
              {busy === 'save' ? (
                <ActivityIndicator size="small" color={theme.primaryText} />
              ) : (
                <Text style={{ color: theme.primaryText, fontWeight: '700' }}>Save</Text>
              )}
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={() => run('reject', () => rejectAndClear({ draftId }))}
              disabled={busy !== null}
              style={[styles.btn, { borderColor: theme.border }]}
            >
              <Text style={{ color: theme.danger ?? '#EF4444' }}>Reject</Text>
            </Pressable>
            <Pressable
              onPress={() => run('ignore', () => ignoreDraft({ draftId }))}
              disabled={busy !== null}
              style={[styles.btn, { borderColor: theme.border }]}
            >
              <Text style={{ color: theme.text }}>Ignore</Text>
            </Pressable>
            <Pressable
              onPress={() => setEditing(true)}
              disabled={busy !== null}
              style={[styles.btn, { borderColor: theme.border }]}
            >
              <Text style={{ color: theme.text }}>Edit</Text>
            </Pressable>
            <Pressable
              onPress={() => run('send', () => sendDraft({ draftId }))}
              disabled={busy !== null}
              style={[styles.btn, styles.btnPrimary, { backgroundColor: theme.primary }]}
            >
              {busy === 'send' ? (
                <ActivityIndicator size="small" color={theme.primaryText} />
              ) : (
                <Text style={{ color: theme.primaryText, fontWeight: '700' }}>Send</Text>
              )}
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 10,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  priorityBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  priorityText: { fontSize: 10, fontWeight: '700' },
  block: { gap: 4 },
  blockLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  bodyText: { fontSize: 14, lineHeight: 19 },
  input: {
    minHeight: 60,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 10,
    textAlignVertical: 'top',
    fontSize: 14,
  },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  metaText: { fontSize: 11 },
  variantRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 12, fontWeight: '600' },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { borderWidth: 0 },
});
