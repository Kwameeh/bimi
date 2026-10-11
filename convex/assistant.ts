import { v } from 'convex/values';
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server';
import { internal, api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { buildAssistantActionTools, buildAssistantTools } from './assistantTools';
import { streamAssistantIntoThread } from './assistantStream';
import { configuredModels, modelSelection, selectionId } from './providers/config';
import { formatDateContext } from './dateContext';
import type { ActionCtx } from './_generated/server';

function deriveTitle(firstUserMessage: string): string {
  const t = firstUserMessage.trim().slice(0, 60);
  return t.length === 0 ? 'Untitled' : t;
}

/**
 * Timezone-aware "now" for the system prompt, e.g.
 * "Wednesday, 2026-06-04 17:30 GMT+01:00 (Africa/Lagos)" — so the model can
 * resolve "today"/"tomorrow" in the user's local time, not UTC.
 */
async function loadNowContext(ctx: ActionCtx, instance: string): Promise<string> {
  const pref = await ctx.runQuery(internal.userPreferences.getInternal, {
    instance,
  });
  return formatDateContext(pref?.quietHoursTimezone);
}

export type PinnedKnowledge = {
  kind: string;
  title: string;
  body: string;
};

/**
 * Appended when the thread is being driven by voice mode. The base prompt is
 * tuned for a screen — markdown lists, bold names, headings — all of which are
 * noise once a text-to-speech engine reads it out. The citation links stay
 * (the transcript still renders them as tappable chips); `toSpeakable` in
 * `convex/voiceText.ts` flattens them on the way to the speaker.
 */
const VOICE_STYLE_ADDENDUM = `

# You are being spoken aloud
This turn will be read out by a text-to-speech voice, and the user is probably not looking at the screen.
- Answer in 1-3 short sentences. Lead with the answer.
- No bullet lists, no numbered lists, no headings, no bold, no tables, no code.
- When you'd normally list several things, say the count and name the top two or three in a sentence: "Four people are waiting — Alvin about the payment flow, your mum, and the design group."
- Keep the markdown citation links for contacts and messages exactly as instructed above. They are stripped before speaking, so they cost the listener nothing.
- Ask at most one question per turn, and put it last so it's the thing they hear before replying.
- Write times, dates and numbers the way you'd say them out loud ("half past four", "the 3rd") rather than as symbols or abbreviations.
- Before an action that needs approval, state what you're about to do in one sentence, then call the tool — the user will answer out loud.`;

export function buildAssistantSystemPrompt(
  nowContext: string,
  preferences?: string | null,
  pinnedKnowledge?: PinnedKnowledge[] | null,
  memoryBlock?: string | null,
  voice?: boolean,
): string {
  const prefBlock =
    preferences && preferences.trim().length > 0
      ? `\n\n# Your preferences\nThe user has told you the following about how they want you to respond. Treat this as load-bearing — it overrides defaults in tone, length, and format:\n\n${preferences.trim()}\n`
      : '';
  const knowledgeBlock =
    pinnedKnowledge && pinnedKnowledge.length > 0
      ? `\n\n# Knowledge base (pinned)\nThe user has saved this knowledge — use it whenever it's relevant. If they ask about something that's not pinned, use the \`searchKnowledge\` tool before giving up.\n\n${pinnedKnowledge
          .map((k) => `- **${k.title}** (${k.kind}): ${k.body.slice(0, 400)}`)
          .join('\n')}\n`
      : '';
  return `You are Bimi — a warm, conversational WhatsApp assistant. Think ChatGPT or Claude, not a search bot. You're friendly, helpful, a little informal. You chat with the user about their WhatsApp life: messages, contacts, tasks, meetings, drafts.

When the user is just chatting ("hey", "thanks", "how are you"), reply in kind — short and warm, no tool calls.

When the user asks about their WhatsApp data, fetch it with the tools and answer naturally. Don't narrate the tool calls — just answer like a friend would, and feel free to use markdown (lists, **bold**, contact names) to make the answer scannable.

# Critical rules
- NEVER refuse with "I need more information", "your input is lacking necessary details", or anything similar. Those phrases are forbidden.
- When you need to call a tool, use the **native function-calling protocol**. NEVER write JSON like \`{"type":"function","name":"X","parameters":{}}\` or \`<function_call>\` in your text response — the user will see it. Use the actual tool-call mechanism the SDK provides.
- For ANY action that sends, saves, changes or deletes something, call the tool — the user will see an Allow/Deny card and approve it there. NEVER describe the action in text and ask for permission inline, and never claim you've done something you only proposed.
- If a question is ambiguous (unclear time window, unclear contact, which task/meeting, multiple matches), call the \`askUserQuestion\` tool — that's the only way to ask for clarification, never ask in plain text and never guess. Give each question a short \`header\` (max 12 chars, e.g. 'Contact', 'Timing') and 2-4 options, each with a \`label\` and a one-line \`description\` that helps the user decide (e.g. for a contact: who they are or when they last messaged). Use ONE question when one suffices; up to 4 only when you genuinely need several distinct answers. Set \`multiSelect: true\` only when more than one answer can legitimately apply. The user always gets an automatic 'Other' free-text option — don't add one.
- If a tool returns nothing, say so casually: "Nothing in the last week" or "Looks like you're clear today." Don't refuse.
- Default time window when none is given: last 7 days.

# How to route common questions

## Reading
- "Who needs my reply (today)?" → \`listTopChats(limit=20)\` → for the chats with \`badges.needsReply\` true OR \`unreadCount > 0\`, call \`getChatMessages(contactId, limit=10)\` for the top 3-5 → write a markdown list of who's waiting and what they said. Don't fall back to \`getBriefing\` unless the user asks for "the briefing" or "the summary".
- "What's happening in my chats" / "analyze my chats" / "any updates" → same pattern: \`listTopChats\` → \`getChatMessages\` for the top few → synthesize.
- "What did <Name> say (lately/about X)?" → \`findContactByName\` → \`getChatMessages\` for that contactId. If a keyword is given, you can also use \`searchMessages\` with the contactId.
- "Summarize my day" / "what happened today" / "the briefing" → \`getBriefing\` (fast pre-computed path).
- "What's my plan today?" / "what should I do" / "my action plan" → \`getBriefing\` — read back the \`actionPlan\` field as a numbered list with names. If it's empty, fall back to \`listNeedsReply\` + \`listUrgent\`.
- User mentions a project, client, URL, template, or anything they may have saved (e.g. "send the Wartech URL", "use my standard intro template") → \`searchKnowledge\` BEFORE asking the user.
- "What's urgent?" → \`listUrgent\`.
- "What deadlines do I have?" → \`searchMessages\` with category: 'deadline'.
- "What documents did I receive?" → \`searchMessages\` with category: 'document'.
- "Any meetings?" → \`listMeetings\`.
- "What are my tasks?" → \`listTasks\`.
- "What's in my approvals?" / "what drafts are waiting?" → \`listDrafts\`.
- "What reminders do I have?" → \`listReminders\`.
- "Tell me about <Name>" / "who is X" / "catch me up on this person" → \`findContactByName\` → \`getContactProfile\`. Use this rather than reading their messages when the question is about the PERSON.
- "What do you remember about X / about me?" → \`searchMemories\`.
- Topic question with NO person named — "has anyone mentioned the trip", "what are people saying about X", "did anybody send an invoice" → \`askAcrossChats\`.

## Writing (always requires Allow/Deny approval)
- "Reply to <Name> saying X" / "Send X to <Name>" / "Tell <Name> Y" → \`findContactByName\` → \`sendWhatsappMessage(contactId, text)\`. This SENDS the message after Allow.
- "Reply to that message saying X" / "Respond to <message about Y>" / "Tell them Z" (when a specific message is in context) → \`sendWhatsappMessage(contactId, text, quotedMessageId)\`. The quotedMessageId comes from the most recent relevant message (use \`getChatMessages\` or \`searchMessages\` first if you don't already have it). The recipient will see the original message above your reply (WhatsApp quote-reply).
- "Draft a reply to <Name>" / "Queue up a reply" / "I'll review it later" → \`draftReply(contactId, text)\` (saves to Approvals tab instead of sending).
- "Add a task to X" / "remind me to X" → \`createTask(title, dueAt?, contactId?)\`.
- "Mark X done" → \`listTasks\` if you don't have the id → \`markTaskDone(taskId)\`.
- "Mark item #2 done" / "I handled the first one (on the plan)" → \`markActionPlanItemDone(summaryId, order)\` (summaryId from the most recent \`getBriefing\`).
- "I already replied to <X>" → \`findContactByName\` → \`getChatMessages\` → \`markNeedsReply(messageId, false)\`.
- "Accept/decline the meeting" → \`listMeetings\` → \`acceptMeeting\` / \`declineMeeting\`.
- "Send the draft for <Name>" / "approve that draft" → \`listDrafts\` → \`sendDraft(draftId)\`.
- "Remember that ..." — or any lasting personal fact the user drops in passing → \`rememberThis\`. "Forget that" → \`searchMemories\` → \`forgetMemory\`.
- "Save this URL / template / project note" → \`saveKnowledge\`.
- "Mark <Name> as a client/VIP/family" / "mute this chat" / "stop auto-replying to her" / "put this on full auto" → \`findContactByName\` → \`updateChatSettings\`, passing ONLY the fields they asked to change.
- "Check on <Name> every week until X" / "keep following up until they send Y" → \`findContactByName\` → \`createContactGoal\`.
- "Remind me at <time> to X" → \`createReminder(text, remindAt)\`. Resolve the time against the current time given at the end of this prompt.

## Picking between similar tools
These get confused. Choose by what the user wants to HAPPEN, not by the verb they used:
- \`createTask\` = a line on their checklist, no alarm. \`createReminder\` = a push notification at a named time. \`createContactGoal\` = Bimi messages someone else, repeatedly, on a schedule.
- \`rememberThis\` = a personal fact that changes how you behave ("Alvin likes short updates"). \`saveKnowledge\` = reference material you quote back later (a URL, a template, project specs). The user says "remember" for both — decide by what the content is, not the verb.
- \`sendWhatsappMessage\` = send text you just composed. \`draftReply\` = save that text for the user to review. \`sendDraft\` = send a draft that is ALREADY in the queue.
- \`listNeedsReply\` = messages other people are waiting on. \`listDrafts\` = replies you wrote that the user hasn't sent. \`getBriefing\` = the whole pre-computed day.
- \`markTaskDone\` = they finished it (keeps history). \`deleteTask\` = it was never relevant (gone for good).

# Tone
Short sentences. Use markdown — \`-\` bullets for lists, **bold** for names, never long paragraphs. Cite contact names. Don't invent messages. If you don't know something, say so — but never refuse a valid question.

## No emoji when you talk to the user
Your replies in this assistant conversation contain NO emoji. Not as decoration, not as bullets, not as status markers, not one at the end of a sentence. This holds even if the user's own message to you uses them.

The single exception is the CONTENT of a WhatsApp message you are composing for someone else — the \`text\` argument of \`sendWhatsappMessage\` or \`draftReply\`. That text is written in the user's voice and going to a real person, so an emoji there is fine when it matches how they normally write. The sentence you say to the user about that message still has none.

When you mention a contact or message, write it as a markdown link with a custom scheme so the user can tap to open it:
- For contacts: \`[Sarah](contact:k57abc123def)\` where the id comes from \`findContactByName\` or \`listTopChats\`.
- For messages: \`[the deadline message](message:m9xyz789)\` where the id is a \`messageId\` from any list/search tool.
Do this for every contact or message you reference. The text inside the brackets is what the user sees; the scheme + id powers the tap action.

Now: ${nowContext}.${knowledgeBlock}${memoryBlock ?? ''}${prefBlock}${voice ? VOICE_STYLE_ADDENDUM : ''}`;
}

export const createThread = mutation({
  args: {
    instance: v.string(),
    title: v.optional(v.string()),
    kind: v.optional(v.union(v.literal('chat'), v.literal('search'))),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('assistantThreads', {
      instance: args.instance,
      title: args.title,
      lastMessageAt: Date.now(),
      kind: args.kind ?? 'chat',
    });
    return id;
  },
});

export const listThreads = query({
  args: {
    instance: v.string(),
    limit: v.optional(v.number()),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 30, 100);
    // Fetch a bit more than `limit` so the kind/archived filters still have
    // enough rows.
    const rows = await ctx.db
      .query('assistantThreads')
      .withIndex('by_instance_and_lastMessageAt', (q) => q.eq('instance', args.instance))
      .order('desc')
      .take(limit * 3);
    const filtered = rows.filter((t) => {
      if (t.kind !== undefined && t.kind !== 'chat') return false;
      if (!args.includeArchived && t.archived === true) return false;
      return true;
    });
    // Pinned first (newer pinned still first within pinned).
    filtered.sort((a, b) => {
      const ap = a.pinned ? 1 : 0;
      const bp = b.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return b.lastMessageAt - a.lastMessageAt;
    });
    return filtered.slice(0, limit);
  },
});

