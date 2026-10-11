// Pure decision + scheduling logic for contact goals. Kept free of Convex
// imports so it is unit-testable in isolation (see goalRules.test.ts) — the
// goal engine in contactGoals.ts is a thin shell around these functions.
import {
  APPROVAL_REQUIRED_KEYWORDS,
  BLOCKED_CATEGORIES,
  matchApprovalKeyword,
  type AiMode,
} from "./replyRules";

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

/** Outbound attempts with no contact reply before an open-ended goal pauses. */
export const STALL_CAP = 5;
/**
 * Total messages an open-ended goal may put in front of anyone — sent or
 * drafted — across its whole life.
 *
 * The lifetime cap applies even when the contact sometimes engages with the
 * goal and resets its unanswered counter.
 */
export const GOAL_MAX_TURNS = 8;
/** Relationship goals get a smaller budget so charm never turns into pressure. */
export const RELATIONSHIP_MAX_TURNS = 4;
/** Stop proactive relationship pursuit after two messages receive no engagement. */
export const RELATIONSHIP_STALL_CAP = 2;
/** An open-ended goal unmet after this long is not going to be met by nagging. */
export const GOAL_MAX_AGE_MS = 14 * DAY_MS;
/** How long a goal turn may hold its claim before the lease expires. */
export const GOAL_TURN_LEASE_MS = 120_000;
/**
 * A goal reply has to answer the contact *and* advance the goal, so it runs
 * longer than the 2-8 word inbound auto-replies AUTO_REPLY_MAX_CHARS was tuned
 * for. At 240 nearly every substantive goal message would be downgraded to a
 * draft and auto mode would look broken while appearing to work.
 */
export const GOAL_AUTO_REPLY_MAX_CHARS = 240;

export const DEFAULT_NUDGE_HOURS = 24;
const MIN_NUDGE_HOURS = 6;
const MAX_NUDGE_HOURS = 168; // one week
/** Backoff stops escalating here: 24h → 48 → 72 → 96 → 120h, then flat. */
const MAX_BACKOFF_STEPS = 5;

export type GoalKind = "check_in" | "meeting" | "relationship" | "custom";
export type GoalRecurrence = "once" | "daily" | "weekly" | "interval" | "until_done";
export type GoalMode = "draft" | "auto";
export type GoalStatus = "active" | "paused" | "done";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function firstFinite(...values: Array<number | undefined>): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

export function parsePreferredTime(
  value?: string,
): { hours: number; minutes: number } | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

// --- Timezone-aware wall-clock scheduling -----------------------------------
// The Convex runtime's local time is UTC, so `new Date(ms).setHours(9, 0)` puts
// a "09:00 daily" goal at 09:00 UTC regardless of the timezone the client
// stored. Same Intl.DateTimeFormat approach as quietHours.ts:27-49.

type TzParts = { year: number; month: number; day: number; hour: number; minute: number };

function tzParts(atMs: number, tz: string | undefined | null): TzParts {
  const date = new Date(atMs);
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz && tz.length > 0 ? tz : "UTC",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const out: TzParts = { year: 0, month: 1, day: 1, hour: 0, minute: 0 };
    for (const part of fmt.formatToParts(date)) {
      if (part.type === "year") out.year = Number(part.value);
      else if (part.type === "month") out.month = Number(part.value);
      else if (part.type === "day") out.day = Number(part.value);
      else if (part.type === "hour") out.hour = Number(part.value);
      else if (part.type === "minute") out.minute = Number(part.value);
    }
    // Intl renders midnight as "24" in some locales — normalise.
    if (out.hour === 24) out.hour = 0;
    return out;
  } catch {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
    };
  }
}

/** Minutes the zone is ahead of UTC at `atMs` (New York winter → -300). */
function tzOffsetMinutes(atMs: number, tz: string | undefined | null): number {
  const p = tzParts(atMs, tz);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const flooredToMinute = Math.floor(atMs / 60_000) * 60_000;
  return (wallAsUtc - flooredToMinute) / 60_000;
}

/**
 * The next instant strictly after `fromMs` whose wall clock in `tz` reads
 * hours:minutes, advancing by `strideMs` until it lands in the future.
 */
export function localWallClockNext(args: {
  fromMs: number;
  timezone?: string;
  hours: number;
  minutes: number;
  strideMs: number;
}): number {
  const { fromMs, timezone, hours, minutes, strideMs } = args;
  const offset = tzOffsetMinutes(fromMs, timezone);
  const p = tzParts(fromMs, timezone);
  let candidate =
    Date.UTC(p.year, p.month - 1, p.day, hours, minutes) - offset * 60_000;
  while (candidate <= fromMs) candidate += strideMs;

  // The offset may differ at the candidate instant (DST). Re-measure and
  // correct so the wall clock still reads hours:minutes there.
  const candidateOffset = tzOffsetMinutes(candidate, timezone);
  if (candidateOffset !== offset) {
    candidate += (offset - candidateOffset) * 60_000;
    while (candidate <= fromMs) candidate += strideMs;
  }
  return candidate;
}

