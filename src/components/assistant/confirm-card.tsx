import { useAction, useQuery } from 'convex/react';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { useInstance } from '@/lib/instance';

import { api } from '../../../convex/_generated/api';
import type { Doc } from '../../../convex/_generated/dataModel';

function parseHHmm(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

function localMinutes(nowMs: number, tz: string | undefined | null): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz && tz.length > 0 ? tz : 'UTC',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });
    const parts = fmt.formatToParts(new Date(nowMs));
    let h = 0;
    let m = 0;
    for (const p of parts) {
      if (p.type === 'hour') h = Number(p.value);
      else if (p.type === 'minute') m = Number(p.value);
    }
    if (h === 24) h = 0;
    return h * 60 + m;
  } catch {
    const d = new Date(nowMs);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
}

function isQuietNow(pref: {
  quietHoursEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  quietHoursTimezone?: string;
} | null | undefined): boolean {
  if (!pref || pref.quietHoursEnabled !== true) return false;
  const start = parseHHmm(pref.quietHoursStart);
  const end = parseHHmm(pref.quietHoursEnd);
  if (start === null || end === null || start === end) return false;
  const cur = localMinutes(Date.now(), pref.quietHoursTimezone);
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

function truncate(s: unknown, n: number): string {
  const str = typeof s === 'string' ? s : '';
  if (str.length <= n) return str;
  return str.slice(0, n - 1) + '…';
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function formatDue(dueAt: unknown): string | null {
  if (typeof dueAt !== 'number' || !Number.isFinite(dueAt)) return null;
  try {
    return new Date(dueAt).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

const DESTRUCTIVE_DESCRIPTION: Record<string, (args: Record<string, unknown>) => string> = {
  rejectDraft: () => 'Bimi wants to reject this draft and clear the needs-reply flag.',
  dismissReminder: () => 'Bimi wants to permanently dismiss this reminder.',
  deleteTask: () => 'Bimi wants to delete this task.',
  declineMeeting: () => 'Bimi wants to decline this meeting.',
  acceptMeeting: () => 'Bimi wants to accept this meeting.',
  draftReply: () => 'Bimi wants to save this draft reply.',
  createTask: () => 'Bimi wants to add a task.',
  markTaskDone: () => 'Bimi wants to mark this task as done.',
  markNeedsReply: (args) =>
    args.value === true
      ? 'Bimi wants to flag this message as needing a reply.'
      : 'Bimi wants to clear the needs-reply flag on this message.',
  markActionPlanItemDone: (args) =>
    `Bimi wants to mark action plan item #${args.order ?? '?'} as done.`,
  sendWhatsappMessage: (args) => {
    const to = typeof args.contactName === 'string' ? args.contactName : 'this contact';
    return `Bimi wants to send a WhatsApp message to ${to}.`;
  },
  sendDraft: (args) => {
    const to = typeof args.contactName === 'string' ? args.contactName : 'this contact';
    return `Bimi wants to send the queued draft to ${to}.`;
  },
  createReminder: () => 'Bimi wants to set a reminder.',
  rememberThis: (args) =>
    args.scope === 'contact' && typeof args.contactName === 'string'
      ? `Bimi wants to remember this about ${args.contactName}.`
      : 'Bimi wants to remember this about you.',
  forgetMemory: () => 'Bimi wants to permanently delete this memory.',
  saveKnowledge: () => 'Bimi wants to save this to your knowledge base.',
  updateChatSettings: (args) => {
    const who = typeof args.contactName === 'string' ? args.contactName : 'this chat';
    return `Bimi wants to change how it handles ${who}.`;
  },
  createContactGoal: (args) => {
    const who = typeof args.contactName === 'string' ? args.contactName : 'this contact';
    return args.mode === 'auto'
      ? `Bimi wants a standing goal for ${who} — and will send those messages on its own.`
      : `Bimi wants a standing goal for ${who}. Each message will come to Approvals first.`;
  },
};

function SendPreview({
  args,
  theme,
  draft,
}: {
  args: Record<string, unknown>;
  theme: ReturnType<typeof useTheme>;
  draft?: boolean;
}) {
  const contactName = str(args.contactName) ?? 'Contact';
  const text = typeof args.text === 'string' ? args.text : '';
  const quotedPreview = str(args.quotedPreview);
  const quotedFromMe = args.quotedFromMe === true;

  const instance = useInstance();
  const userPref = useQuery(api.userPreferences.get, { instance });
  const quietActive = !draft && isQuietNow(userPref);

  return (
    <View style={previewStyles.wrap}>
      {quietActive ? (
        <View style={previewStyles.quietBadge}>
          <Text style={previewStyles.quietBadgeText}>
            Quiet hours — this will be queued as a draft (Approvals tab), not sent.
          </Text>
        </View>
      ) : null}
      <Text style={[previewStyles.toLabel, { color: theme.textSecondary }]}>
        To <Text style={{ color: theme.text, fontWeight: '700' }}>{contactName}</Text>
      </Text>
      <View
        style={[
          previewStyles.bubble,
          { backgroundColor: theme.bubbleSent },
          draft && { opacity: 0.75 },
        ]}>
        {quotedPreview ? (
          <View
            style={[
              previewStyles.quoted,
              {
                backgroundColor: 'rgba(255,255,255,0.18)',
                borderLeftColor: theme.primaryText,
              },
            ]}>
            <Text
              style={[
                previewStyles.quotedAuthor,
                { color: theme.primaryText },
              ]}>
              {quotedFromMe ? 'You' : contactName}
            </Text>
            <Text
              numberOfLines={2}
              style={[previewStyles.quotedText, { color: theme.primaryText, opacity: 0.85 }]}>
              {quotedPreview}
            </Text>
          </View>
        ) : null}
        <Text style={[previewStyles.bubbleText, { color: theme.bubbleSentText }]}>
          {text}
        </Text>
      </View>
      {draft ? (
        <Text style={[previewStyles.caption, { color: theme.textSecondary }]}>
          Draft — saved to the Approvals tab, not sent.
        </Text>
      ) : null}
    </View>
  );
}

function TaskPreview({
  args,
  theme,
  mode,
}: {
  args: Record<string, unknown>;
  theme: ReturnType<typeof useTheme>;
  mode: 'create' | 'done' | 'delete';
}) {
  const title =
    str(args.title) ?? str(args.taskTitle) ?? 'this task';
  const due = formatDue(args.dueAt);
  const contactName = str(args.contactName);
  return (
    <View
      style={[
        previewStyles.itemCard,
        { borderColor: theme.border, backgroundColor: theme.background },
      ]}>
      <Text
        style={[
          previewStyles.itemTitle,
          { color: theme.text },
          mode === 'delete' && { textDecorationLine: 'line-through' },
        ]}
        numberOfLines={2}>
        {truncate(title, 120)}
      </Text>
      {due ? (
        <Text style={[previewStyles.itemMeta, { color: theme.textSecondary }]}>
          Due {due}
        </Text>
      ) : null}
      {contactName ? (
        <Text style={[previewStyles.itemMeta, { color: theme.textSecondary }]}>
          For {contactName}
        </Text>
      ) : null}
    </View>
  );
}

function MeetingPreview({
  args,
  theme,
  mode,
}: {
  args: Record<string, unknown>;
  theme: ReturnType<typeof useTheme>;
  mode: 'accept' | 'decline';
}) {
  const contactName = str(args.contactName);
  const title = str(args.meetingTitle);
  const startAt = formatDue(args.startAt);
  return (
    <View
      style={[
        previewStyles.itemCard,
        { borderColor: theme.border, backgroundColor: theme.background },
      ]}>
      <Text style={[previewStyles.itemTitle, { color: theme.text }]} numberOfLines={2}>
        {mode === 'accept' ? 'Accept' : 'Decline'}
        {title ? `: ${truncate(title, 80)}` : ' meeting'}
        {contactName ? ` with ${contactName}` : ''}
      </Text>
      {startAt ? (
        <Text style={[previewStyles.itemMeta, { color: theme.textSecondary }]}>
          {startAt}
        </Text>
      ) : null}
    </View>
  );
}

function ConfirmPreview({
  toolName,
  args,
  theme,
}: {
  toolName: string;
  args: Record<string, unknown>;
  theme: ReturnType<typeof useTheme>;
}) {
  switch (toolName) {
    case 'sendWhatsappMessage':
      return <SendPreview args={args} theme={theme} />;
    case 'draftReply':
      return <SendPreview args={args} theme={theme} draft />;
    case 'createTask':
      return <TaskPreview args={args} theme={theme} mode="create" />;
    case 'markTaskDone':
      return <TaskPreview args={args} theme={theme} mode="done" />;
    case 'deleteTask':
      return <TaskPreview args={args} theme={theme} mode="delete" />;
    case 'acceptMeeting':
      return <MeetingPreview args={args} theme={theme} mode="accept" />;
    case 'declineMeeting':
      return <MeetingPreview args={args} theme={theme} mode="decline" />;
    default:
      return null;
  }
}

type Props = {
  row: Doc<'assistantMessages'>;
};

export function ConfirmCard({ row }: Props) {
  const theme = useTheme();
  const [confirming, setConfirming] = useState(false);
  const resolveConfirmation = useAction(api.assistant.resolveConfirmation);

  const toolName = row.toolName ?? '';
  const args = (row.toolArgs ?? {}) as Record<string, unknown>;
  const copy =
    DESTRUCTIVE_DESCRIPTION[toolName]?.(args) ??
    'Bimi wants to perform this action.';

  const resolve = async (approved: boolean) => {
    if (confirming) return;
    setConfirming(true);
    try {
      await resolveConfirmation({
        confirmationMessageId: row._id,
        approved,
      });
    } catch (err) {
      Alert.alert('Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <View
      style={[
        styles.card,
        { borderColor: '#F59E0B', backgroundColor: theme.backgroundElement },
      ]}>
      <Text style={[styles.copy, { color: theme.text }]}>{copy}</Text>
      <ConfirmPreview toolName={toolName} args={args} theme={theme} />
      <View style={styles.actions}>
        <Pressable
          onPress={() => resolve(false)}
          disabled={confirming}
          style={[styles.btn, { borderColor: theme.border }]}>
          <Text style={{ color: theme.text, fontWeight: '600' }}>Deny</Text>
        </Pressable>
        <Pressable
          onPress={() => resolve(true)}
          disabled={confirming}
          style={[
            styles.btn,
            styles.btnPrimary,
            { backgroundColor: theme.primary },
            confirming && { opacity: 0.5 },
          ]}>
          {confirming ? (
            <ActivityIndicator size="small" color={theme.primaryText} />
          ) : (
            <Text style={{ color: theme.primaryText, fontWeight: '700' }}>Allow</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 10,
    marginVertical: 4,
  },
  copy: { fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  btn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { borderWidth: 0 },
});

const previewStyles = StyleSheet.create({
  wrap: { gap: 6 },
  toLabel: { fontSize: 12 },
  bubble: {
    alignSelf: 'flex-start',
    maxWidth: '95%',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  quoted: {
    borderLeftWidth: 3,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
  },
  quotedAuthor: { fontSize: 11, fontWeight: '700', marginBottom: 2 },
  quotedText: { fontSize: 12, lineHeight: 16 },
  bubbleText: { fontSize: 14, lineHeight: 19 },
  caption: { fontSize: 11, fontStyle: 'italic' },
  quietBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: '#F59E0B',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
  },
  quietBadgeText: { fontSize: 11, fontWeight: '600', color: '#92400E' },
  itemCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  itemTitle: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
  itemMeta: { fontSize: 12 },
});
