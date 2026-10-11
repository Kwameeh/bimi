import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { api, internal } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';

type MessageRef = {
  messageId: Id<'messages'>;
  contactId: Id<'contacts'>;
  contactName: string | null;
  preview: string;
  timestamp: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_MS = 7 * DAY_MS;

function preview(text: string): string {
  return (text ?? '').trim().slice(0, 200);
}

async function loadContactName(
  ctx: ActionCtx,
  contactId: Id<'contacts'>,
  cache: Map<string, string>,
): Promise<string | null> {
  const cached = cache.get(contactId);
  if (cached !== undefined) return cached;
  const c = await ctx.runQuery(internal.contacts.getContactInternal, { contactId });
  const name = c?.displayName ?? c?.pushName ?? c?.normalizedPhone ?? null;
  cache.set(contactId, name ?? '');
  return name;
}

async function enrichMessages(
  ctx: ActionCtx,
  messages: Array<Doc<'messages'>>,
): Promise<MessageRef[]> {
  const cache = new Map<string, string>();
  const out: MessageRef[] = [];
  for (const m of messages) {
    const name = await loadContactName(ctx, m.contactId, cache);
    out.push({
      messageId: m._id,
      contactId: m.contactId,
      contactName: name,
      preview: preview(m.text),
      timestamp: m.timestamp ?? null,
    });
  }
  return out;
}

type ToolBuildArgs = {
  instance: string;
  threadId: Id<'assistantThreads'>;
};

/**
 * Core read-only assistant tools.
 *
 * `buildAssistantActionTools` (below) adds write/destructive tools that go
 * through the Allow/Deny confirmation flow.
 */
export function buildAssistantTools(
  ctx: ActionCtx,
  instanceOrArgs: string | ToolBuildArgs,
  _legacyThreadId?: Id<'assistantThreads'>,
): ToolSet {
  const instance = typeof instanceOrArgs === 'string' ? instanceOrArgs : instanceOrArgs.instance;
  const threadId = typeof instanceOrArgs === 'string' ? _legacyThreadId : instanceOrArgs.threadId;

  async function queueChoice(args: { question: string; options: string[] }): Promise<{
    status: 'pending_choice';
    choiceMessageId: string;
    options: string[];
  }> {
    if (!threadId) {
      throw new Error(
        'askUserForChoice requires a threadId — pass { instance, threadId } to buildAssistantTools.',
      );
    }
    const id = (await ctx.runMutation(internal.assistant.insertAwaitingChoiceInternal, {
      threadId,
      toolArgs: { question: args.question, options: args.options },
    })) as string;
    return {
      status: 'pending_choice',
      choiceMessageId: id,
      options: args.options,
    };
  }

  async function queueQuestions(args: {
    questions: Array<{
      question: string;
      header: string;
      multiSelect: boolean;
      options: Array<{ label: string; description: string }>;
    }>;
  }): Promise<{
    status: 'pending_questions';
    questionMessageId: string;
  }> {
    if (!threadId) {
      throw new Error(
        'askUserQuestion requires a threadId — pass { instance, threadId } to buildAssistantTools.',
      );
    }
    const id = (await ctx.runMutation(internal.assistant.insertAwaitingQuestionsInternal, {
      threadId,
      toolArgs: { questions: args.questions },
    })) as string;
    return { status: 'pending_questions', questionMessageId: id };
  }

  return {
    askUserQuestion: tool({
      description:
        "Ask the user 1-4 structured clarifying questions, each with 2-4 tappable answer options. Use this WHENEVER a request is ambiguous (unclear contact, time window, which task/meeting, multiple matches) instead of guessing, refusing, or asking in plain text. Prefer ONE question unless you genuinely need several distinct answers. The user also always gets an automatic 'Other' free-text option — don't add one yourself. Returns: nothing useful; the user's answers arrive as a new user message in the next turn, formatted 'Header: answer; Header: answer'.",
      inputSchema: z.object({
        questions: z
          .array(
            z.object({
              question: z
                .string()
                .min(1)
                .max(160)
                .describe("Full question text. Example: 'Which contact did you mean?'"),
              header: z
                .string()
                .min(1)
                .max(12)
                .describe(
                  "Very short label (max 12 chars) summarizing the question. Examples: 'Contact', 'Timing', 'Which task'.",
                ),
              multiSelect: z
                .boolean()
                .describe(
                  'true = the user may pick multiple options; false = exactly one. Use true only when more than one answer can legitimately apply.',
                ),
              options: z
                .array(
                  z.object({
                    label: z.string().min(1).max(60).describe('Short tappable answer label.'),
                    description: z
                      .string()
                      .max(120)
                      .describe(
                        'One-line clarifier shown under the label, e.g. what this choice implies. May be an empty string.',
                      ),
                  }),
                )
                .min(2)
                .max(4)
                .describe('2-4 answer options.'),
            }),
          )
          .min(1)
          .max(4)
          .describe('1-4 questions. Prefer ONE unless several are genuinely needed.'),
      }),
      execute: async ({ questions }) => queueQuestions({ questions }),
    }),

    askUserForChoice: tool({
      description:
        "Ask the user to pick from 2-5 tappable choices. Use this whenever you would otherwise refuse, ask for more info, or guess at an ambiguous detail. NEVER respond with 'I need more information' — use this tool. Returns: nothing useful; the user's pick arrives as a new user message in the next turn.",
      inputSchema: z.object({
        question: z
          .string()
          .min(1)
          .max(120)
          .describe(
            "Short clarifying question. Examples: 'When?', 'Which contact?', 'Which meeting?'",
          ),
        options: z
          .array(z.string().min(1).max(60))
          .min(2)
          .max(5)
          .describe(
            "2-5 short option labels the user will tap. Examples: ['Today','Yesterday','Past week','This month']",
          ),
      }),
      execute: async ({ question, options }) => queueChoice({ question, options }),
    }),

    getBriefing: tool({
      description:
        "Get today's daily WhatsApp briefing. Use for: 'summarize today', 'summary of my day', 'what happened today', 'briefing', 'recap'. Returns: object with sections {urgent, needsReply, tasks, meetings, documents, autoReplied, fyi, trends}, each an array of refs.",
      inputSchema: z.object({}),
      execute: async () => ctx.runQuery(api.summaries.getLatestForInstance, { instance }),
    }),

    listNeedsReply: tool({
      description:
        "List messages waiting for the user's reply. Use for: 'who needs my reply', 'what should I respond to', 'what am I missing', 'who is waiting on me'. Returns: array of {messageId, contactId, contactName, preview, timestamp}. Empty array = nothing waiting.",
      inputSchema: z.object({
        sinceMs: z
          .number()
          .nullable()
          .describe(
            "Lower bound epoch-ms. Null = default last 7 days. For 'today' pass Date.now() - 86400000.",
          ),
        limit: z.number().int().min(1).max(50).nullable().describe('Max rows (default 25).'),
      }),
      execute: async (args) => {
        const sinceMs = args.sinceMs ?? Date.now() - DEFAULT_WINDOW_MS;
        const rows = await ctx.runQuery(internal.messages.listForInstanceInRange, {
          instance,
          sinceMs,
          includeFromMe: false,
          limit: 200,
        });
        const filtered = rows.filter((m) => m.needsReply === true);
        return enrichMessages(ctx, filtered.slice(0, args.limit ?? 25));
      },
    }),

    listUrgent: tool({
      description:
        "List urgent messages. Use for: 'what's urgent', 'anything urgent', 'urgent stuff'. Returns: array of {messageId, contactId, contactName, preview, timestamp}.",
      inputSchema: z.object({
        sinceMs: z
          .number()
          .nullable()
          .describe('Lower bound epoch-ms. Null = default last 7 days.'),
        limit: z.number().int().min(1).max(50).nullable().describe('Max rows (default 25).'),
      }),
      execute: async (args) => {
        const sinceMs = args.sinceMs ?? Date.now() - DEFAULT_WINDOW_MS;
        const rows = await ctx.runQuery(internal.messages.listForInstanceInRange, {
          instance,
          sinceMs,
          includeFromMe: false,
          limit: 200,
        });
        const filtered = rows.filter((m) => m.priority === 'urgent' || m.isUrgent === true);
        return enrichMessages(ctx, filtered.slice(0, args.limit ?? 25));
      },
    }),

    listMeetings: tool({
      description:
        "List pending and recent meetings. Use for: 'what meetings', 'any meetings', 'scheduled calls', 'do I have any meetings'. Returns: {pending: array of {meetingId, contactName, proposedTimes, status}, recent: array of {messageId, contactId, contactName, preview, timestamp}}.",
      inputSchema: z.object({
        sinceMs: z
          .number()
          .nullable()
          .describe('Lower bound epoch-ms. Null = default last 7 days.'),
      }),
      execute: async (args) => {
        const pending = await ctx.runQuery(api.meetings.listPendingForInstance, {
          instance,
        });
        const sinceMs = args.sinceMs ?? Date.now() - DEFAULT_WINDOW_MS;
        const rows = await ctx.runQuery(internal.messages.listForInstanceInRange, {
          instance,
          sinceMs,
          includeFromMe: false,
          limit: 200,
        });
        const filtered = rows.filter((m) => m.isMeeting === true || m.category === 'meeting');
        const recent = await enrichMessages(ctx, filtered.slice(0, 15));
        return {
          pending: pending.map((entry) => ({
            meetingId: entry.meeting._id,
            contactName: entry.contactName,
            proposedTimes: entry.meeting.proposedTimes,
            status: entry.meeting.status,
          })),
          recent,
        };
      },
    }),

    listTasks: tool({
      description:
        "List the user's tasks. Use for: 'what are my tasks', 'what's on my list', 'todos', 'what do I need to do'. Returns: array of task rows. status filter: 'open' = active todos, 'done' = completed.",
      inputSchema: z.object({
        status: z.enum(['open', 'done']).nullable().describe('Filter by status. Null = all.'),
        limit: z.number().int().min(1).max(50).nullable().describe('Max rows (default 20).'),
      }),
      execute: async (args) =>
        ctx.runQuery(api.tasks.list, {
          instance,
          status: args.status ?? undefined,
          limit: args.limit ?? 20,
        }),
    }),

    findContactByName: tool({
      description:
        "Resolve a person's name or nickname to one or more contactIds. ALWAYS call this BEFORE searchMessages when the user mentions someone by name. Use for: 'what did Alvin say', 'message about Sarah'. Returns: array of {_id, displayName, isGroup, phoneNumber}.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe(
            "The name, nickname, or phone fragment. Examples: 'Alvin', 'Sarah Chen', '233'",
          ),
      }),
      execute: async ({ query }) =>
        ctx.runQuery(api.contacts.findByName, { instance, query, limit: 5 }),
    }),

    searchKnowledge: tool({
      description:
        "Look up something the user told you to remember: project details, backend URLs, message templates, client notes, your availability. Use BEFORE asking the user for info that might already be in the knowledge base. Example: user asks 'send the Wartech URL to Alvin' → call this with query='Wartech' → use the result body in the message you draft.",
      inputSchema: z.object({
        query: z.string().min(1).describe('Keyword search across titles and bodies.'),
        kind: z
          .enum(['project', 'url', 'template', 'client_note', 'availability', 'note'])
          .nullable()
          .describe('Filter by kind. Null = any.'),
      }),
      execute: async ({ query, kind }) => {
        const rows = await ctx.runQuery(internal.knowledgeEntries.searchInternal, {
          instance,
          query,
          kind: kind ?? undefined,
          limit: 8,
        });
        return rows.map((r) => ({
          entryId: r._id,
          kind: r.kind,
          title: r.title,
          body: r.body,
          tags: r.tags ?? [],
          pinned: r.pinned === true,
        }));
      },
    }),

    listTopChats: tool({
      description:
        "List the user's top WhatsApp chats sorted by most-recent activity, with badges and unread counts. Use this as the FIRST step for: 'who needs a reply', 'what's happening in my chats', 'analyze my chats', 'top chats', 'recent chats', 'who messaged me'. After this, call `getChatMessages` with the contactIds that look most relevant (e.g. those with needsReply, urgent, or unread > 0). Returns: array of {contactId, displayName, isGroup, unreadCount, lastMessagePreview, lastMessageAt, badges: {urgent, needsReply, draftReady, deadline, meeting, mentioned}}.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .nullable()
          .describe('How many chats to return (default 20, max 50).'),
      }),
      execute: async ({ limit }) => {
        const rows = await ctx.runQuery(api.contacts.listChats, {
          instance,
          limit: limit ?? 20,
        });
        return rows.slice(0, limit ?? 20).map((row) => ({
          contactId: row.contact._id,
          displayName: row.contact.displayName ?? row.contact.remoteJid,
          isGroup: row.contact.isGroup === true,
          unreadCount: row.unreadCount,
          lastMessagePreview: preview(row.lastMessage?.text ?? ''),
          lastMessageAt: row.lastMessage?.timestamp ?? null,
          lastMessageFromMe: row.lastMessage?.fromMe ?? null,
          badges: row.badges,
          priority: row.priority,
        }));
      },
    }),

    getChatMessages: tool({
      description:
        "Fetch recent messages from a single chat so you can analyze them. ALWAYS use after `listTopChats` (which gives you contactIds) or after `findContactByName`. Use for: 'what did they say', 'summarize the chat with X', 'why does this chat need a reply'. Returns: array of {messageId, fromMe, text, timestamp, category, needsReply, isUrgent, sender} ordered most recent first.",
      inputSchema: z.object({
        contactId: z
          .string()
          .describe("The chat's contactId (from listTopChats or findContactByName)."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .nullable()
          .describe('How many recent messages to fetch (default 15, max 50).'),
      }),
      execute: async ({ contactId, limit }) => {
        const numItems = Math.min(Math.max(limit ?? 15, 1), 50);
        const page = await ctx.runQuery(api.messages.listForContact, {
          contactId: contactId as Id<'contacts'>,
          paginationOpts: { numItems, cursor: null },
        });
        return page.page.map((m) => ({
          messageId: m._id,
          fromMe: m.fromMe,
          text: preview(m.text),
          timestamp: m.timestamp,
          category: m.category ?? null,
          needsReply: m.needsReply === true,
          isUrgent: m.isUrgent === true,
          sender: m.sender,
        }));
      },
    }),

    searchMessages: tool({
      description:
        "Search WhatsApp messages. Use for: 'find messages about X', 'what did <Name> say about Y', 'show me the message about Z', 'what deadlines do I have', 'what documents did I get', 'where was I mentioned'. Categories are: greeting, meeting, deadline, payment, client_issue, project_update, school, family, document, image, voice, group_announcement, spam, unknown. Returns: array of {messageId, contactId, contactName, preview, timestamp}.",
      inputSchema: z.object({
        keyword: z
          .string()
          .nullable()
          .describe(
            'Full-text keyword to match. Null = match anything (category/contact filter only).',
          ),
        contactId: z
          .string()
          .nullable()
          .describe(
            'Filter to one contact (use findContactByName first to get the id). Null = all contacts.',
          ),
        category: z
          .enum([
            'greeting',
            'meeting',
            'deadline',
            'payment',
            'client_issue',
            'project_update',
            'school',
            'family',
            'document',
            'image',
            'voice',
            'group_announcement',
            'spam',
            'unknown',
          ])
          .nullable()
          .describe('Filter by classified category. Null = any category.'),
        sinceMs: z
          .number()
          .nullable()
          .describe('Lower bound epoch-ms. Null = default last 7 days.'),
        limit: z.number().int().min(1).max(50).nullable().describe('Max rows (default 25).'),
      }),
      execute: async (args) => {
        const sinceMs = args.sinceMs ?? Date.now() - DEFAULT_WINDOW_MS;
        // Two paths: keyword search via the search index, or list-by-range with
        // category filter.
        if (args.keyword && args.keyword.trim().length > 0) {
          const results = await ctx.runQuery(api.messages.searchMessages, {
            instance,
            queryText: args.keyword,
            contactId: (args.contactId ?? undefined) as Id<'contacts'> | undefined,
            sinceMs,
            category: args.category ?? undefined,
            limit: args.limit ?? 25,
          });
          return enrichMessages(ctx, results);
        }
        // No keyword — range scan + filter.
        const rows = await ctx.runQuery(internal.messages.listForInstanceInRange, {
          instance,
          sinceMs,
          contactId: (args.contactId ?? undefined) as Id<'contacts'> | undefined,
          includeFromMe: false,
          limit: 200,
        });
        const filtered = args.category ? rows.filter((m) => m.category === args.category) : rows;
        return enrichMessages(ctx, filtered.slice(0, args.limit ?? 25));
      },
    }),

    listDrafts: tool({
      description:
        "List reply drafts waiting in the Approvals queue — replies Bimi wrote that the user has not sent yet. Use for: 'what's in my approvals', 'what drafts are waiting', 'anything pending approval', 'what have you written for me'. This is the ONLY source of draftId, so call it before `sendDraft` or `rejectDraft`. Returns: array of {draftId, contactId, contactName, text, priority, reason, createdAt}. Empty array = queue is clear. NOTE: these are unsent drafts — for messages other people are waiting on you to answer, use `listNeedsReply` instead.",
      inputSchema: z.object({
        priority: z
          .enum(['urgent', 'high', 'normal', 'low'])
          .nullable()
          .describe('Only drafts at this priority. Null = all priorities.'),
        limit: z.number().int().min(1).max(50).nullable().describe('Max rows (default 20).'),
      }),
      execute: async (args) => {
        const rows = await ctx.runQuery(api.drafts.listQueue, {
          instance,
          priority: args.priority ?? undefined,
          limit: args.limit ?? 20,
        });
        return rows.map((row) => ({
          draftId: row.draft._id,
          contactId: row.draft.contactId,
          contactName: row.contactDisplayName,
          text: preview(row.draft.text),
          priority: row.draft.priority ?? null,
          reason: row.draft.reason ?? null,
          createdAt: row.draft._creationTime,
        }));
      },
    }),

    listReminders: tool({
      description:
        "List the user's reminders — timed nudges that fire a push notification at a set moment. Use for: 'what reminders do I have', 'what am I being reminded about', 'my nudges'. This is the ONLY source of reminderId, so call it before `dismissReminder`. Returns: array of reminder rows with {_id, text, remindAt, contactId, status}. NOTE: reminders are time-triggered alarms; for the user's checklist of things to do use `listTasks`.",
      inputSchema: z.object({
        status: z
          .enum(['pending', 'suggested', 'fired', 'dismissed'])
          .nullable()
          .describe(
            "Filter by status. Null = pending only (the useful default). 'suggested' = Bimi proposed it and the user has not accepted it yet.",
          ),
        limit: z.number().int().min(1).max(50).nullable().describe('Max rows (default 20).'),
      }),
      execute: async (args) =>
        ctx.runQuery(api.reminders.list, {
          instance,
          status: args.status ?? 'pending',
          limit: args.limit ?? 20,
        }),
    }),

    searchMemories: tool({
      description:
        "Search what Bimi has remembered about the user and their contacts — durable facts, preferences, commitments, and relationship notes. The most relevant memories are already injected into your context each turn, so only call this when the user asks about memory itself ('what do you remember about Alvin', 'what do you know about me', 'do you remember X'), or when you need a memoryId for `forgetMemory`. Returns: array of {_id, scope, type, content, contactId, pinned, createdAt}.",
      inputSchema: z.object({
        query: z
          .string()
          .nullable()
          .describe('Keyword to match in memory content. Null = list everything in scope.'),
        contactId: z
          .string()
          .nullable()
          .describe(
            'Only memories about this contact (from findContactByName). Null = all, including memories about the user themselves.',
          ),
        limit: z.number().int().min(1).max(50).nullable().describe('Max rows (default 20).'),
      }),
      execute: async (args) =>
        ctx.runQuery(api.memories.list, {
          instance,
          status: 'active',
          query: args.query ?? undefined,
          contactId: (args.contactId ?? undefined) as Id<'contacts'> | undefined,
          limit: args.limit ?? 20,
        }),
    }),

    getContactProfile: tool({
      description:
        "Get everything Bimi knows about one contact in a single call: how they're classified (relationship, priority, muted, AI mode), their unread and needs-reply counts, and the rolling AI-written profile of who they are and what's going on with them. Use for: 'tell me about Alvin', 'who is Sarah', 'what's my history with X', 'how do I usually talk to him', 'catch me up on this person'. Call `findContactByName` first to get the contactId. Returns: {contact: {...}, profile: {summary, updatedAt} | null}. Prefer this over `getChatMessages` when the user asks about the PERSON rather than about specific messages.",
      inputSchema: z.object({
        contactId: z
          .string()
          .describe('Contact id from findContactByName, listTopChats, or getChatMessages.'),
      }),
      execute: async ({ contactId }) => {
        const id = contactId as Id<'contacts'>;
        const [contact, profile] = await Promise.all([
          ctx.runQuery(api.contacts.getContact, { contactId: id }),
          ctx.runQuery(api.contactMemory.getProfile, { contactId: id }),
        ]);
        if (!contact) return { error: 'Contact not found' };
        return {
          contact: {
            contactId: contact._id,
            name: contact.displayName ?? contact.pushName ?? contact.normalizedPhone,
            isGroup: contact.isGroup ?? false,
            relationship: contact.relationship ?? 'unknown',
            priority: contact.priority ?? 'normal',
            muted: contact.muted ?? false,
            aiMode: contact.aiMode ?? null,
            checkInCadenceDays: contact.checkInCadenceDays ?? null,
            unreadCount: contact.unreadCount ?? 0,
            unreadNeedsReply: contact.unreadNeedsReply ?? 0,
            lastUserMessageAt: contact.lastUserMessageAt ?? null,
            memoryEnabled: contact.memoryEnabled !== false,
          },
          profile: profile ? { summary: profile.summary, updatedAt: profile.updatedAt } : null,
        };
      },
    }),

    askAcrossChats: tool({
      description:
        "Ask a question that spans MANY chats at once and get a synthesised answer. Use when the user asks about a topic without naming a person: 'has anyone mentioned the Accra trip', 'what are people saying about the launch', 'did anybody send me an invoice this week', 'who talked about the deadline'. This reads across every conversation and costs a full model call, so prefer `searchMessages` for a plain keyword hunt and `getChatMessages` when the user names one person. Returns: {answer, sources}.",
      inputSchema: z.object({
        question: z
          .string()
          .min(1)
          .describe("The user's question, rephrased as a clear standalone question."),
        sinceMs: z.number().nullable().describe('Lower bound epoch-ms. Null = last 7 days.'),
      }),
      execute: async (args) =>
        ctx.runAction(api.summaries.askAcrossChats, {
          instance,
          question: args.question,
          sinceMs: args.sinceMs ?? undefined,
        }),
    }),
  };
}