// --- Nudge backoff ----------------------------------------------------------

/**
 * Delay before the next nudge on an open-ended goal. Escalates with the number
 * of unanswered attempts so an unresponsive contact is pestered less, not more.
 * Always clamped to [6h, 168h] — an unclamped model-supplied 0 would nudge on
 * every cron tick.
 */
export function nudgeDelayMs(
  unanswered: number,
  baseHours?: number,
  overrideHours?: number,
): number {
  const base = clamp(
    firstFinite(overrideHours, baseHours, DEFAULT_NUDGE_HOURS) ?? DEFAULT_NUDGE_HOURS,
    MIN_NUDGE_HOURS,
    MAX_NUDGE_HOURS,
  );
  const steps = Math.min(Math.max(unanswered, 0) + 1, MAX_BACKOFF_STEPS);
  return clamp(base * steps, MIN_NUDGE_HOURS, MAX_NUDGE_HOURS) * HOUR_MS;
}

export function nextRunFor(args: {
  recurrence: GoalRecurrence;
  intervalHours?: number;
  preferredTime?: string;
  timezone?: string;
  unansweredCount?: number;
  nudgeHoursOverride?: number;
  fromMs: number;
}): number {
  if (args.recurrence === "until_done") {
    // Only ever a silence timer — an inbound reply preempts it via the
    // takeover hook and never consults nextRunAt.
    return (
      args.fromMs +
      nudgeDelayMs(args.unansweredCount ?? 0, args.intervalHours, args.nudgeHoursOverride)
    );
  }

  if (args.recurrence === "interval") {
    const hours = clamp(args.intervalHours ?? 24, 1, 168);
    return args.fromMs + hours * HOUR_MS;
  }

  const preferred = parsePreferredTime(args.preferredTime);
  if (!preferred) {
    if (args.recurrence === "weekly") return args.fromMs + WEEK_MS;
    if (args.recurrence === "daily") return args.fromMs + DAY_MS;
    return args.fromMs;
  }

  return localWallClockNext({
    fromMs: args.fromMs,
    timezone: args.timezone,
    hours: preferred.hours,
    minutes: preferred.minutes,
    strideMs: args.recurrence === "weekly" ? WEEK_MS : DAY_MS,
  });
}

// --- Budget -----------------------------------------------------------------

export type GoalBudget =
  | { exhausted: false }
  | { exhausted: true; reason: "turn_budget" | "expired" };

/**
 * Whether an open-ended goal has spent itself. Clock-scheduled goals are exempt:
 * the user picked their cadence and ends them by hand, so a budget there would
 * silently kill a standing daily check-in.
 */
export function evaluateGoalBudget(args: {
  recurrence: GoalRecurrence;
  turnsUsed?: number;
  createdAt: number;
  expiresAt?: number;
  maxTurns?: number;
  nowMs: number;
}): GoalBudget {
  if (args.recurrence !== "until_done") return { exhausted: false };
  const maxTurns = args.maxTurns ?? GOAL_MAX_TURNS;
  if ((args.turnsUsed ?? 0) >= maxTurns) {
    return { exhausted: true, reason: "turn_budget" };
  }
  // expiresAt is absent on goals created before it existed; fall back to age.
  const deadline = args.expiresAt ?? args.createdAt + GOAL_MAX_AGE_MS;
  if (args.nowMs >= deadline) return { exhausted: true, reason: "expired" };
  return { exhausted: false };
}

// --- Assessment -------------------------------------------------------------
// Judging "is this goal done?" and "is this message even about the goal?" is a
// separate call from writing the message. Bundled into the writing call the
// model is answering under a prompt that has already committed it to producing
// a goal message, and it reliably answers completed=false — which is why goals
// used to run forever.

export type GoalAssessment = {
  action:
    | "complete"
    | "reply_only"
    | "weave_goal"
    | "start_goal"
    | "wait"
    | "pause";
  /** The conversation already satisfies the success criteria. */
  completed: boolean;
  confidence: number;
  /** The contact's new message is about the goal. */
  goalRelevant: boolean;
  /** Even if off-topic, this is a natural moment to raise the goal. */
  shouldRaise: boolean;
  /** Optional delay before the strategy is reconsidered. */
  nextCheckHours?: number;
  /** Machine-readable explanation when action=pause. */
  pauseReason?: "declined" | "low_reciprocity" | "unsafe";
  reasoning: string;
};

/**
 * Defaults are deliberately patient. A malformed assessment must never turn
 * into an unsolicited goal message: inbound turns fall back to the normal
 * reply pipeline and scheduled turns are converted to `wait` by the caller.
 */