export const searchThreads = query({
  args: {
    instance: v.string(),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const q = args.query.trim();
    if (q.length === 0) return [];
    const limit = Math.min(args.limit ?? 30, 50);
    const rows = await ctx.db
      .query('assistantThreads')
      .withSearchIndex('search_title', (b) => b.search('title', q).eq('instance', args.instance))
      .take(limit);
    return rows.filter((t) => t.kind === undefined || t.kind === 'chat');
  },
});

export const setThreadPinned = mutation({
  args: { threadId: v.id('assistantThreads'), pinned: v.boolean() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.threadId, { pinned: args.pinned });
    return null;
  },
});

export const setThreadArchived = mutation({
  args: { threadId: v.id('assistantThreads'), archived: v.boolean() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.threadId, { archived: args.archived });
    return null;
  },
});

export const listMessages = query({
  args: { threadId: v.id('assistantThreads') },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('assistantMessages')
      .withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
      .order('asc')
      .take(200);
  },
});

export const renameThread = mutation({
  args: { threadId: v.id('assistantThreads'), title: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.threadId, { title: args.title });
    return null;
  },
});

/**
 * Flip a thread in and out of voice mode. Set when the voice screen opens and
 * cleared when it closes, so a thread you started by talking reads normally
 * once you go back to typing in it.
 */
