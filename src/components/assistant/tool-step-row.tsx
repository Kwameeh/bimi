import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ConfirmCard } from '@/components/assistant/confirm-card';
import { QuestionCard } from '@/components/assistant/question-card';
import { AppIcon } from '@/components/ui/app-icon';
import { useTheme } from '@/hooks/use-theme';

import type { Doc, Id } from '../../../convex/_generated/dataModel';

const TOOL_LABEL: Record<string, string> = {
  // Read-only
  askUserQuestion: 'Asking a question',
  askUserForChoice: 'Asking a clarifying question',
  resolveTime: 'Resolving time range',
  findContactByName: 'Looking up contact',
  searchByKeyword: 'Searching messages',
  searchMessages: 'Searching messages',
  listMessagesInRange: 'Listing messages',
  listDeadlines: 'Listing deadlines',
  listDocuments: 'Listing documents',
  listMentions: 'Listing mentions',
  listUrgent: 'Listing urgent messages',
  listNeedsReply: 'Listing replies needed',
  listMeetings: 'Listing meetings',
  listTasks: 'Listing tasks',
  listTopChats: 'Loading top chats',
  getChatMessages: 'Reading chat',
  getBriefing: 'Reading daily briefing',
  searchKnowledge: 'Searching knowledge',
  listDrafts: 'Checking approvals',
  listReminders: 'Listing reminders',
  searchMemories: 'Searching memory',
  getContactProfile: 'Reading contact profile',
  askAcrossChats: 'Searching across chats',
  // Write
  sendWhatsappMessage: 'Send WhatsApp message',
  draftReply: 'Draft a reply',
  regenerateDraft: 'Regenerating draft',
  createTask: 'Create task',
  markTaskDone: 'Mark task done',
  createReminder: 'Creating reminder',
  createTaskFromMessage: 'Extracting task from message',
  summarizeMessage: 'Summarizing message',
  explainMessage: 'Explaining message',
  askAboutChat: 'Asking about a chat',
  askAboutDocument: 'Asking about a document',
  markMessageImportant: 'Marking message important',
  markNeedsReply: 'Flag needs-reply',
  markUrgent: 'Marking urgent',
  acceptMeeting: 'Accept meeting',
  proposeAlternateMeetingTime: 'Proposing alternate time',
  regenerateTodayBriefing: "Regenerating today's briefing",
  markActionPlanItemDone: 'Mark plan item done',
  sendDraft: 'Send queued draft',
  rememberThis: 'Remember this',
  forgetMemory: 'Forget memory',
  saveKnowledge: 'Save to knowledge base',
  updateChatSettings: 'Update chat settings',
  createContactGoal: 'Set up an ongoing goal',
  // Destructive (require confirmation)
  rejectDraft: 'Reject draft',
  dismissReminder: 'Dismiss reminder',
  deleteTask: 'Delete task',
  declineMeeting: 'Decline meeting',
};

const WRITE_DONE_SUMMARY: Record<string, string> = {
  sendWhatsappMessage: 'Sent',
  draftReply: 'Draft saved to Approvals',
  createTask: 'Task created',
  markTaskDone: 'Marked done',
  deleteTask: 'Task deleted',
  acceptMeeting: 'Meeting accepted',
  declineMeeting: 'Meeting declined',
  rejectDraft: 'Draft rejected',
  dismissReminder: 'Reminder dismissed',
  markNeedsReply: 'Flag updated',
  markActionPlanItemDone: 'Plan item marked done',
  sendDraft: 'Draft sent',
  createReminder: 'Reminder set',
  rememberThis: 'Saved to memory',
  forgetMemory: 'Memory deleted',
  saveKnowledge: 'Saved to knowledge base',
  updateChatSettings: 'Chat settings updated',
  createContactGoal: 'Goal created',
};