export function parseGoalAssessment(raw: string): GoalAssessment {
  const out: GoalAssessment = {
    action: "reply_only",
    completed: false,
    confidence: 0.5,
    goalRelevant: false,
    shouldRaise: false,
    reasoning: "",
  };
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return out;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    out.completed = parsed.completed === true;
    out.goalRelevant = parsed.goalRelevant === true;
    out.shouldRaise = parsed.shouldRaise === true;
    const action = parsed.action;
    if (
      action === "complete" ||
      action === "reply_only" ||
      action === "weave_goal" ||
      action === "start_goal" ||
      action === "wait" ||
      action === "pause"
    ) {
      out.action = action;
    } else if (out.completed) {
      out.action = "complete";
    } else if (out.goalRelevant || out.shouldRaise) {
      // Backward compatibility for older model output during deployment.
      out.action = "weave_goal";
    }
    const nextCheckHours =
      typeof parsed.nextCheckHours === "string"
        ? Number(parsed.nextCheckHours)
        : parsed.nextCheckHours;
    if (typeof nextCheckHours === "number" && Number.isFinite(nextCheckHours)) {
      out.nextCheckHours = clamp(nextCheckHours, MIN_NUDGE_HOURS, MAX_NUDGE_HOURS);
    }
    if (
      parsed.pauseReason === "declined" ||
      parsed.pauseReason === "low_reciprocity" ||
      parsed.pauseReason === "unsafe"
    ) {
      out.pauseReason = parsed.pauseReason;
    }
    if (typeof parsed.reasoning === "string") {
      out.reasoning = parsed.reasoning.trim().slice(0, 200);
    }
    const confidence =
      typeof parsed.confidence === "string"
        ? Number(parsed.confidence)
        : parsed.confidence;
    if (typeof confidence === "number" && Number.isFinite(confidence)) {
      out.confidence = clamp(confidence, 0, 1);
    }
  } catch (err) {
    console.warn("parseGoalAssessment: JSON parse failed", {
      rawPreview: raw.slice(0, 200),
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return out;
}

/**
 * Whether the goal engine should write this reply, or hand the conversation
 * back to the normal reply pipeline.
 *
 * A cron nudge is by definition the goal speaking on its own initiative, so
 * relevance does not apply — there is no incoming message to be relevant to.
 */
export function goalOwnsReply(
  assessment: GoalAssessment,
  _isNudge: boolean,
): boolean {
  return assessment.action === "weave_goal" || assessment.action === "start_goal";
}

// --- Auto-send gate ---------------------------------------------------------

export type GoalGateInput = {
  goalMode: GoalMode;
  goalKind: GoalKind;
  aiMode: AiMode;
  isGroup: boolean;
  quietHoursActive: boolean;
  contactBypassQuiet: boolean;
  autoReplyBlocked: boolean;
  /** Text of the message that triggered this turn; absent on nudge turns. */
  triggerText?: string;
  triggerCategory?: string;
};

export type GoalGate = { send: boolean; reason: string };

/**
 * A meeting goal's whole job is to talk about meeting up, but "meeting" and
 * "appointment" are approval-required keywords — applied unfiltered they would
 * gate the goal to a draft on every single turn. The exemption is narrow: only
 * those two words, only for `kind === "meeting"`.
 */
export function keywordsForGoalKind(kind: GoalKind): readonly string[] {
  if (kind !== "meeting") return APPROVAL_REQUIRED_KEYWORDS;
  return APPROVAL_REQUIRED_KEYWORDS.filter(
    (k) => k !== "meeting" && k !== "appointment",
  );
}

/**
 * Decides whether a goal turn may send directly. Every input is a plain value,
 * so this runs *before* the model call — the only gate that needs generated
 * text is isSuspiciousAutoReply, applied afterwards.
 *
 * `send: false` always means "insert a draft", never "skip". A goal that can't
 * send still has something to say; the user just approves it by hand.
 */
export function evaluateGoalGate(input: GoalGateInput): GoalGate {
  if (input.goalMode === "draft") return { send: false, reason: "draft_mode" };
  // A goal is an explicit instruction so it still runs under silent mode, but
  // silently emitting to a chat the user muted the AI on would be surprising.
  if (input.aiMode === "silent") return { send: false, reason: "silent_mode" };
  if (input.autoReplyBlocked) {
    return { send: false, reason: "contact_auto_block" };
  }
  // Parity with decideReplyMode — a group is many third parties at once and an
  // auto-send there is the most public mistake the app can make, so it always
  // goes through a human regardless of mode.
  if (input.isGroup) {
    return { send: false, reason: "group_chat_safety" };
  }
  if (input.quietHoursActive && !input.contactBypassQuiet) {
    return { send: false, reason: "quiet_hours" };
  }
  if (input.triggerCategory && BLOCKED_CATEGORIES.has(input.triggerCategory)) {
    return { send: false, reason: `category_blocked:${input.triggerCategory}` };
  }
  // Nudge turns have no trigger text and deliberately skip this gate: matching
  // against a stale last-inbound would pin a goal to draft forever once the
  // contact had ever mentioned money. Injection risk on nudge turns is covered
  // by isSuspiciousAutoReply, since recent messages are in the prompt.
  if (input.triggerText) {
    const hit = matchApprovalKeyword(
      input.triggerText,
      keywordsForGoalKind(input.goalKind),
    );
    if (hit) return { send: false, reason: `keyword:${hit}` };
  }
  return { send: true, reason: "goal_auto" };
}

// --- Model output parsing ---------------------------------------------------

export type GoalTurnOutput = {
  text: string;
  completed: boolean;
  confidence: number;
  reasoning: string;
  nextNudgeHours?: number;
};

/**
 * Same defensive shape as parseClassification: degrade to safe defaults rather
 * than throw, so a drifting model can't wedge the goal engine.
 */
export function parseGoalTurn(raw: string): GoalTurnOutput {
  const out: GoalTurnOutput = {
    text: "",
    completed: false,
    confidence: 0.5,
    reasoning: "",
  };
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) {
      console.warn("parseGoalTurn: no JSON object in output", {
        rawPreview: raw.slice(0, 200),
      });
      return out;
    }
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      text?: unknown;
      completed?: unknown;
      confidence?: unknown;
      reasoning?: unknown;
      nextNudgeHours?: unknown;
    };
    if (typeof parsed.text === "string") out.text = parsed.text.trim();
    // Strict === true: a stringy "true" is model drift, not consent to stop.
    out.completed = parsed.completed === true;
    if (typeof parsed.reasoning === "string") {
      out.reasoning = parsed.reasoning.trim().slice(0, 200);
    }
    const confidence =
      typeof parsed.confidence === "string"
        ? Number(parsed.confidence)
        : parsed.confidence;
    if (typeof confidence === "number" && Number.isFinite(confidence)) {
      out.confidence = clamp(confidence, 0, 1);
    }
    const nudge =
      typeof parsed.nextNudgeHours === "string"
        ? Number(parsed.nextNudgeHours)
        : parsed.nextNudgeHours;
    if (typeof nudge === "number" && Number.isFinite(nudge)) {
      out.nextNudgeHours = clamp(nudge, MIN_NUDGE_HOURS, MAX_NUDGE_HOURS);
    }
  } catch (err) {
    console.warn("parseGoalTurn: JSON parse failed", {
      rawPreview: raw.slice(0, 200),
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return out;
}

// --- Draft enhancement ------------------------------------------------------

export type GoalDraftFields = {
  title: string;
  instructions: string;
  successCriteria: string;
};

/** Enhancement rewrites a field, so a longer ceiling than the goal text itself. */
const MAX_TITLE_CHARS = 60;
const MAX_INSTRUCTION_CHARS = 600;
const MAX_CRITERIA_CHARS = 300;

/**
 * Parse the enhanced goal fields, falling back to whatever the user typed.
 *
 * The fallback is the whole point: this runs on text the user is still editing,
 * so a model that returns nothing usable must leave their draft exactly as it
 * was. Replacing a half-written instruction with an empty string would be worse
 * than not offering the button at all.
 */
export function parseGoalEnhancement(
  raw: string,
  fallback: GoalDraftFields,
): GoalDraftFields {
  const out: GoalDraftFields = { ...fallback };
  const take = (value: unknown, max: number): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim().slice(0, max);
    return trimmed.length > 0 ? trimmed : null;
  };
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) {
      console.warn("parseGoalEnhancement: no JSON object in output", {
        rawPreview: raw.slice(0, 200),
      });
      return out;
    }
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    out.title = take(parsed.title, MAX_TITLE_CHARS) ?? out.title;
    out.instructions =
      take(parsed.instructions, MAX_INSTRUCTION_CHARS) ?? out.instructions;
    out.successCriteria =
      take(parsed.successCriteria, MAX_CRITERIA_CHARS) ?? out.successCriteria;
  } catch (err) {
    console.warn("parseGoalEnhancement: JSON parse failed", {
      rawPreview: raw.slice(0, 200),
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return out;
}

/**
 * Only a confident completion closes a goal. A hallucinated `completed: true`
 * would otherwise silently kill a goal the user is relying on.
 */
export const COMPLETION_CONFIDENCE_FLOOR = 0.6;

export function isConfidentCompletion(out: GoalTurnOutput): boolean {
  return out.completed && out.confidence >= COMPLETION_CONFIDENCE_FLOOR;
}