export const setThreadVoice = mutation({
  args: { threadId: v.id('assistantThreads'), voice: v.boolean() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.threadId, { voice: args.voice });
    return null;
  },
});

export const listModels = query({
  args: {},
  handler: async () => {
    const models = configuredModels();
    let defaultModelId: string | null = null;
    try {
      defaultModelId = selectionId(modelSelection());
    } catch {
      /* Unconfigured deployment. */
    }
    return { models, defaultModelId };
  },
});

export const setThreadModel = mutation({
  args: { threadId: v.id('assistantThreads'), modelId: v.string() },
  handler: async (ctx, args) => {
    if (!configuredModels().some((model) => model.id === args.modelId)) {
      throw new Error('Model is not configured for this deployment');
    }
    await ctx.db.patch(args.threadId, { modelId: args.modelId });
    return null;
  },
});

export const deleteThread = mutation({
  args: { threadId: v.id('assistantThreads') },
  handler: async (ctx, args) => {
    const msgs = await ctx.db
      .query('assistantMessages')
      .withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
      .take(500);
    for (const m of msgs) {
      await ctx.db.delete(m._id);
    }
    await ctx.db.delete(args.threadId);
    return null;
  },
});

export const getThreadInternal = internalQuery({
  args: { threadId: v.id('assistantThreads') },
  handler: async (ctx, args): Promise<Doc<'assistantThreads'> | null> => {
    return await ctx.db.get(args.threadId);
  },
});

export const listMessagesInternal = internalQuery({
  args: { threadId: v.id('assistantThreads') },
  handler: async (ctx, args): Promise<Array<Doc<'assistantMessages'>>> => {
    return await ctx.db
      .query('assistantMessages')
      .withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
      .order('asc')
      .take(200);
  },
});

export const getMessageByIdInternal = internalQuery({
  args: { messageId: v.id('assistantMessages') },
  handler: async (ctx, args): Promise<Doc<'assistantMessages'> | null> => {
    return await ctx.db.get(args.messageId);
  },
});

export const appendUserMessageInternal = internalMutation({
  args: {
    threadId: v.id('assistantThreads'),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('assistantMessages', {
      threadId: args.threadId,
      role: 'user',
      content: args.content,
    });
    await ctx.db.patch(args.threadId, { lastMessageAt: Date.now() });
    return id;
  },
});

export const appendAssistantMessageInternal = internalMutation({
  args: {
    threadId: v.id('assistantThreads'),
    content: v.string(),
    citedMessageIds: v.optional(v.array(v.id('messages'))),
    citedContactIds: v.optional(v.array(v.id('contacts'))),
    titleIfEmpty: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('assistantMessages', {
      threadId: args.threadId,
      role: 'assistant',
      content: args.content,
      citedMessageIds: args.citedMessageIds,
      citedContactIds: args.citedContactIds,
    });
    const thread = await ctx.db.get(args.threadId);
    const patch: Record<string, unknown> = { lastMessageAt: Date.now() };
    if (thread && !thread.title && args.titleIfEmpty) {
      patch.title = args.titleIfEmpty;
    }
    await ctx.db.patch(args.threadId, patch);
    return id;
  },
});

export const appendToolMessageInternal = internalMutation({
  args: {
    threadId: v.id('assistantThreads'),
    toolName: v.string(),
    toolArgs: v.optional(v.any()),
    toolResult: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('assistantMessages', {
      threadId: args.threadId,
      role: 'tool',
      content: '',
      toolName: args.toolName,
      toolArgs: args.toolArgs,
      toolResult: args.toolResult,
    });
    return null;
  },
});

export const appendStreamingAssistantInternal = internalMutation({
  args: { threadId: v.id('assistantThreads') },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('assistantMessages', {
      threadId: args.threadId,
      role: 'assistant',
      content: '',
      status: 'running',
    });
    await ctx.db.patch(args.threadId, { lastMessageAt: Date.now() });
    return id;
  },
});

export const clearAssistantContentInternal = internalMutation({
  args: { messageId: v.id('assistantMessages') },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { content: '' });
    return null;
  },
});

export const appendDeltaToAssistantInternal = internalMutation({
  args: {
    messageId: v.id('assistantMessages'),
    delta: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.messageId);
    if (!row) return null;
    await ctx.db.patch(args.messageId, {
      content: (row.content ?? '') + args.delta,
    });
    return null;
  },
});

export const appendReasoningDeltaInternal = internalMutation({
  args: {
    messageId: v.id('assistantMessages'),
    delta: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.messageId);
    if (!row) return null;
    await ctx.db.patch(args.messageId, {
      reasoning: (row.reasoning ?? '') + args.delta,
    });
    return null;
  },
});

export const setSuggestedFollowUpsInternal = internalMutation({
  args: {
    messageId: v.id('assistantMessages'),
    followUps: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { suggestedFollowUps: args.followUps });
    return null;
  },
});

