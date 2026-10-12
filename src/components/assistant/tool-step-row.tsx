import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ConfirmCard } from '@/components/assistant/confirm-card';
import { QuestionCard } from '@/components/assistant/question-card';
import { AppIcon, type AppIconName } from '@/components/ui/app-icon';
import { Fonts } from '@/constants/theme';
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
  getChatMessages: 'Reading chat history',
  getBriefing: 'Reading daily briefing',
  searchKnowledge: 'Searching knowledge',
  listDrafts: 'Checking pending approvals',
  listReminders: 'Listing reminders',
  searchMemories: 'Searching memory',
  getContactProfile: 'Reading contact profile',
  askAcrossChats: 'Searching across chats',
  // Write
  sendWhatsappMessage: 'Send WhatsApp message',
  draftReply: 'Draft reply',
  regenerateDraft: 'Regenerating draft',
  createTask: 'Create task',
  markTaskDone: 'Mark task done',
  createReminder: 'Creating reminder',
  createTaskFromMessage: 'Extracting task from message',
  summarizeMessage: 'Summarizing message',
  explainMessage: 'Explaining message',
  askAboutChat: 'Asking about chat',
  askAboutDocument: 'Asking about document',
  markMessageImportant: 'Marking message important',
  markNeedsReply: 'Flag needs-reply',
  markUrgent: 'Marking urgent',
  acceptMeeting: 'Accept meeting',
  proposeAlternateMeetingTime: 'Proposing alternate time',
  regenerateTodayBriefing: "Regenerating today's briefing",
  markActionPlanItemDone: 'Mark plan item done',
  sendDraft: 'Send queued draft',
  rememberThis: 'Save to memory',
  forgetMemory: 'Forget memory',
  saveKnowledge: 'Save to knowledge base',
  updateChatSettings: 'Update chat settings',
  createContactGoal: 'Set up an ongoing goal',
  // Destructive
  rejectDraft: 'Reject draft',
  dismissReminder: 'Dismiss reminder',
  deleteTask: 'Delete task',
  declineMeeting: 'Decline meeting',
};

