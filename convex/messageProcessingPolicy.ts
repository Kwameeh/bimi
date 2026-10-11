import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

function messageTimeMs(message: Doc<"messages">): number {
  if (message.timestamp === undefined) return message._creationTime;
  return message.timestamp > 1e12 ? message.timestamp : message.timestamp * 1000;
}

function mergeAutomaticMessages(
  automatic: Doc<"messages">[],
  legacy: Doc<"messages">[],
  limit: number,
  order: "asc" | "desc",
): Doc<"messages">[] {
  return [...automatic, ...legacy]
    .sort((a, b) => (order === "asc" ? messageTimeMs(a) - messageTimeMs(b) : messageTimeMs(b) - messageTimeMs(a)))
    .slice(0, limit);
}

export async function listAutomaticMessagesForContact(
  ctx: QueryCtx,
  args: {
    contactId: Id<"contacts">;
    sinceTimestamp?: number;
    limit: number;
    order: "asc" | "desc";
  },
): Promise<Doc<"messages">[]> {
  const queryMode = (mode: "automatic" | undefined) =>
    ctx.db
      .query("messages")
      .withIndex("by_contactId_and_processingModeAtIngest_and_timestamp", (q) => {
        const base = q.eq("contactId", args.contactId).eq("processingModeAtIngest", mode);
        return args.sinceTimestamp !== undefined ? base.gt("timestamp", args.sinceTimestamp) : base;
      })
      .order(args.order)
      .take(args.limit);
  const [automatic, legacy] = await Promise.all([queryMode("automatic"), queryMode(undefined)]);
  return mergeAutomaticMessages(automatic, legacy, args.limit, args.order);
}

export async function listAutomaticMessagesForInstance(
  ctx: QueryCtx,
  args: {
    instance: string;
    sinceTimestamp: number;
    untilTimestamp?: number;
    limit: number;
    order: "asc" | "desc";
  },
): Promise<Doc<"messages">[]> {
  const queryMode = (mode: "automatic" | undefined) =>
    ctx.db
      .query("messages")
      .withIndex("by_instance_and_processingModeAtIngest_and_timestamp", (q) => {
        const base = q.eq("instance", args.instance).eq("processingModeAtIngest", mode);
        if (args.untilTimestamp !== undefined) {
          return base.gte("timestamp", args.sinceTimestamp).lte("timestamp", args.untilTimestamp);
        }
        return base.gte("timestamp", args.sinceTimestamp);
      })
      .order(args.order)
      .take(args.limit);
  const [automatic, legacy] = await Promise.all([queryMode("automatic"), queryMode(undefined)]);
  return mergeAutomaticMessages(automatic, legacy, args.limit, args.order);
}