export const requestCancelTurn = mutation({
  args: { messageId: v.id('assistantMessages') },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.messageId);
    if (!row || row.status !== 'running') return null;
    await ctx.db.patch(args.messageId, { cancelRequested: true });
    return null;
  },
});

export const isCancelRequestedInternal = internalQuery({
  args: { messageId: v.id('assistantMessages') },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.messageId);
    return row?.cancelRequested === true;
  },
});

export const appendToolRunningInternal = internalMutation({
  args: {
    threadId: v.id('assistantThreads'),
    toolName: v.string(),
    toolArgs: v.optional(v.any()),
    toolCallId: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('assistantMessages', {
      threadId: args.threadId,
      role: 'tool',
      content: '',
      toolName: args.toolName,
      toolArgs: args.toolArgs,
      toolCallId: args.toolCallId,
      status: 'running',
    });
    return id;
  },
});

export const completeToolInternal = internalMutation({
  args: {
    messageId: v.id('assistantMessages'),
    toolResult: v.optional(v.any()),
    status: v.union(v.literal('done'), v.literal('error'), v.literal('cancelled')),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, {
      toolResult: args.toolResult,
      status: args.status,
    });
    return null;
  },
});

export const insertAwaitingChoiceInternal = internalMutation({
  args: {
    threadId: v.id('assistantThreads'),
    toolArgs: v.any(),
    toolCallId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('assistantMessages', {
      threadId: args.threadId,
      role: 'tool',
      content: '',
      toolName: 'askUserForChoice',
      toolArgs: args.toolArgs,
      toolCallId: args.toolCallId,
      status: 'awaiting_choice',
    });
    return id;
  },
});

export const insertAwaitingQuestionsInternal = internalMutation({
  args: {
    threadId: v.id('assistantThreads'),
    toolArgs: v.any(),
    toolCallId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('assistantMessages', {
      threadId: args.threadId,
      role: 'tool',
      content: '',
      toolName: 'askUserQuestion',
      toolArgs: args.toolArgs,
      toolCallId: args.toolCallId,
      status: 'awaiting_questions',
    });
    return id;
  },
});

export const insertAwaitingConfirmationToolInternal = internalMutation({
  args: {
    threadId: v.id('assistantThreads'),
    toolName: v.string(),
    toolArgs: v.optional(v.any()),
    toolCallId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('assistantMessages', {
      threadId: args.threadId,
      role: 'tool',
      content: '',
      toolName: args.toolName,
      toolArgs: args.toolArgs,
      toolCallId: args.toolCallId,
      status: 'awaiting_confirmation',
    });
    return id;
  },
});