/**
 * Write/destructive tools. Each one queues an Allow/Deny confirmation row in
 * the thread and returns immediately — the actual mutation runs inside
 * `assistant.resolveConfirmation` when the user taps Allow.
 *
 * The action layer (`resolveConfirmation`) must have a matching case for
 * every toolName here, with the argument shape that matches `inputSchema`.
 */
export function buildAssistantActionTools(ctx: ActionCtx, args: ToolBuildArgs): ToolSet {
  const { threadId } = args;

  async function queueConfirmation(
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): Promise<{
    status: 'pending_confirmation';
    confirmationMessageId: string;
  }> {
    const id = (await ctx.runMutation(internal.assistant.insertAwaitingConfirmationToolInternal, {
      threadId,
      toolName,
      toolArgs,
    })) as string;
    return { status: 'pending_confirmation', confirmationMessageId: id };
  }

  return {
    sendWhatsappMessage: tool({
      description:
        "Send a WhatsApp message directly to a contact. This ACTUALLY SENDS the message (after the user taps Allow). Use for: 'reply to <name> saying X', 'send X to <name>', 'tell <name> that …'. Pass `quotedMessageId` to make it a WhatsApp quote-reply — the recipient sees the original message above your reply (the familiar 'replied to' UI in WhatsApp). ALWAYS resolve <name> with `findContactByName` first, and when replying to a specific message, pass that message's id as `quotedMessageId`. Prefer this over `draftReply` whenever the user clearly wants the message to go out.",
      inputSchema: z.object({
        contactId: z
          .string()
          .describe('Contact id from findContactByName, listTopChats, or getChatMessages.'),
        text: z
          .string()
          .min(1)
          .max(2000)
          .describe("The message text, written in the user's voice."),
        quotedMessageId: z
          .string()
          .nullable()
          .describe(
            "messageId of the original message you're replying TO (from getChatMessages or searchMessages). Null = not a quote-reply, just a regular message.",
          ),
      }),
      execute: async ({ contactId, text, quotedMessageId }) => {
        const contact = await ctx.runQuery(internal.contacts.getContactInternal, {
          contactId: contactId as Id<'contacts'>,
        });
        const contactName =
          contact?.displayName ?? contact?.pushName ?? contact?.normalizedPhone ?? null;
        let quotedPreview: string | null = null;
        let quotedWamid: string | null = null;
        let quotedFromMe: boolean | null = null;
        if (quotedMessageId) {
          const qm = await ctx.runQuery(api.messages.getMessage, {
            messageId: quotedMessageId as Id<'messages'>,
          });
          if (qm) {
            quotedPreview = (qm.text ?? '').slice(0, 200);
            quotedWamid = qm.messageId;
            quotedFromMe = qm.fromMe;
          }
        }
        return queueConfirmation('sendWhatsappMessage', {
          contactId,
          text,
          contactName,
          quotedMessageId,
          quotedWamid,
          quotedPreview,
          quotedFromMe,
        });
      },
    }),

    draftReply: tool({
      description:
        "Save a DRAFT WhatsApp reply for the user to review later in the Approvals tab — does NOT send. Use this only when the user explicitly wants to defer ('draft a reply', 'queue up a reply', 'I'll review it later'). When in doubt, use `sendWhatsappMessage` instead — the Allow/Deny prompt is already the safety gate.",
      inputSchema: z.object({
        contactId: z.string().describe('Contact id from findContactByName or listTopChats.'),
        text: z.string().min(1).max(2000).describe("The reply text in the user's voice."),
      }),
      execute: async ({ contactId, text }) => {
        const contactName = await loadContactName(ctx, contactId as Id<'contacts'>, new Map());
        return queueConfirmation('draftReply', { contactId, text, contactName });
      },
    }),

    createTask: tool({
      description:
        "Add an item to the user's todo list. Use for: 'add a task', 'I need to follow up on X', 'put X on my list', 'donât let me forget to X'. This is a checklist entry with an optional due date â it does NOT fire a notification. If the user names a specific time they want to be alerted ('remind me at 3pm'), use `createReminder`. If they want Bimi to message someone repeatedly, use `createContactGoal`.",
      inputSchema: z.object({
        title: z.string().min(1).max(200).describe('Short task title.'),
        dueAt: z.number().nullable().describe('Epoch ms when the task is due. Null = no due date.'),
        contactId: z.string().nullable().describe('Optional contactId this task relates to.'),
      }),
      execute: async ({ title, dueAt, contactId }) => {
        const contactName = contactId
          ? await loadContactName(ctx, contactId as Id<'contacts'>, new Map())
          : null;
        return queueConfirmation('createTask', {
          title,
          dueAt,
          contactId,
          contactName,
        });
      },
    }),

    markTaskDone: tool({
      description:
        "Mark a task complete, keeping it in the user's history. Use for: 'mark X done', 'I finished X', 'thatâs handled', 'tick off X'. The taskId MUST come from `listTasks` â call it first if you donât already have the id from this conversation.",
      inputSchema: z.object({
        taskId: z.string().describe('Task id from listTasks.'),
      }),
      execute: async ({ taskId }) => {
        const task = await ctx.runQuery(internal.tasks.getTaskInternal, {
          taskId: taskId as Id<'tasks'>,
        });
        return queueConfirmation('markTaskDone', {
          taskId,
          taskTitle: task?.title ?? null,
        });
      },
    }),

    markNeedsReply: tool({
      description:
        "Flag (or un-flag) an incoming message as needing a reply. Use for: 'remind me to reply to this', 'I already replied to that'. messageId comes from listNeedsReply, listTopChats's lastMessage, or getChatMessages.",
      inputSchema: z.object({
        messageId: z.string().describe('Message id.'),
        value: z.boolean().describe('true = mark needs reply, false = clear the flag.'),
      }),
      execute: async ({ messageId, value }) =>
        queueConfirmation('markNeedsReply', { messageId, value }),
    }),

    acceptMeeting: tool({
      description:
        'Accept a pending meeting. meetingId comes from listMeetings.pending. Optionally pass a specific startAt (epoch ms) to pick one of the proposed times.',
      inputSchema: z.object({
        meetingId: z.string().describe('Meeting id from listMeetings.'),
        startAt: z.number().nullable().describe('Optional chosen start time (epoch ms).'),
      }),
      execute: async ({ meetingId, startAt }) => {
        const meeting = await ctx.runQuery(internal.meetings.getMeetingInternal, {
          meetingId: meetingId as Id<'meetings'>,
        });
        const contactName = meeting
          ? await loadContactName(ctx, meeting.contactId, new Map())
          : null;
        return queueConfirmation('acceptMeeting', {
          meetingId,
          startAt,
          contactName,
          meetingTitle: meeting?.title ?? null,
        });
      },
    }),

    declineMeeting: tool({
      description:
        "Decline a pending meeting proposal. Use for: 'decline that meeting', 'I canât make it', 'say no to the call'. The meetingId MUST come from `listMeetings`.pending. To suggest a different time instead of refusing outright, decline only if the user clearly wants out.",
      inputSchema: z.object({
        meetingId: z.string().describe('Meeting id from listMeetings.'),
      }),
      execute: async ({ meetingId }) => {
        const meeting = await ctx.runQuery(internal.meetings.getMeetingInternal, {
          meetingId: meetingId as Id<'meetings'>,
        });
        const contactName = meeting
          ? await loadContactName(ctx, meeting.contactId, new Map())
          : null;
        return queueConfirmation('declineMeeting', {
          meetingId,
          contactName,
          meetingTitle: meeting?.title ?? null,
        });
      },
    }),

    rejectDraft: tool({
      description:
        "Discard a queued draft reply and clear the needs-reply flag on the message it answered. Use for: 'reject the draft for X', 'Iâll handle this one myself', 'bin that draft'. The draftId MUST come from `listDrafts`. To SEND the draft instead, use `sendDraft`.",
      inputSchema: z.object({
        draftId: z.string().describe('Draft id.'),
      }),
      execute: async ({ draftId }) => queueConfirmation('rejectDraft', { draftId }),
    }),

    deleteTask: tool({
      description:
        "Permanently delete a task from the user's list. Use for: 'delete X', 'remove X from my list', 'that task is not relevant any more'. The taskId MUST come from `listTasks`. If the user has actually FINISHED the task, use `markTaskDone` instead so it stays in their history. This cannot be undone.",
      inputSchema: z.object({
        taskId: z.string().describe('Task id from listTasks.'),
      }),
      execute: async ({ taskId }) => {
        const task = await ctx.runQuery(internal.tasks.getTaskInternal, {
          taskId: taskId as Id<'tasks'>,
        });
        return queueConfirmation('deleteTask', {
          taskId,
          taskTitle: task?.title ?? null,
        });
      },
    }),

    dismissReminder: tool({
      description:
        "Permanently dismiss a reminder so it never fires. Use for: 'cancel that reminder', 'I don't need the nudge about X', 'drop the reminder'. The reminderId MUST come from `listReminders` — call that first. This cannot be undone.",
      inputSchema: z.object({
        reminderId: z.string().describe('Reminder id from listReminders.'),
      }),
      execute: async ({ reminderId }) => {
        const reminder = await ctx.runQuery(internal.reminders.getReminderInternal, {
          reminderId: reminderId as Id<'reminders'>,
        });
        return queueConfirmation('dismissReminder', {
          reminderId,
          reminderText: reminder?.text ?? null,
        });
      },
    }),

    createReminder: tool({
      description:
        "Set a timed reminder that fires a push notification at a specific moment. Use ONLY when the user names a time: 'remind me at 3pm to call him', 'nudge me tomorrow morning about the invoice', 'ping me in an hour'. If they just want something on their list with no alarm ('add a task', 'I need to follow up on X'), use `createTask` instead. If they want Bimi to actually message someone repeatedly until something happens, use `createContactGoal`.",
      inputSchema: z.object({
        text: z
          .string()
          .min(1)
          .max(300)
          .describe("What to remind the user about, phrased as the notification they'll read."),
        remindAt: z
          .number()
          .describe(
            "Epoch ms when it should fire. Required — resolve relative phrasing ('tomorrow 9am', 'in 2 hours') against the current time given in your system prompt.",
          ),
        contactId: z
          .string()
          .nullable()
          .describe(
            'Contact this reminder is about, from findContactByName. Null if not about anyone.',
          ),
      }),
      execute: async ({ text, remindAt, contactId }) => {
        const contactName = contactId
          ? await loadContactName(ctx, contactId as Id<'contacts'>, new Map())
          : null;
        return queueConfirmation('createReminder', {
          text,
          remindAt,
          contactId,
          contactName,
        });
      },
    }),

    sendDraft: tool({
      description:
        "Send a reply draft that is already sitting in the Approvals queue, exactly as written. Use for: 'send the draft for Alvin', 'approve that draft', 'yes send it' when a specific queued draft is in play. The draftId MUST come from `listDrafts`. To send NEW text you composed yourself, use `sendWhatsappMessage` instead — this tool only sends what is already stored.",
      inputSchema: z.object({
        draftId: z.string().describe('Draft id from listDrafts.'),
      }),
      execute: async ({ draftId }) => {
        const draft = await ctx.runQuery(internal.drafts.getDraftInternal, {
          draftId: draftId as Id<'drafts'>,
        });
        const contactName = draft ? await loadContactName(ctx, draft.contactId, new Map()) : null;
        return queueConfirmation('sendDraft', {
          draftId,
          contactName,
          text: draft?.text ?? null,
        });
      },
    }),

    rememberThis: tool({
      description:
        "Save a durable memory about the user or one of their contacts. These are injected into your context on every future turn, so this is how you learn. Use for: 'remember that ...', 'don't forget ...', 'note that Alvin prefers short updates', 'I'm allergic to ...', 'my sister's birthday is ...'. Also use it proactively when the user states a lasting personal fact, preference or commitment in passing. For reference material with a title and body — a URL, a message template, project notes, client details — use `saveKnowledge` instead.",
      inputSchema: z.object({
        content: z
          .string()
          .min(1)
          .max(500)
          .describe(
            "The fact, written as a standalone sentence that will still make sense months later. Good: 'Alvin prefers short, bullet-point updates.' Bad: 'he likes it short.'",
          ),
        scope: z
          .enum(['user', 'contact'])
          .describe(
            "'user' = about the user themselves (their life, preferences, commitments). 'contact' = about another person; requires contactId.",
          ),
        type: z
          .enum(['fact', 'preference', 'commitment', 'ongoing', 'relationship'])
          .describe(
            "'fact' = stable truth. 'preference' = how they like things done. 'commitment' = something promised, usually time-bound. 'ongoing' = a situation currently in motion. 'relationship' = how two people relate.",
          ),
        contactId: z
          .string()
          .nullable()
          .describe(
            "Required when scope is 'contact'. From findContactByName. Null for scope 'user'.",
          ),
      }),
      execute: async ({ content, scope, type, contactId }) => {
        const contactName = contactId
          ? await loadContactName(ctx, contactId as Id<'contacts'>, new Map())
          : null;
        return queueConfirmation('rememberThis', {
          content,
          scope,
          type,
          contactId,
          contactName,
        });
      },
    }),

    forgetMemory: tool({
      description:
        "Permanently delete one stored memory. Use for: 'forget that', 'that's not true any more', 'stop remembering X'. The memoryId MUST come from `searchMemories` — call it first and, if more than one memory could match, use `askUserForChoice` to confirm which one before deleting. This cannot be undone.",
      inputSchema: z.object({
        memoryId: z.string().describe('Memory id from searchMemories.'),
      }),
      execute: async ({ memoryId }) => {
        const memory = await ctx.runQuery(internal.memories.getMemoryInternal, {
          memoryId: memoryId as Id<'memories'>,
        });
        return queueConfirmation('forgetMemory', {
          memoryId,
          content: memory?.content ?? null,
        });
      },
    }),

    saveKnowledge: tool({
      description:
        "Save a reference entry to the knowledge base — something with a title and a body that you'll look up later with `searchKnowledge`. Use for: 'save this URL as ...', 'here's my standard intro template', 'note these project details', 'my availability is ...'. The difference from `rememberThis`: knowledge is reference material you quote back (a link, a template, a spec); a memory is a personal fact that shapes how you behave. If the user says 'remember', pick by what the content IS, not by the verb they used.",
      inputSchema: z.object({
        title: z
          .string()
          .min(1)
          .max(120)
          .describe("Short, searchable name. Example: 'Wartech staging URL'."),
        body: z
          .string()
          .min(1)
          .max(4000)
          .describe('The content itself — the actual URL, template text, or notes.'),
        kind: z
          .enum(['project', 'url', 'template', 'client_note', 'availability', 'note'])
          .describe(
            "Category, used to filter searches. 'note' is the catch-all when nothing else fits.",
          ),
        pinned: z
          .boolean()
          .describe(
            'true = always keep in your context (use sparingly, for things needed constantly). false = only surfaced by searchKnowledge.',
          ),
      }),
      execute: async ({ title, body, kind, pinned }) =>
        queueConfirmation('saveKnowledge', { title, body, kind, pinned }),
    }),

    updateChatSettings: tool({
      description:
        "Change how Bimi treats one chat: importance, mute state, relationship label, how autonomously it may reply, and how often to check in. Use for: 'mark Alvin as a client', 'this is a VIP', 'mute the school group', 'stop auto-replying to her', 'put this chat on full auto', 'remind me to check on my mum every 2 weeks'. Pass ONLY the fields the user actually asked to change — every field is optional and null means leave it alone. Call `findContactByName` first.",
      inputSchema: z.object({
        contactId: z.string().describe('Contact id from findContactByName or listTopChats.'),
        priority: z
          .enum(['urgent', 'high', 'normal', 'low'])
          .nullable()
          .describe('How much this chat should stand out in briefings. Null = unchanged.'),
        muted: z
          .boolean()
          .nullable()
          .describe('true = no notifications from this chat. Null = unchanged.'),
        relationship: z
          .enum([
            'vip',
            'client',
            'family',
            'friend',
            'classmate',
            'team',
            'low_priority',
            'unknown',
          ])
          .nullable()
          .describe('Who this person is to the user; shapes tone and urgency. Null = unchanged.'),
        aiMode: z
          .enum(['manual', 'semi_auto', 'full_auto', 'silent'])
          .nullable()
          .describe(
            "'manual' = Bimi only drafts, never sends. 'semi_auto' = auto-sends simple pleasantries, drafts the rest. 'full_auto' = Bimi replies on its own. 'silent' = Bimi ignores this chat entirely. Null = unchanged.",
          ),
        checkInCadenceDays: z
          .number()
          .int()
          .min(1)
          .max(365)
          .nullable()
          .describe('Nudge the user to check in on this person every N days. Null = unchanged.'),
      }),
      execute: async (input) => {
        const contactName = await loadContactName(
          ctx,
          input.contactId as Id<'contacts'>,
          new Map(),
        );
        return queueConfirmation('updateChatSettings', { ...input, contactName });
      },
    }),

    createContactGoal: tool({
      description:
        "Give Bimi a standing objective for one contact that it pursues over time, sending messages on its own schedule until the goal is met. Use for: 'check on my mum every week until she says she's okay', 'keep following up with Alvin until he sends the invoice', 'ask the team for a status update every Monday'. This is the strongest action available — it messages someone repeatedly without asking again — so only use it when the user clearly wants ONGOING outreach, not a single message (`sendWhatsappMessage`), a personal alarm (`createReminder`), or a checklist item (`createTask`).",
      inputSchema: z.object({
        contactId: z.string().describe('Contact id from findContactByName.'),
        title: z
          .string()
          .min(1)
          .max(120)
          .describe("Short name for the goal. Example: 'Weekly check-in with Mum'."),
        instructions: z
          .string()
          .min(1)
          .max(1000)
          .describe(
            "What Bimi should actually say and aim for, in the user's voice. Be specific about tone and what counts as progress.",
          ),
        kind: z
          .enum(['check_in', 'meeting', 'relationship', 'custom'])
          .describe(
            "'check_in' = see how they're doing. 'meeting' = get something scheduled. 'relationship' = stay warm. 'custom' = anything else.",
          ),
        recurrence: z
          .enum(['once', 'daily', 'weekly', 'interval', 'until_done'])
          .describe(
            "How often to act. 'until_done' = keep nudging until successCriteria is met. 'interval' requires intervalHours.",
          ),
        intervalHours: z
          .number()
          .int()
          .min(1)
          .nullable()
          .describe(
            "Hours between attempts. Required when recurrence is 'interval', otherwise null.",
          ),
        successCriteria: z
          .string()
          .max(300)
          .nullable()
          .describe(
            "How Bimi knows it's finished, e.g. 'she confirms she's feeling better'. Strongly recommended for 'until_done'.",
          ),
        mode: z
          .enum(['draft', 'auto'])
          .describe(
            "'draft' = every message lands in Approvals for the user to send (safe default). 'auto' = Bimi sends without asking each time. Use 'auto' only if the user explicitly says so.",
          ),
      }),
      execute: async (input) => {
        const contactName = await loadContactName(
          ctx,
          input.contactId as Id<'contacts'>,
          new Map(),
        );
        return queueConfirmation('createContactGoal', { ...input, contactName });
      },
    }),

    markActionPlanItemDone: tool({
      description:
        "Mark one item in today's action plan as done. Use for: 'mark #2 done', 'I handled the first one', 'check off item 3'. summaryId + order come from `getBriefing` (summary row's `_id` and the item's `order` field).",
      inputSchema: z.object({
        summaryId: z.string().describe('Daily summary id from getBriefing._id.'),
        order: z
          .number()
          .int()
          .min(1)
          .describe('1-based index of the action plan item to mark done.'),
      }),
      execute: async ({ summaryId, order }) =>
        queueConfirmation('markActionPlanItemDone', { summaryId, order }),
    }),
  };
}
