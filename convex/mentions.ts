import { ACK_PATTERN } from "./replyRules";

export type MentionReason =
  | "jid_mention"
  | "reply_to_me"
  | "name_match"
  | "phone_match";

export type Owner = {
  jid?: string;
  phone?: string;
  name?: string;
  aliases?: string[];
};

export type MentionResult = {
  mentionsUser: boolean;
  reason?: MentionReason;
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripPhone(phone: string): string {
  return phone.replace(/^\+/, "").replace(/^0+/, "").replace(/\D/g, "");
}

export function detectMentions(args: {
  text: string;
  mentionedJids?: string[];
  quotedParticipant?: string;
  owner: Owner;
}): MentionResult {
  const { text, mentionedJids, quotedParticipant, owner } = args;

  if (owner.jid) {
    if (mentionedJids && mentionedJids.includes(owner.jid)) {
      return { mentionsUser: true, reason: "jid_mention" };
    }
    if (quotedParticipant && quotedParticipant === owner.jid) {
      return { mentionsUser: true, reason: "reply_to_me" };
    }
  }

  const tokens: string[] = [];
  if (owner.name && owner.name.trim().length >= 2) {
    tokens.push(owner.name.trim());
  }
  if (owner.aliases) {
    for (const a of owner.aliases) {
      if (a && a.trim().length >= 2) tokens.push(a.trim());
    }
  }

  if (tokens.length > 0 && text) {
    const pattern = new RegExp(
      "\\b(" + tokens.map(escapeRegex).join("|") + ")\\b",
      "i",
    );
    if (pattern.test(text)) {
      return { mentionsUser: true, reason: "name_match" };
    }
  }

  if (owner.phone && text) {
    const stripped = stripPhone(owner.phone);
    if (stripped.length >= 7) {
      const cleanedText = text.replace(/\D/g, "");
      if (cleanedText.includes(stripped)) {
        return { mentionsUser: true, reason: "phone_match" };
      }
    }
  }

  return { mentionsUser: false };
}

const SINGLE_EMOJI_PATTERN = /^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}‍♀-♂☀-⛿✀-➿]{1,4}$/u;

export function isNoiseMessage(args: {
  text: string;
  messageType: string;
  mentionsUser?: boolean;
}): boolean {
  if (args.mentionsUser) return false;
  if (args.messageType === "stickerMessage") return true;
  const t = (args.text ?? "").trim();
  if (t.length === 0) return false;
  if (t.length <= 6 && ACK_PATTERN.test(t)) return true;
  if (SINGLE_EMOJI_PATTERN.test(t)) return true;
  return false;
}
