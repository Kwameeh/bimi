import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { refreshChatState } from "./chatState";

const DAY_MS = 24 * 60 * 60 * 1000;

const RELATIONSHIP_TONE: Record<string, string> = {
  vip: "Warm and personal. Two short sentences.",
  client: "Professional and brief. Reference our last project lightly.",
  family: "Casual and affectionate. One short check-in question.",
  friend: "Casual and friendly. Reference a shared interest if obvious.",
  classmate: "Casual and brief. Reference school/class lightly.",
  team: "Professional and brief. Suggest a sync if appropriate.",
  low_priority: "Brief and polite.",
  unknown: "Polite and brief.",
};

export const listEligibleContactsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Fetch contacts in batches; we don't have an index on cadence, but
    // this scan is cheap (small N for a single user).
    const rows = await ctx.db.query("contacts").take(500);
    return rows.filter(
      (c) => (c.checkInCadenceDays ?? 0) > 0 && c.autoReplyBlocked !== true,
    );
  },
});

export const hasPendingDraftInternal = internalQuery({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    const draft = await ctx.db
      .query("drafts")
      .withIndex("by_contact_and_status", (q) =>
        q.eq("contactId", args.contactId).eq("status", "pending"),
      )
      .first();
    return draft !== null;
  },
});

export const insertCheckInDraftInternal = internalMutation({
  args: {
    instance: v.string(),
    contactId: v.id("contacts"),
    text: v.string(),
    relationship: v.string(),
  },
  handler: async (ctx, args) => {
    const draftId = await ctx.db.insert("drafts", {
      instance: args.instance,
      contactId: args.contactId,
      text: args.text,
      status: "pending",
      style: "check_in",
      sourceMode: "auto_pipeline",
      reason: `check_in:${args.relationship}`,
    });
    await ctx.db.patch(args.contactId, { lastCheckInAt: Date.now() });
    await refreshChatState(ctx, args.contactId);
    return draftId;
  },
});

function shouldFireToday(contact: Doc<"contacts">, nowMs: number): boolean {
  const cadenceDays = contact.checkInCadenceDays ?? 0;
  if (cadenceDays <= 0) return false;

  // Last user activity — prefer outgoing messages, fall back to any message.
  const lastActiveMs =
    (contact.lastUserMessageAt ?? 0) > 0
      ? contact.lastUserMessageAt!
      : (contact.lastMessageAt ?? 0) * 1000;

  if (lastActiveMs > 0) {
    const ageMs = nowMs - lastActiveMs;
    if (ageMs < cadenceDays * DAY_MS) return false;
  }

  // Throttle: don't generate again within 24h of the previous check-in.
  if (contact.lastCheckInAt && nowMs - contact.lastCheckInAt < DAY_MS) {
    return false;
  }

  // Optional weekday gate
  if (contact.checkInWeekday !== undefined) {
    const today = new Date(nowMs).getUTCDay();
    if (today !== contact.checkInWeekday) return false;
  }

  return true;
}

export const scanForCheckInsInternal = internalAction({
  args: {},
  handler: async (ctx): Promise<{ generated: number }> => {
    const candidates: Array<Doc<"contacts">> = await ctx.runQuery(
      internal.checkins.listEligibleContactsInternal,
      {},
    );
    if (candidates.length === 0) return { generated: 0 };

    const nowMs = Date.now();
    const due = candidates.filter((c) => shouldFireToday(c, nowMs));
    if (due.length === 0) return { generated: 0 };

    const { generateText } = await import("./providers/processing");
    let generated = 0;

    for (const contact of due) {
      try {
        const hasPending = await ctx.runQuery(
          internal.checkins.hasPendingDraftInternal,
          { contactId: contact._id },
        );
        if (hasPending) continue;

        const relationship = contact.relationship ?? "unknown";
        const tone = RELATIONSHIP_TONE[relationship] ?? RELATIONSHIP_TONE.unknown;
        const name =
          contact.displayName ?? contact.pushName ?? contact.normalizedPhone ?? "there";

        const system = [
          "You write a short, sincere check-in message to a contact the user hasn't spoken to in a while.",
          `Tone: ${tone}`,
          "Output ONLY the message text. No quotes, no labels.",
          "Keep it under 25 words. Don't mention dates or counts.",
        ].join(" ");
        const user = `Contact name: ${name}. Relationship: ${relationship}.`;

        const text = await generateText({
          system,
          user,
          maxTokens: 80,
          temperature: 0.7,
        });

        const trimmed = text.replace(/^["']|["']$/g, "").trim();
        if (trimmed.length === 0) continue;

        await ctx.runMutation(internal.checkins.insertCheckInDraftInternal, {
          instance: contact.instance,
          contactId: contact._id as Id<"contacts">,
          text: trimmed,
          relationship,
        });
        generated++;
      } catch (err) {
        console.warn("check-in generation failed", {
          contactId: contact._id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { generated };
  },
});