export const resolveConfirmation = action({
  args: {
    confirmationMessageId: v.id('assistantMessages'),
    approved: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ status: string }> => {
    const row = await ctx.runQuery(internal.assistant.getMessageByIdInternal, {
      messageId: args.confirmationMessageId,
    });
    if (!row) throw new Error('Confirmation row not found');
    if (row.role !== 'tool') throw new Error('Not a tool row');
    if (row.status !== 'awaiting_confirmation') {
      return { status: row.status ?? 'unknown' };
    }

    if (!args.approved) {
      await ctx.runMutation(internal.assistant.completeToolInternal, {
        messageId: args.confirmationMessageId,
        toolResult: { status: 'cancelled', reason: 'user_denied' },
        status: 'cancelled',
      });
      return { status: 'cancelled' };
    }

    const toolName = row.toolName ?? '';
    const args2 = (row.toolArgs ?? {}) as Record<string, unknown>;

    try {
      const threadRow = await ctx.runQuery(internal.assistant.getThreadInternal, {
        threadId: row.threadId,
      });
      const instance = threadRow?.instance ?? '';
      let result: unknown = null;
      if (toolName === 'rejectDraft') {
        await ctx.runMutation(api.drafts.rejectAndClearNeedsReply, {
          draftId: args2.draftId as Id<'drafts'>,
        });
        result = { ok: true };
      } else if (toolName === 'dismissReminder') {
        await ctx.runMutation(api.reminders.dismiss, {
          reminderId: args2.reminderId as Id<'reminders'>,
        });
        result = { ok: true };
      } else if (toolName === 'deleteTask') {
        await ctx.runMutation(api.tasks.remove, {
          taskId: args2.taskId as Id<'tasks'>,
        });
        result = { ok: true };
      } else if (toolName === 'declineMeeting') {
        await ctx.runMutation(api.meetings.declineMeeting, {
          meetingId: args2.meetingId as Id<'meetings'>,
        });
        result = { ok: true };
      } else if (toolName === 'draftReply') {
        const draftId = await ctx.runMutation(internal.drafts.insertDraftInternal, {
          instance,
          contactId: args2.contactId as Id<'contacts'>,
          text: String(args2.text ?? ''),
          sourceMode: 'manual_request',
        });
        result = { ok: true, draftId };
      } else if (toolName === 'sendWhatsappMessage') {
        const contactId = args2.contactId as Id<'contacts'>;
        const text = String(args2.text ?? '').trim();
        if (text.length === 0) throw new Error('Empty message');
        const contact = await ctx.runQuery(internal.contacts.getContactInternal, { contactId });
        if (!contact) throw new Error('Contact not found');

        const quotedWamid =
          typeof args2.quotedWamid === 'string' && args2.quotedWamid.length > 0
            ? args2.quotedWamid
            : undefined;
        const quotedPreview =
          typeof args2.quotedPreview === 'string' ? args2.quotedPreview : undefined;

        // Quiet-hours defer: if active and contact doesn't bypass, save as a
        // draft instead of sending.
        const userPref = await ctx.runQuery(internal.userPreferences.getInternal, {
          instance: contact.instance,
        });
        const { isInQuietHoursNow, contactBypassesQuietHours } = await import('./quietHours');
        const quietActive = isInQuietHoursNow(userPref ?? null).active;
        const bypass = contactBypassesQuietHours(contact, userPref ?? null);
        if (quietActive && !bypass) {
          const draftId = await ctx.runMutation(internal.drafts.insertDraftInternal, {
            instance: contact.instance,
            contactId,
            text,
            sourceMode: 'manual_request',
          });
          result = {
            ok: true,
            deferred: true,
            draftId,
            reason: 'quiet_hours',
          };
          await ctx.runMutation(internal.assistant.completeToolInternal, {
            messageId: args.confirmationMessageId,
            toolResult: result,
            status: 'done',
          });
          // Skip the rest of the send path.
          // (mirrors the normal completion flow below)
          return { status: 'done' };
        }

        const { sendText } = await import('./providers/evolution');
        const sendResult = await sendText({
          instance: contact.instance,
          to: contact.remoteJid,
          text,
          quoted: quotedWamid ? { messageId: quotedWamid, originalText: quotedPreview } : undefined,
        });

        if (sendResult.messageId) {
          await ctx.runMutation(internal.messages.recordOutgoing, {
            instance: contact.instance,
            remoteJid: contact.remoteJid,
            contactId,
            messageId: sendResult.messageId,
            text,
            sentByAi: true,
          });
        }
        // If the user replied to a specific message, that message no longer
        // needs a reply.
        if (typeof args2.quotedMessageId === 'string' && args2.quotedMessageId) {
          try {
            await ctx.runMutation(api.messageActions.setNeedsReply, {
              messageId: args2.quotedMessageId as Id<'messages'>,
              needsReply: false,
            });
          } catch (err) {
            console.warn('[sendWhatsappMessage] clear needsReply failed', {
              err: String(err),
            });
          }
        }
        result = {
          ok: true,
          sentMessageId: sendResult.messageId ?? null,
          quoted: quotedWamid ? { messageId: quotedWamid } : null,
        };
      } else if (toolName === 'createTask') {
        const taskId = await ctx.runMutation(internal.tasks.createInternal, {
          instance,
          title: String(args2.title ?? ''),
          dueAt: typeof args2.dueAt === 'number' ? (args2.dueAt as number) : undefined,
          contactId:
            typeof args2.contactId === 'string' ? (args2.contactId as Id<'contacts'>) : undefined,
        });
        result = { ok: true, taskId };
      } else if (toolName === 'markTaskDone') {
        await ctx.runMutation(api.tasks.setStatus, {
          taskId: args2.taskId as Id<'tasks'>,
          status: 'done',
        });
        result = { ok: true };
      } else if (toolName === 'markNeedsReply') {
        await ctx.runMutation(api.messageActions.setNeedsReply, {
          messageId: args2.messageId as Id<'messages'>,
          needsReply: Boolean(args2.value),
        });
        result = { ok: true };
      } else if (toolName === 'acceptMeeting') {
        const startAt = typeof args2.startAt === 'number' ? (args2.startAt as number) : undefined;
        const r = await ctx.runMutation(api.meetings.acceptMeeting, {
          meetingId: args2.meetingId as Id<'meetings'>,
          startAt,
        });
        result = { ok: true, ...r };
      } else if (toolName === 'markActionPlanItemDone') {
        const summaryId = args2.summaryId as Id<'dailySummaries'>;
        const order = Number(args2.order);
        await ctx.runMutation(api.summaries.markActionPlanItemDone, {
          summaryId,
          order,
        });
        result = { ok: true, summaryId, order };
      } else if (toolName === 'createReminder') {
        const reminderId = await ctx.runMutation(api.reminders.create, {
          instance,
          text: String(args2.text ?? ''),
          remindAt: Number(args2.remindAt),
          contactId:
            typeof args2.contactId === 'string' ? (args2.contactId as Id<'contacts'>) : undefined,
        });
        result = { ok: true, reminderId };
      } else if (toolName === 'sendDraft') {
        const sent = await ctx.runAction(api.drafts.send, {
          draftId: args2.draftId as Id<'drafts'>,
        });
        result = { ok: true, ...sent };
      } else if (toolName === 'rememberThis') {
        const scope = args2.scope === 'contact' ? 'contact' : 'user';
        const contactId =
          typeof args2.contactId === 'string' ? (args2.contactId as Id<'contacts'>) : undefined;
        if (scope === 'contact' && !contactId) {
          throw new Error('A contact-scoped memory needs a contactId');
        }
        const memoryId = await ctx.runMutation(api.memories.create, {
          instance,
          scope,
          contactId,
          type: (args2.type ?? 'fact') as
            | 'fact'
            | 'preference'
            | 'commitment'
            | 'ongoing'
            | 'relationship',
          content: String(args2.content ?? ''),
        });
        result = { ok: true, memoryId };
      } else if (toolName === 'forgetMemory') {
        await ctx.runMutation(api.memories.remove, {
          memoryId: args2.memoryId as Id<'memories'>,
        });
        result = { ok: true };
      } else if (toolName === 'saveKnowledge') {
        const entryId = await ctx.runMutation(api.knowledgeEntries.create, {
          instance,
          kind: (args2.kind ?? 'note') as
            | 'project'
            | 'url'
            | 'template'
            | 'client_note'
            | 'availability'
            | 'note',
          title: String(args2.title ?? ''),
          body: String(args2.body ?? ''),
          pinned: args2.pinned === true,
        });
        result = { ok: true, entryId };
      } else if (toolName === 'updateChatSettings') {
        // One tool, several backend mutations — apply only the fields the
        // model actually set, so an unmentioned setting is never clobbered.
        const contactId = args2.contactId as Id<'contacts'>;
        const applied: string[] = [];
        if (typeof args2.priority === 'string') {
          await ctx.runMutation(api.chatSettings.setPriority, {
            contactId,
            priority: args2.priority as 'urgent' | 'high' | 'normal' | 'low',
          });
          applied.push('priority');
        }
        if (typeof args2.muted === 'boolean') {
          await ctx.runMutation(api.chatSettings.setMuted, {
            contactId,
            muted: args2.muted,
          });
          applied.push('muted');
        }
        if (typeof args2.relationship === 'string') {
          await ctx.runMutation(api.chatSettings.setRelationship, {
            contactId,
            relationship: args2.relationship as
              | 'vip'
              | 'client'
              | 'family'
              | 'friend'
              | 'classmate'
              | 'team'
              | 'low_priority'
              | 'unknown',
          });
          applied.push('relationship');
        }
        if (typeof args2.aiMode === 'string') {
          await ctx.runMutation(api.chatSettings.setAiMode, {
            contactId,
            aiMode: args2.aiMode as 'manual' | 'semi_auto' | 'full_auto' | 'silent',
          });
          applied.push('aiMode');
        }
        if (typeof args2.checkInCadenceDays === 'number') {
          await ctx.runMutation(api.chatSettings.setCheckInCadence, {
            contactId,
            days: args2.checkInCadenceDays,
          });
          applied.push('checkInCadence');
        }
        if (applied.length === 0) {
          throw new Error('No settings were specified to change');
        }
        result = { ok: true, applied };
      } else if (toolName === 'createContactGoal') {
        const goalId = await ctx.runMutation(api.contactGoals.create, {
          contactId: args2.contactId as Id<'contacts'>,
          title: String(args2.title ?? ''),
          instructions: String(args2.instructions ?? ''),
          kind: (args2.kind ?? 'custom') as 'check_in' | 'meeting' | 'relationship' | 'custom',
          recurrence: (args2.recurrence ?? 'once') as
            | 'once'
            | 'daily'
            | 'weekly'
            | 'interval'
            | 'until_done',
          intervalHours: typeof args2.intervalHours === 'number' ? args2.intervalHours : undefined,
          successCriteria:
            typeof args2.successCriteria === 'string' ? args2.successCriteria : undefined,
          mode: args2.mode === 'auto' ? 'auto' : 'draft',
        });
        result = { ok: true, goalId };
      } else {
        throw new Error(`Unknown write tool: ${toolName}`);
      }

      await ctx.runMutation(internal.assistant.completeToolInternal, {
        messageId: args.confirmationMessageId,
        toolResult: result,
        status: 'done',
      });
      // Replay the assistant turn so it can react to the action's success.
      if (threadRow) {
        const history = await ctx.runQuery(internal.assistant.listMessagesInternal, {
          threadId: row.threadId,
        });
        const conversation = history
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }));
        const [preferences, pinnedKnowledge, memoryScopes] = await Promise.all([
          ctx.runQuery(internal.assistantPreferences.getInternal, {
            instance: threadRow.instance,
          }),
          ctx.runQuery(internal.knowledgeEntries.listPinnedInternal, {
            instance: threadRow.instance,
          }),
          ctx.runQuery(internal.memories.retrieveForCallInternal, {
            instance: threadRow.instance,
            charBudget: 4000,
          }),
        ]);
        const { formatMemoryBlock } = await import('./memoryPrompt');
        const nowContext = await loadNowContext(ctx, threadRow.instance);
        const system = buildAssistantSystemPrompt(
          nowContext,
          preferences,
          pinnedKnowledge.map((k) => ({
            kind: k.kind,
            title: k.title,
            body: k.body,
          })),
          formatMemoryBlock(memoryScopes),
          threadRow.voice === true,
        );
        const tools = {
          ...buildAssistantTools(ctx, {
            instance: threadRow.instance,
            threadId: row.threadId,
          }),
          ...buildAssistantActionTools(ctx, {
            instance: threadRow.instance,
            threadId: row.threadId,
          }),
        };
        // Slip in a synthetic user message so the model knows the user approved.
        conversation.push({
          role: 'user',
          content: `(approved: ${toolName}) — please confirm in one short sentence.`,
        });
        await streamAssistantIntoThread(ctx, {
          threadId: row.threadId,
          system,
          conversation,
          tools,
          modelId: threadRow.modelId ?? null,
        });
      }
      return { status: 'done' };
    } catch (err) {
      await ctx.runMutation(internal.assistant.completeToolInternal, {
        messageId: args.confirmationMessageId,
        toolResult: {
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        },
        status: 'error',
      });
      return { status: 'error' };
    }
  },
});

