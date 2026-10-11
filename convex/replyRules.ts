export const ACK_PATTERN = /^(ok+|kk+|k|thanks?|thx|ty|tysm|thank you|got it|noted|sure|cool|nice|great|awesome|perfect|alright|aight|👍+|🙏+|❤️+|😂+|🤣+|lol+|haha+|hehe+|yes+|yep|yeah|ya|no+|nope|nah|np|welcome|you're welcome|youre welcome|yw|bet|word|true|right|exactly|same|me too|same here)[.!?\s]*$/i;

export const GREETING_PATTERN = /^(hi+|hello+|hey+|heya|hiya|yo+|sup|wassup|what'?s up|howdy|good\s*(morning|afternoon|evening|night|day)|gm|gn|ga|ge|morning|evening|night)[.!?\s,]*$/i;

export const SMALL_TALK_PATTERN = /^(how\s*(are|r|is|'?s|have)\s*(you|u|it|things|life|things going|you been|you doing|u been|u doing|your day|ur day)|how\s*you\s*dey|how\s*body|how\s*far|how'?s\s*(it going|everything|life|the day|your day|ur day)|what\s*(are|r|'?re)?\s*(you|u)\s*(up to|doing|been up to)?|whatcha\s*doing|wyd|what\s*you\s*sayin'?|hope\s*(you|u)\s*(are|'?re)?\s*(well|good|doing well|doing good)|nice to (hear|see) (from )?you|long time no see|been a while|miss(ed)? you|thinking of you)[\s,.?!]*$/i;

export const APPROVAL_REQUIRED_KEYWORDS = [
  "money", "payment", "transfer", "wire", "deposit", "refund", "invoice", "owe", "debt",
  "password", "otp", "pin", "verify", "verification", "login",
  "address", "meeting", "appointment",
  "urgent", "asap", "emergency", "deadline",
  "$", "€", "£", "₵", "ghs", "usd",
];

/**
 * The full-auto floor. Everything else in full auto gets an agentic reply that
 * researches before it answers; these two families never do, because a wrong
 * autonomous answer here is unrecoverable rather than merely awkward.
 *
 * Credentials: sending a code or password to whoever asked is the whole shape
 * of an account-takeover attack, and the attacker writes the incoming message.
 * Money: a reply that agrees to an amount or a transfer commits the user.
 */
export const CREDENTIAL_KEYWORDS = [
  "password", "passcode", "otp", "pin", "2fa", "mfa",
  "verification", "verify", "login", "credential", "authenticator",
];

export const MONEY_KEYWORDS = [
  "money", "payment", "pay", "transfer", "wire", "deposit", "refund",
  "invoice", "owe", "debt", "momo", "cash",
  "$", "€", "£", "₵", "ghs", "usd",
];

export const FULL_AUTO_BLOCK_KEYWORDS = [
  ...CREDENTIAL_KEYWORDS,
  ...MONEY_KEYWORDS,
];

/**
 * Categories that stay on drafts in full auto. Narrower than BLOCKED_CATEGORIES
 * — a client issue or a deadline is exactly the kind of message the agentic
 * path can answer well once it has looked things up, so gating those was the
 * main reason full auto felt like it never replied.
 */
export const FULL_AUTO_BLOCKED_CATEGORIES = new Set(["payment"]);

export const ACTION_REQUEST_PATTERN =
  /\b(can|could|would|will)\s+(you|u|ya)\b|\bplease\s+(send|share|give|do|tell|show|help|remind|forward|reply|respond|check|confirm|let me know)\b|\b(send|share|give|show|remind|forward|email|text)\s+(me|us|him|her|them|it)\b|^please\b/i;

// Word-boundary keyword matching. `decideReplyMode` below still uses plain
// substring matching (changing it would alter existing reply behaviour), but
// callers that gate *conversational* text need this: substring matching makes
// "shipping" and "opinion" hit `pin`, and "addressed" hit `address`. Harmless
// for the 2-8 word acknowledgements decideReplyMode sees, corrosive for a
// contact-goal turn that produces full sentences.
const ALPHA_KEYWORD = /^[a-z]+$/;
const keywordMatcherCache = new Map<string, RegExp | null>();

function keywordMatcher(keyword: string): RegExp | null {
  const cached = keywordMatcherCache.get(keyword);
  if (cached !== undefined) return cached;
  const matcher = ALPHA_KEYWORD.test(keyword)
    ? new RegExp(`\\b${keyword}\\b`, "i")
    : null; // symbol keywords ($, €, ₵…) have no word boundary — substring is correct
  keywordMatcherCache.set(keyword, matcher);
  return matcher;
}

/** Returns the first keyword present in `text`, or null. */
export function matchApprovalKeyword(
  text: string,
  keywords: readonly string[] = APPROVAL_REQUIRED_KEYWORDS,
): string | null {
  const lower = text.toLowerCase();
  for (const keyword of keywords) {
    const matcher = keywordMatcher(keyword);
    if (matcher ? matcher.test(lower) : lower.includes(keyword)) return keyword;
  }
  return null;
}

// Guard for auto-sent text — the only path that emits to a third party with no
// human review. A long or instruction-shaped reply suggests the incoming
// message manipulated the model (prompt injection); suspicious text is
// downgraded to a draft for approval, never sent silently.
//
// `maxChars` is a parameter because the calibration differs by caller:
// inbound auto-replies are 2-8 words by design (240), while a contact-goal turn
// has to answer the contact *and* advance the goal, so it legitimately runs
// longer (GOAL_AUTO_REPLY_MAX_CHARS in goalRules.ts).
export const SUSPICIOUS_REPLY_PATTERNS: RegExp[] = [
  /\bas an ai\b/i,
  /\blanguage model\b/i,
  /\bsystem prompt\b/i,
  /\bmy (instructions|rules|guidelines)\b/i,
  /\bignore (all|any|previous|prior|your)\b/i,
  /\bi (cannot|can't|won't) (comply|assist|do that)\b/i,
  /```/,
];
export const AUTO_REPLY_MAX_CHARS = 240;
/**
 * The agentic replier answers real questions rather than echoing pleasantries,
 * so it legitimately runs longer than the 2-8 word template path. Same reasoning
 * as GOAL_AUTO_REPLY_MAX_CHARS in goalRules.ts.
 */
export const AGENT_REPLY_MAX_CHARS = 280;

export function isSuspiciousAutoReply(
  reply: string,
  maxChars: number = AUTO_REPLY_MAX_CHARS,
): boolean {
  if (reply.length > maxChars) return true;
  return SUSPICIOUS_REPLY_PATTERNS.some((p) => p.test(reply));
}

export type AiMode = "manual" | "semi_auto" | "full_auto" | "silent";

export type ReplyDecision =
  /** Cheap template reply, sent immediately. */
  | { mode: "auto_send"; reason: string }
  /** Research the answer, then send it — the full-auto workhorse. */
  | { mode: "auto_agent"; reason: string }
  | { mode: "draft_for_approval"; reason: string }
  | { mode: "skip"; reason: string };

export type DecisionInput = {
  fromMe: boolean;
  messageType: string;
  text: string;
  isGroup: boolean;
  aiMode: AiMode;
  autoReplyBlocked: boolean;
  autoReplyAllowGreetings: boolean;
  autoReplyAllowAcknowledgments: boolean;
  autoReplyAllowSmallTalk: boolean;
  category?: string;
  confidence?: number;
  quietHoursActive?: boolean;
  contactBypassQuiet?: boolean;
  /**
   * For non-text messages: the image description or voice transcript is on the
   * message and usable. Without it there is nothing to reply *to*, so the
   * message is drafted no matter the mode.
   */
  mediaTextReady?: boolean;
};

export const BLOCKED_CATEGORIES = new Set([
  "payment",
  "client_issue",
  "deadline",
  "school",
]);

export function decideReplyMode(args: DecisionInput): ReplyDecision {
  if (args.fromMe) return { mode: "skip", reason: "outgoing_message" };
  if (args.aiMode === "silent") return { mode: "skip", reason: "silent_mode" };

  if (args.quietHoursActive && !args.contactBypassQuiet) {
    return { mode: "draft_for_approval", reason: "quiet_hours" };
  }

  const isTextOnly =
    args.messageType === "conversation" ||
    args.messageType === "extendedTextMessage";
  const isFullAuto = args.aiMode === "full_auto";
  // An image or voice note that has already been described/transcribed is just
  // text by the time it reaches here, and full auto is meant to handle it.
  // Anything still processing (or whose processing failed) has no content to
  // reply to, so it is drafted regardless of mode.
  if (!isTextOnly && !(isFullAuto && args.mediaTextReady === true)) {
    return { mode: "draft_for_approval", reason: `media_type:${args.messageType}` };
  }

  const text = args.text.trim();
  if (text.length === 0) {
    return { mode: "draft_for_approval", reason: "empty_text" };
  }

  if (args.aiMode === "manual") {
    return { mode: "draft_for_approval", reason: "manual_mode" };
  }
  if (args.autoReplyBlocked) {
    return { mode: "draft_for_approval", reason: "contact_auto_block" };
  }

  // A group is many third parties at once — the most public place to be wrong.
  if (args.isGroup) {
    return { mode: "draft_for_approval", reason: "group_chat_safety" };
  }

  const blockedCategories = isFullAuto
    ? FULL_AUTO_BLOCKED_CATEGORIES
    : BLOCKED_CATEGORIES;
  if (args.category && blockedCategories.has(args.category)) {
    return {
      mode: "draft_for_approval",
      reason: `category_blocked:${args.category}`,
    };
  }

  // Word-boundary matching, not substring. Substring matching made `owe` fire
  // on "however"/"power"/"lower", `pin` on "shipping"/"opinion" and `address`
  // on "addressed" — a large share of ordinary messages were drafted for a
  // keyword that was never really there.
  const keywordHit = matchApprovalKeyword(
    text,
    isFullAuto ? FULL_AUTO_BLOCK_KEYWORDS : APPROVAL_REQUIRED_KEYWORDS,
  );
  if (keywordHit) {
    return { mode: "draft_for_approval", reason: `keyword:${keywordHit}` };
  }

  const isAck = ACK_PATTERN.test(text);
  const isGreeting = GREETING_PATTERN.test(text);
  const isSmallTalk = SMALL_TALK_PATTERN.test(text);

  if (args.aiMode === "semi_auto") {
    // Everything below is calibrated for the template generator, which only
    // knows how to produce a 2-8 word pleasantry — hence the conservative
    // length, confidence and action-request cutoffs. full_auto skips them
    // because it routes to a replier that can actually look things up.
    if (typeof args.confidence === "number" && args.confidence < 0.6) {
      return { mode: "draft_for_approval", reason: "low_confidence" };
    }
    if (text.length > 200) {
      return { mode: "draft_for_approval", reason: "long_message" };
    }
    if (isAck && args.autoReplyAllowAcknowledgments) {
      return { mode: "auto_send", reason: "acknowledgment" };
    }
    if (isGreeting && args.autoReplyAllowGreetings) {
      return { mode: "auto_send", reason: "greeting" };
    }
    if (isSmallTalk && args.autoReplyAllowSmallTalk) {
      return { mode: "auto_send", reason: "small_talk" };
    }
    return { mode: "draft_for_approval", reason: "semi_auto_not_allowed" };
  }

  // full_auto from here. Pleasantries keep the cheap template path — running a
  // research agent to answer "ok" would be absurd — and everything else,
  // including the long messages and explicit requests that used to be drafted
  // on sight, goes to the agentic replier.
  if (isAck) return { mode: "auto_send", reason: "acknowledgment" };
  if (isGreeting) return { mode: "auto_send", reason: "greeting" };
  if (isSmallTalk) return { mode: "auto_send", reason: "small_talk" };
  return { mode: "auto_agent", reason: "agentic_reply" };
}
