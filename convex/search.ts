import { v } from 'convex/values';
import { action, mutation } from './_generated/server';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { buildAssistantTools } from './assistantTools';
import { streamAssistantIntoThread } from './assistantStream';

const SEARCH_KEEP = 10;

function deriveSearchTitle(query: string): string {
  const t = query.trim().slice(0, 60);
  return t.length === 0 ? 'Search' : t;
}

export const startSearchRun = mutation({
  args: { instance: v.string(), query: v.string() },
  handler: async (ctx, args): Promise<{ threadId: Id<'assistantThreads'> }> => {
    const trimmed = args.query.trim();
    if (trimmed.length === 0) throw new Error('Empty query');

    // Cap recent search threads — delete the oldest beyond SEARCH_KEEP.
    const allSearch = await ctx.db
      .query('assistantThreads')
      .withIndex('by_instance_and_kind', (q) =>
        q.eq('instance', args.instance).eq('kind', 'search'),
      )
      .order('desc')
      .take(50);
    for (const t of allSearch.slice(SEARCH_KEEP)) {
      const msgs = await ctx.db
        .query('assistantMessages')
        .withIndex('by_thread', (q) => q.eq('threadId', t._id))
        .take(500);
      for (const m of msgs) await ctx.db.delete(m._id);
      await ctx.db.delete(t._id);
    }

    const threadId = await ctx.db.insert('assistantThreads', {
      instance: args.instance,
      title: deriveSearchTitle(trimmed),
      lastMessageAt: Date.now(),
      kind: 'search',
    });
    await ctx.db.insert('assistantMessages', {
      threadId,
      role: 'user',
      content: trimmed,
    });
    return { threadId };
  },
});

export const runSearch = action({
  args: { threadId: v.id('assistantThreads') },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    console.log('[search.runSearch] enter', { threadId: args.threadId });
    const thread = await ctx.runQuery(internal.assistant.getThreadInternal, {
      threadId: args.threadId,
    });
    if (!thread) throw new Error('Thread not found');

    const history = await ctx.runQuery(internal.assistant.listMessagesInternal, {
      threadId: args.threadId,
    });
    const userMsg = history.find((m) => m.role === 'user');
    if (!userMsg) throw new Error('No user query');
    const query = userMsg.content;
    console.log('[search.runSearch] query', { query: query.slice(0, 120) });

    // Short-circuit: very short queries skip the LLM and write a single
    // assistant row with keyword matches.
    if (query.length < 3) {
      const rows = await ctx.runQuery(api.messages.searchMessages, {
        instance: thread.instance,
        queryText: query,
        limit: 30,
      });
      const msgId = await ctx.runMutation(internal.assistant.appendStreamingAssistantInternal, {
        threadId: args.threadId,
      });
      await ctx.runMutation(internal.assistant.appendDeltaToAssistantInternal, {
        messageId: msgId,
        delta: rows.length > 0 ? `${rows.length} keyword match(es).` : 'No matches.',
      });
      await ctx.runMutation(internal.assistant.completeAssistantInternal, {
        messageId: msgId,
        citedMessageIds: rows.map((r) => r._id) as Id<'messages'>[],
        status: 'done',
      });
      return { ok: true };
    }

    const pref = await ctx.runQuery(internal.userPreferences.getInternal, {
      instance: thread.instance,
    });
    const { formatDateContext } = await import('./dateContext');
    const nowContext = formatDateContext(pref?.quietHoursTimezone);
    const system = `You are Bimi's WhatsApp search. The user is searching THEIR OWN messages.

# Hard rules
1. NEVER refuse. No "I need more information" or similar.
2. ALWAYS call at least one tool.
3. If ambiguous (unclear time / contact / topic), call \`askUserQuestion\` with one question (short \`header\`, 2-4 \`{label, description}\` options). Never ask in free text.
4. If clear, call \`searchMessages\` directly. Default window: last 7 days.
5. For name-based queries: call \`findContactByName\` first to get a contactId, then call \`searchMessages\` with that contactId.
6. NEVER write JSON tool calls as text. Use the native function-calling protocol.
7. Empty result → say "Nothing matched in <window>." Do not refuse.

# Tone
1-3 sentence answer. Cite contact names. Never invent messages.

Now: ${nowContext}.`;

    const tools = buildAssistantTools(ctx, {
      instance: thread.instance,
      threadId: args.threadId,
    });

    await streamAssistantIntoThread(ctx, {
      threadId: args.threadId,
      system,
      conversation: [{ role: 'user', content: query }],
      tools,
    });
    return { ok: true };
  },
});