export const submitChoice = action({
  args: {
    choiceMessageId: v.id('assistantMessages'),
    choice: v.string(),
  },
  handler: async (ctx, args): Promise<{ status: string }> => {
    const row = await ctx.runQuery(internal.assistant.getMessageByIdInternal, {
      messageId: args.choiceMessageId,
    });
    if (!row) throw new Error('Choice row not found');
    if (row.role !== 'tool' || row.toolName !== 'askUserForChoice') {
      throw new Error('Not a choice row');
    }
    if (row.status !== 'awaiting_choice') {
      return { status: row.status ?? 'unknown' };
    }

    const toolArgs = (row.toolArgs ?? {}) as {
      question?: string;
      options?: string[];
    };
    const options = Array.isArray(toolArgs.options) ? toolArgs.options : [];
    if (!options.includes(args.choice)) {
      throw new Error('Choice not in original options');
    }

    // Patch the row to record the user's pick.
    await ctx.runMutation(internal.assistant.completeToolInternal, {
      messageId: args.choiceMessageId,
      toolResult: { chosen: args.choice },
      status: 'done',
    });

    // Append the choice as a user turn so the conversation history contains it.
    await ctx.runMutation(internal.assistant.appendUserMessageInternal, {
      threadId: row.threadId,
      content: args.choice,
    });

    // Replay a streamed assistant turn now that the choice is on the record.
    const thread = await ctx.runQuery(internal.assistant.getThreadInternal, {
      threadId: row.threadId,
    });
    if (!thread) throw new Error('Thread not found');

    const history = await ctx.runQuery(internal.assistant.listMessagesInternal, {
      threadId: row.threadId,
    });
    const conversation = history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const [preferences, pinnedKnowledge, memoryScopes] = await Promise.all([
      ctx.runQuery(internal.assistantPreferences.getInternal, {
        instance: thread.instance,
      }),
      ctx.runQuery(internal.knowledgeEntries.listPinnedInternal, {
        instance: thread.instance,
      }),
      ctx.runQuery(internal.memories.retrieveForCallInternal, {
        instance: thread.instance,
        charBudget: 4000,
      }),
    ]);
    const { formatMemoryBlock } = await import('./memoryPrompt');
    const nowContext = await loadNowContext(ctx, thread.instance);
    const system = buildAssistantSystemPrompt(
      nowContext,
      preferences,
      pinnedKnowledge.map((k) => ({
        kind: k.kind,
        title: k.title,
        body: k.body,
      })),
      formatMemoryBlock(memoryScopes),
      thread.voice === true,
    );
    const tools = {
      ...buildAssistantTools(ctx, {
        instance: thread.instance,
        threadId: row.threadId,
      }),
      ...buildAssistantActionTools(ctx, {
        instance: thread.instance,
        threadId: row.threadId,
      }),
    };

    await streamAssistantIntoThread(ctx, {
      threadId: row.threadId,
      system,
      conversation,
      tools,
      modelId: thread.modelId ?? null,
    });

    return { status: 'done' };
  },
});

type AskedQuestion = {
  question?: string;
  header?: string;
  multiSelect?: boolean;
  options?: Array<{ label?: string; description?: string }>;
};