const WRITE_DONE_SUMMARY: Record<string, string> = {
  sendWhatsappMessage: 'Message sent',
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
  if (!name || name === 'unknown') return 'Tool activity';
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function getToolIcon(toolName: string): AppIconName {
  const lower = toolName.toLowerCase();
  if (lower.includes('search') || lower.includes('find')) return 'search';
  if (lower.includes('message') || lower.includes('chat') || lower.includes('reply')) return 'chat';
  if (lower.includes('task') || lower.includes('plan')) return 'checklist';
  if (lower.includes('document') || lower.includes('briefing')) return 'document';
  if (lower.includes('knowledge') || lower.includes('memori')) return 'knowledge';
  if (lower.includes('send') || lower.includes('draft')) return 'send';
  return 'sparkles';
}

function isWriteTool(name: string): boolean {
  return name in WRITE_DONE_SUMMARY;
}

function isBookkeepingRow(row: Doc<'assistantMessages'>): boolean {
  const result = row.toolResult as { status?: unknown } | null | undefined;
  return typeof result?.status === 'string' && result.status.startsWith('pending_');
}

/**
 * Format arguments into clean human-readable key-value pairs without raw JSON braces.
 */
function formatToolArgs(args: unknown): { label: string; value: string }[] {
  if (!args || typeof args !== 'object') return [];
  const entries: { label: string; value: string }[] = [];
  const obj = args as Record<string, unknown>;

  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null || val === '') continue;
    let label = key
      .replace(/([A-Z])/g, ' $1')
      .replace(/[_-]+/g, ' ')
      .trim();
    label = label.charAt(0).toUpperCase() + label.slice(1);

    let valueStr = '';
    if (typeof val === 'string') {
      valueStr = val;
    } else if (typeof val === 'number' || typeof val === 'boolean') {
      valueStr = String(val);
    } else if (Array.isArray(val)) {
      valueStr = val
        .map((v) =>
          typeof v === 'object' && v !== null
            ? Object.values(v)
                .filter((x) => typeof x === 'string' || typeof x === 'number')
                .join(', ')
            : String(v),
        )
        .join(', ');
    } else if (typeof val === 'object') {
      valueStr = Object.entries(val)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join(' • ');
    }

    // Strip any raw curly braces if they somehow exist
    valueStr = valueStr.replace(/[{}[\]"]/g, '').trim();

    if (valueStr.length > 0) {
      entries.push({ label, value: valueStr });
    }
  }
  return entries;
}

/**
 * Clean result preview without spilling raw JSON objects or brackets.
 */
function formatToolResultSummary(result: unknown): string | null {
  if (result === undefined || result === null) return null;
  if (typeof result === 'string') {
    return result.replace(/[{}[\]"]/g, '').trim();
  }
  if (Array.isArray(result)) {
    return `${result.length} item${result.length === 1 ? '' : 's'} returned`;
  }
  if (typeof result === 'object') {
    const res = result as Record<string, unknown>;
    if (typeof res.message === 'string') return res.message;
    if (typeof res.summary === 'string') return res.summary;
    if (typeof res.status === 'string') return `Status: ${res.status}`;
    if (Array.isArray(res.messages)) return `${res.messages.length} messages found`;
    if (Array.isArray(res.chats)) return `${res.chats.length} chats retrieved`;
    if (Array.isArray(res.tasks)) return `${res.tasks.length} tasks found`;
    if (Array.isArray(res.meetings)) return `${res.meetings.length} meetings found`;
    if (typeof res.text === 'string') return res.text;

    const summaries = Object.entries(res)
      .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
      .slice(0, 3)
      .map(([k, v]) => `${k}: ${v}`);
    if (summaries.length > 0) return summaries.join(' • ');
    return 'Completed successfully';
  }
  return String(result);
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

  if (toolName === 'askUserQuestion' || toolName === 'askUserForChoice') {
    return <QuestionCard row={row} />;
  }
  if (status === 'awaiting_confirmation') {
    return <ConfirmCard row={row} />;
  }

  const label = TOOL_LABEL[toolName] ?? humanizeToolName(row.toolName);
  const icon = getToolIcon(toolName);

  const isCancelled = status === 'cancelled';
  const isRunning = status === 'running';
  const isError = status === 'error';

  const accentColor = isError
    ? theme.danger
    : isCancelled
      ? theme.textSecondary
      : isRunning
        ? theme.primary
        : '#10B981'; // Sleek emerald green for completed

  const outcome = isRunning
    ? null
    : isError
      ? 'Failed'
      : isCancelled
        ? 'Cancelled'
        : isWriteTool(toolName)
          ? WRITE_DONE_SUMMARY[toolName]
          : null;

  const parsedArgs = formatToolArgs(row.toolArgs);
  const resultSummary = formatToolResultSummary(row.toolResult);
  const hasDetails = parsedArgs.length > 0 || !!resultSummary;

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={outcome ? `${label}. ${outcome}` : label}
        accessibilityState={{ expanded }}
        onPress={() => hasDetails && setExpanded((e) => !e)}
        style={({ pressed }) => [
          styles.pill,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: isRunning ? `${theme.primary}55` : theme.border,
            opacity: pressed && hasDetails ? 0.75 : 1,
          },
        ]}
      >
        <View style={styles.leftSection}>
          <View
            style={[
              styles.iconSlot,
              {
                backgroundColor: isRunning ? `${theme.primary}1A` : `${accentColor}15`,
              },
            ]}
          >
            {isRunning ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : isError ? (
              <AppIcon name="error" tintColor={accentColor} size={14} />
            ) : (
              <AppIcon name={icon} tintColor={accentColor} size={14} />
            )}
          </View>

          <View style={styles.labelCol}>
            <Text
              style={[styles.label, { color: isRunning ? theme.text : theme.textSecondary }]}
              numberOfLines={1}
            >
              {label}
            </Text>
            {outcome ? (
              <Text
                style={[styles.outcome, { color: isError ? theme.danger : accentColor }]}
                numberOfLines={1}
              >
                {outcome}
              </Text>
            ) : null}
          </View>
        </View>

        {hasDetails ? (
          <View style={styles.chevronSlot}>
            <AppIcon
              name={expanded ? 'chevronUp' : 'chevronDown'}
              tintColor={theme.textSecondary}
              size={14}
            />
          </View>
        ) : null}
      </Pressable>

      {expanded && hasDetails ? (
        <View
          style={[
            styles.detailCard,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
            },
          ]}
        >
          {parsedArgs.length > 0 ? (
            <View style={styles.section}>
              <Text style={[styles.detailSectionTitle, { color: theme.textSecondary }]}>
                PARAMETERS
              </Text>
              <View style={styles.badgeContainer}>
                {parsedArgs.map((arg, idx) => (
                  <View
                    key={idx}
                    style={[
                      styles.paramChip,
                      {
                        backgroundColor: theme.background,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Text style={[styles.paramLabel, { color: theme.textSecondary }]}>
                      {arg.label}:
                    </Text>
                    <Text style={[styles.paramValue, { color: theme.text }]} numberOfLines={2}>
                      {arg.value}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {resultSummary ? (
            <View
              style={[
                styles.section,
                parsedArgs.length > 0 && styles.sectionBorder,
                { borderTopColor: theme.border },
              ]}
            >
              <Text style={[styles.detailSectionTitle, { color: theme.textSecondary }]}>
                RESULT
              </Text>
              <Text style={[styles.resultText, { color: theme.text }]} numberOfLines={4}>
                {resultSummary}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'flex-start',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  iconSlot: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelCol: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  label: {
    fontSize: 13,
    fontFamily: Fonts.sansSemiBold,
  },
  outcome: {
    fontSize: 11,
    fontFamily: Fonts.sansMedium,
  },
  chevronSlot: {
    paddingLeft: 4,
  },
  detailCard: {
    marginTop: 6,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    gap: 8,
  },
  section: {
    gap: 6,
  },
  sectionBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  detailSectionTitle: {
    fontSize: 10,
    fontFamily: Fonts.sansBold,
    letterSpacing: 0.6,
  },
  badgeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  paramChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '100%',
  },
  paramLabel: {
    fontSize: 11,
    fontFamily: Fonts.sansMedium,
  },
  paramValue: {
    fontSize: 11,
    fontFamily: Fonts.sansSemiBold,
  },
  resultText: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Fonts.sans,
  },
});