function humanizeToolName(name: string | null | undefined): string {
  if (!name || name === 'unknown') return 'Tool step';
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Whether this tool changed something, as opposed to just reading.
 * Read steps are scaffolding — the answer they produced is right underneath —
 * so they say only what ran. Writes get a line confirming what actually
 * happened, because that is state the user now has to live with.
 */
function isWriteTool(name: string): boolean {
  return name in WRITE_DONE_SUMMARY;
}

/**
 * Stream bookkeeping rows: when a tool's `execute` queues its own interactive
 * row (choice/question/confirmation), the streaming layer still records a
 * `running → done` row whose result is just `{status: "pending_*"}`. Those
 * are noise — the interactive row is the one the user acts on.
 */
function isBookkeepingRow(row: Doc<'assistantMessages'>): boolean {
  const result = row.toolResult as { status?: unknown } | null | undefined;
  return (
    typeof result?.status === 'string' && result.status.startsWith('pending_')
  );
}

type Props = {
  row: Doc<'assistantMessages'>;
  onOpenContact?: (id: Id<'contacts'>) => void;
};

export function ToolStepRow({ row }: Props) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  if (isBookkeepingRow(row)) return null;

  const toolName = row.toolName ?? '';
  const status = row.status ?? 'done';

  // Interactive cards own their full lifecycle (active + answered states).
  if (toolName === 'askUserQuestion' || toolName === 'askUserForChoice') {
    return <QuestionCard row={row} />;
  }
  if (status === 'awaiting_confirmation') {
    return <ConfirmCard row={row} />;
  }

  const label = TOOL_LABEL[toolName] ?? humanizeToolName(row.toolName);

  const isCancelled = status === 'cancelled';
  const isRunning = status === 'running';
  const isError = status === 'error';

  const accent = isError
    ? theme.danger
    : isCancelled
      ? theme.textSecondary
      : '#16A34A';

  // Read steps carry no trailing line: the row already names what ran, and
  // the answer follows immediately. Only outcomes the user needs to know
  // about — a failure, a denial, or a completed write — get a second line.
  const outcome = isRunning
    ? null
    : isError
      ? 'Failed'
      : isCancelled
        ? 'Denied'
        : isWriteTool(toolName)
          ? WRITE_DONE_SUMMARY[toolName]
          : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={outcome ? `${label}. ${outcome}` : label}
      accessibilityState={{ expanded }}
      onPress={() => setExpanded((e) => !e)}
      style={styles.wrap}>
      <View style={styles.mainLine}>
        <View style={styles.bulletSlot}>
          {isRunning ? (
            <ActivityIndicator size="small" color={theme.textSecondary} />
          ) : isError ? (
            <AppIcon name="error" tintColor={accent} size={13} />
          ) : (
            <AppIcon name="dot" tintColor={accent} size={9} />
          )}
        </View>
        <Text
          style={[
            styles.label,
            { color: isRunning ? theme.text : theme.textSecondary },
          ]}
          numberOfLines={1}>
          {label}
        </Text>
        {outcome ? (
          <Text
            style={[styles.outcome, { color: isError ? theme.danger : theme.textSecondary }]}
            numberOfLines={1}>
            {outcome}
          </Text>
        ) : null}
      </View>

      {expanded ? (
        <View style={styles.expand}>
          {row.toolArgs ? (
            <>
              <Text style={[styles.expandLabel, { color: theme.textSecondary }]}>Args</Text>
              <Text style={[styles.expandBody, { color: theme.text }]}>
                {JSON.stringify(row.toolArgs, null, 2)}
              </Text>
            </>
          ) : null}
          {row.toolResult !== undefined && row.toolResult !== null ? (
            <>
              <Text style={[styles.expandLabel, { color: theme.textSecondary, marginTop: 6 }]}>
                Result
              </Text>
              <Text style={[styles.expandBody, { color: theme.text }]} numberOfLines={12}>
                {JSON.stringify(row.toolResult, null, 2).slice(0, 1200)}
              </Text>
            </>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: 3,
    paddingHorizontal: 2,
  },
  mainLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bulletSlot: { width: 14, alignItems: 'center' },
  label: { flex: 1, fontSize: 13 },
  outcome: { fontSize: 12, flexShrink: 0 },
  expand: {
    marginLeft: 24,
    marginTop: 4,
    gap: 2,
  },
  expandLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  expandBody: { fontSize: 11, fontFamily: 'ui-monospace' },
});