export const submitAnswers = action({
  args: {
    questionMessageId: v.id('assistantMessages'),
    answers: v.array(
      v.object({
        header: v.string(),
        selected: v.array(v.string()),
        other: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<{ status: string }> => {
    const row = await ctx.runQuery(internal.assistant.getMessageByIdInternal, {
      messageId: args.questionMessageId,
    });
    if (!row) throw new Error('Question row not found');
    if (row.role !== 'tool' || row.toolName !== 'askUserQuestion') {
      throw new Error('Not a question row');
    }
    if (row.status !== 'awaiting_questions') {
      // Already answered/cancelled (e.g. double-tap) — no-op.
      return { status: row.status ?? 'unknown' };
    }

    const toolArgs = (row.toolArgs ?? {}) as { questions?: AskedQuestion[] };
    const questions = Array.isArray(toolArgs.questions) ? toolArgs.questions : [];
    if (questions.length === 0) throw new Error('Question row has no questions');

    // Validate: every question answered, every selected value is a real
    // option label unless it came through the free-text "Other" path.
    const answered: Array<{
      header: string;
      question: string;
      multiSelect: boolean;
      selected: string[];
      other?: string;
    }> = [];
    for (const q of questions) {
      const header = q.header ?? '';
      const a = args.answers.find((x) => x.header === header);
      if (!a) throw new Error(`Missing answer for "${header}"`);
      const other = a.other?.trim();
      const labels = (q.options ?? [])
        .map((o) => o.label)
        .filter((l): l is string => typeof l === 'string');
      const selected = other
        ? [other]
        : a.selected.map((s) => s.trim()).filter((s) => s.length > 0);
      if (selected.length === 0) {
        throw new Error(`Empty answer for "${header}"`);
      }
      if (!other) {
        for (const s of selected) {
          if (!labels.includes(s)) {
            throw new Error(`"${s}" is not an option for "${header}"`);
          }
        }
        if (q.multiSelect !== true && selected.length > 1) {
          throw new Error(`"${header}" allows only one answer`);
        }
      }
      answered.push({
        header,
        question: q.question ?? '',
        multiSelect: q.multiSelect === true,
        selected,
        other: other || undefined,
      });
    }

    // Record the answers on the row (drives the compact answered render).
    await ctx.runMutation(internal.assistant.completeToolInternal, {
      messageId: args.questionMessageId,
      toolResult: { answers: answered },
      status: 'done',
    });

    // Append a self-contained user turn — tool rows are stripped from model
    // history, so this string is the model's only record of the answers.
    const content = answered.map((a) => `${a.header}: ${a.selected.join(', ')}`).join('; ');
    await ctx.runMutation(internal.assistant.appendUserMessageInternal, {
      threadId: row.threadId,
      content,
    });

    // Replay a streamed assistant turn now that the answers are on record.
    const thread = await ctx.runQuery(internal.assistant.getThreadInternal, {
      threadId: row.threadId,
    });
    if (!thread) throw new Error('Thread not found');

    const history = await ctx.runQuery(internal.assistant.listMessagesInternal, {
      threadId: row.threadId,
    });
    const conversation = history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const [preferences, pinnedKnowledge, memoryScopes] = await Promise.all([
      ctx.runQuery(internal.assistantPreferences.getInternal, {
        instance: thread.instance,
      }),
      ctx.runQuery(internal.knowledgeEntries.listPinnedInternal, {
        instance: thread.instance,
      }),
      ctx.runQuery(internal.memories.retrieveForCallInternal, {
        instance: thread.instance,
        charBudget: 4000,
      }),
    ]);
    const { formatMemoryBlock } = await import('./memoryPrompt');
    const nowContext = await loadNowContext(ctx, thread.instance);
    const system = buildAssistantSystemPrompt(
      nowContext,
      preferences,
      pinnedKnowledge.map((k) => ({
        kind: k.kind,
        title: k.title,
        body: k.body,
      })),
      formatMemoryBlock(memoryScopes),
      thread.voice === true,
    );
    const tools = {
      ...buildAssistantTools(ctx, {
        instance: thread.instance,
        threadId: row.threadId,
      }),
      ...buildAssistantActionTools(ctx, {
        instance: thread.instance,
        threadId: row.threadId,
      }),
    };

    await streamAssistantIntoThread(ctx, {
      threadId: row.threadId,
      system,
      conversation,
      tools,
      modelId: thread.modelId ?? null,
    });

    return { status: 'done' };
  },
});

export const completeAssistantInternal = internalMutation({
  args: {
    messageId: v.id('assistantMessages'),
    citedMessageIds: v.optional(v.array(v.id('messages'))),
    citedContactIds: v.optional(v.array(v.id('contacts'))),
    titleIfEmpty: v.optional(v.string()),
    status: v.union(v.literal('done'), v.literal('error')),
    contentSuffix: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.messageId);
    if (!row) return null;
    const patch: Record<string, unknown> = {
      status: args.status,
      citedMessageIds: args.citedMessageIds,
      citedContactIds: args.citedContactIds,
    };
    if (args.contentSuffix) {
      patch.content = (row.content ?? '') + args.contentSuffix;
    }
    await ctx.db.patch(args.messageId, patch);

    const thread = await ctx.db.get(row.threadId);
    const threadPatch: Record<string, unknown> = { lastMessageAt: Date.now() };
    if (thread && !thread.title && args.titleIfEmpty) {
      threadPatch.title = args.titleIfEmpty;
    }
    await ctx.db.patch(row.threadId, threadPatch);
    return null;
  },
});

function uniqueIds<T extends string>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

export const deleteMessagesAfterInternal = internalMutation({
  args: {
    threadId: v.id('assistantThreads'),
    afterCreationTime: v.number(),
    includeBoundary: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('assistantMessages')
      .withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
      .order('asc')
      .take(500);
    for (const r of rows) {
      const include =
        args.includeBoundary === true
          ? r._creationTime >= args.afterCreationTime
          : r._creationTime > args.afterCreationTime;
      if (include) await ctx.db.delete(r._id);
    }
    return null;
  },
});

export const patchUserMessageContentInternal = internalMutation({
  args: { messageId: v.id('assistantMessages'), content: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.messageId);
    if (!row || row.role !== 'user') {
      throw new Error('Not a user message');
    }
    await ctx.db.patch(args.messageId, { content: args.content });
    return null;
  },
});

export const regenerateLastTurn = action({
  args: { threadId: v.id('assistantThreads') },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const thread = await ctx.runQuery(internal.assistant.getThreadInternal, {
      threadId: args.threadId,
    });
    if (!thread) throw new Error('Thread not found');

    const history = await ctx.runQuery(internal.assistant.listMessagesInternal, {
      threadId: args.threadId,
    });
    // Walk back from the end to find the last user message; everything after
    // it (assistant + tool rows) gets discarded.
    let lastUserIdx = -1;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) throw new Error('No user message to regenerate from');

    const lastUser = history[lastUserIdx];
    await ctx.runMutation(internal.assistant.deleteMessagesAfterInternal, {
      threadId: args.threadId,
      afterCreationTime: lastUser._creationTime,
      includeBoundary: false,
    });

    const truncated = history.slice(0, lastUserIdx + 1);
    const conversation = truncated
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const [preferences, pinnedKnowledge, memoryScopes] = await Promise.all([
      ctx.runQuery(internal.assistantPreferences.getInternal, {
        instance: thread.instance,
      }),
      ctx.runQuery(internal.knowledgeEntries.listPinnedInternal, {
        instance: thread.instance,
      }),
      ctx.runQuery(internal.memories.retrieveForCallInternal, {
        instance: thread.instance,
        charBudget: 4000,
      }),
    ]);
    const { formatMemoryBlock } = await import('./memoryPrompt');
    const nowContext = await loadNowContext(ctx, thread.instance);
    const system = buildAssistantSystemPrompt(
      nowContext,
      preferences,
      pinnedKnowledge.map((k) => ({
        kind: k.kind,
        title: k.title,
        body: k.body,
      })),
      formatMemoryBlock(memoryScopes),
      thread.voice === true,
    );
    const tools = {
      ...buildAssistantTools(ctx, { instance: thread.instance, threadId: args.threadId }),
      ...buildAssistantActionTools(ctx, { instance: thread.instance, threadId: args.threadId }),
    };
    await streamAssistantIntoThread(ctx, {
      threadId: args.threadId,
      system,
      conversation,
      tools,
      modelId: thread.modelId ?? null,
    });
    return { ok: true };
  },
});

export const editUserMessageAndRetry = action({
  args: {
    messageId: v.id('assistantMessages'),
    content: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const content = args.content.trim();
    if (content.length === 0) throw new Error('Empty message');

    const row = await ctx.runQuery(internal.assistant.getMessageByIdInternal, {
      messageId: args.messageId,
    });
    if (!row || row.role !== 'user') throw new Error('Not a user message');

    const thread = await ctx.runQuery(internal.assistant.getThreadInternal, {
      threadId: row.threadId,
    });
    if (!thread) throw new Error('Thread not found');

    // Patch content, then delete everything that came after this row.
    await ctx.runMutation(internal.assistant.patchUserMessageContentInternal, {
      messageId: args.messageId,
      content,
    });
    await ctx.runMutation(internal.assistant.deleteMessagesAfterInternal, {
      threadId: row.threadId,
      afterCreationTime: row._creationTime,
      includeBoundary: false,
    });

    const history = await ctx.runQuery(internal.assistant.listMessagesInternal, {
      threadId: row.threadId,
    });
    const conversation = history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const [preferences, pinnedKnowledge, memoryScopes] = await Promise.all([
      ctx.runQuery(internal.assistantPreferences.getInternal, {
        instance: thread.instance,
      }),
      ctx.runQuery(internal.knowledgeEntries.listPinnedInternal, {
        instance: thread.instance,
      }),
      ctx.runQuery(internal.memories.retrieveForCallInternal, {
        instance: thread.instance,
        charBudget: 4000,
      }),
    ]);
    const { formatMemoryBlock } = await import('./memoryPrompt');
    const nowContext = await loadNowContext(ctx, thread.instance);
    const system = buildAssistantSystemPrompt(
      nowContext,
      preferences,
      pinnedKnowledge.map((k) => ({
        kind: k.kind,
        title: k.title,
        body: k.body,
      })),
      formatMemoryBlock(memoryScopes),
      thread.voice === true,
    );
    const tools = {
      ...buildAssistantTools(ctx, { instance: thread.instance, threadId: row.threadId }),
      ...buildAssistantActionTools(ctx, { instance: thread.instance, threadId: row.threadId }),
    };
    await streamAssistantIntoThread(ctx, {
      threadId: row.threadId,
      system,
      conversation,
      tools,
      modelId: thread.modelId ?? null,
    });
    return { ok: true };
  },
});

export const sendMessage = action({
  args: {
    threadId: v.id('assistantThreads'),
    content: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const content = args.content.trim();
    if (content.length === 0) throw new Error('Empty message');

    console.log('[assistant.sendMessage] enter', {
      threadId: args.threadId,
      contentPreview: content.slice(0, 120),
    });

    const thread = await ctx.runQuery(internal.assistant.getThreadInternal, {
      threadId: args.threadId,
    });
    if (!thread) throw new Error('Thread not found');

    await ctx.runMutation(internal.assistant.appendUserMessageInternal, {
      threadId: args.threadId,
      content,
    });

    const history = await ctx.runQuery(internal.assistant.listMessagesInternal, {
      threadId: args.threadId,
    });

    // Replay user + assistant turns into the model (skip tool turns; the model
    // sees only the visible conversation).
    const conversation = history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const [preferences, pinnedKnowledge, memoryScopes] = await Promise.all([
      ctx.runQuery(internal.assistantPreferences.getInternal, {
        instance: thread.instance,
      }),
      ctx.runQuery(internal.knowledgeEntries.listPinnedInternal, {
        instance: thread.instance,
      }),
      ctx.runQuery(internal.memories.retrieveForCallInternal, {
        instance: thread.instance,
        charBudget: 4000,
      }),
    ]);
    const { formatMemoryBlock } = await import('./memoryPrompt');
    const nowContext = await loadNowContext(ctx, thread.instance);
    const system = buildAssistantSystemPrompt(
      nowContext,
      preferences,
      pinnedKnowledge.map((k) => ({
        kind: k.kind,
        title: k.title,
        body: k.body,
      })),
      formatMemoryBlock(memoryScopes),
      thread.voice === true,
    );

    const tools = {
      ...buildAssistantTools(ctx, {
        instance: thread.instance,
        threadId: args.threadId,
      }),
      ...buildAssistantActionTools(ctx, {
        instance: thread.instance,
        threadId: args.threadId,
      }),
    };
    const titleIfEmpty = thread.title ? undefined : deriveTitle(content);

    await streamAssistantIntoThread(ctx, {
      threadId: args.threadId,
      system,
      conversation,
      tools,
      titleIfEmpty,
      modelId: thread.modelId ?? null,
    });

    return { ok: true };
  },
});
