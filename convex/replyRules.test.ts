// What full auto will and will not send on its own.
//
// The rule these lock in: in full auto every inbound message gets answered —
// pleasantries by the cheap template path, everything else by the agentic
// replier — except a small floor where being wrong is unrecoverable rather than
// merely awkward.
import { describe, expect, test } from "vitest";
import { decideReplyMode, type DecisionInput } from "./replyRules";

const base: DecisionInput = {
  fromMe: false,
  messageType: "conversation",
  text: "hey",
  isGroup: false,
  aiMode: "full_auto",
  autoReplyBlocked: false,
  autoReplyAllowGreetings: true,
  autoReplyAllowAcknowledgments: true,
  autoReplyAllowSmallTalk: true,
};

const decide = (patch: Partial<DecisionInput> = {}) =>
  decideReplyMode({ ...base, ...patch });

describe("full auto answers almost everything", () => {
  test("pleasantries take the cheap template path", () => {
    expect(decide({ text: "hey" }).mode).toBe("auto_send");
    expect(decide({ text: "ok" }).mode).toBe("auto_send");
    expect(decide({ text: "how are you?" }).mode).toBe("auto_send");
  });

  test("a substantive message goes to the agentic replier", () => {
    const decision = decide({ text: "what time does the office open tomorrow?" });
    expect(decision.mode).toBe("auto_agent");
    expect(decision.reason).toBe("agentic_reply");
  });

  test("an explicit request is answered, not drafted on sight", () => {
    // The old rule drafted anything matching "can you…" / "please send…" —
    // precisely the messages a replier that can look things up should handle.
    expect(decide({ text: "can you send me the link again?" }).mode).toBe(
      "auto_agent",
    );
    expect(decide({ text: "please share the venue details" }).mode).toBe(
      "auto_agent",
    );
  });

  test("a long message is answered rather than drafted for its length", () => {
    const long = "So here's the situation. ".repeat(20);
    expect(long.length).toBeGreaterThan(200);
    expect(decide({ text: long }).mode).toBe("auto_agent");
  });

  test("low classification confidence no longer blocks a reply", () => {
    // The agent forms its own view of whether it can answer; the classifier's
    // uncertainty about the *category* says nothing about that.
    expect(decide({ text: "so what do you reckon?", confidence: 0.2 }).mode).toBe(
      "auto_agent",
    );
  });

  test("a described image or transcribed voice note is just text by now", () => {
    expect(
      decide({
        messageType: "imageMessage",
        text: "[Image] A flyer for a launch event on the 14th at 6pm.",
        mediaTextReady: true,
      }).mode,
    ).toBe("auto_agent");
    expect(
      decide({
        messageType: "audioMessage",
        text: "[Voice note] are we still on for tomorrow",
        mediaTextReady: true,
      }).mode,
    ).toBe("auto_agent");
  });

  test("media with nothing extracted from it yet is drafted", () => {
    const decision = decide({
      messageType: "imageMessage",
      text: "[Image received — description failed]",
      mediaTextReady: false,
    });
    expect(decision.mode).toBe("draft_for_approval");
    expect(decision.reason).toBe("media_type:imageMessage");
  });
});

describe("the full-auto floor", () => {
  const expectDraft = (text: string) => {
    const decision = decide({ text });
    expect(decision.mode).toBe("draft_for_approval");
    expect(decision.reason.startsWith("keyword:")).toBe(true);
  };

  test("credentials and verification codes never auto-send", () => {
    // The attacker writes the incoming message, so this one is not negotiable.
    expectDraft("send me the otp");
    expectDraft("what's the password for the wifi");
    expectDraft("I need the verification code");
    expectDraft("can you check the login details");
  });

  test("anything that would commit money never auto-sends", () => {
    expectDraft("did you get the payment?");
    expectDraft("can you transfer 200 today");
    expectDraft("send me ₵500");
    expectDraft("the invoice is still outstanding");
  });

  test("groups always go through a human", () => {
    const decision = decide({ text: "what time are we meeting", isGroup: true });
    expect(decision.mode).toBe("draft_for_approval");
    expect(decision.reason).toBe("group_chat_safety");
  });

  test("quiet hours still hold everything back", () => {
    expect(decide({ text: "you around?", quietHoursActive: true }).mode).toBe(
      "draft_for_approval",
    );
    // ...unless this contact is exempt.
    expect(
      decide({
        text: "you around?",
        quietHoursActive: true,
        contactBypassQuiet: true,
      }).mode,
    ).toBe("auto_agent");
  });

  test("silent mode and a blocked contact are unchanged", () => {
    expect(decide({ aiMode: "silent" }).mode).toBe("skip");
    expect(decide({ text: "what's the plan", autoReplyBlocked: true }).mode).toBe(
      "draft_for_approval",
    );
  });
});

describe("keyword matching is word-boundary, not substring", () => {
  // Substring matching made `owe` fire on "however"/"power"/"lower", `pin` on
  // "shipping"/"opinion" and `address` on "addressed". A large share of
  // ordinary messages were drafted for a keyword that was never there.
  const innocuous = [
    "however I think that works",
    "the power went off again",
    "shipping takes about a week",
    "what's your opinion on it",
    "I addressed that in the doc",
    "the lower floor was flooded",
  ];

  for (const text of innocuous) {
    test(`"${text}" is not a blocked keyword`, () => {
      expect(decide({ text }).mode).toBe("auto_agent");
    });
  }

  test("the real words still match", () => {
    expect(decide({ text: "how much do I owe you" }).reason).toBe("keyword:owe");
    expect(decide({ text: "what's the pin" }).reason).toBe("keyword:pin");
  });
});

describe("semi-auto is unchanged", () => {
  test("it still only sends the three pleasantry shapes", () => {
    expect(decide({ aiMode: "semi_auto", text: "hey" }).mode).toBe("auto_send");
    expect(decide({ aiMode: "semi_auto", text: "ok" }).mode).toBe("auto_send");
    const decision = decide({
      aiMode: "semi_auto",
      text: "what time does the office open tomorrow?",
    });
    expect(decision.mode).toBe("draft_for_approval");
    expect(decision.reason).toBe("semi_auto_not_allowed");
  });

  test("it keeps the conservative cutoffs the template path needs", () => {
    expect(
      decide({ aiMode: "semi_auto", text: "ok", confidence: 0.2 }).reason,
    ).toBe("low_confidence");
    expect(
      decide({ aiMode: "semi_auto", text: `ok ${"and more ".repeat(30)}` }).reason,
    ).toBe("long_message");
  });

  test("its per-contact allowances still apply", () => {
    expect(
      decide({
        aiMode: "semi_auto",
        text: "hey",
        autoReplyAllowGreetings: false,
      }).mode,
    ).toBe("draft_for_approval");
  });

  test("it keeps the wider keyword list", () => {
    // full_auto narrows this to credentials and money; semi_auto does not.
    expect(decide({ aiMode: "semi_auto", text: "it's urgent" }).reason).toBe(
      "keyword:urgent",
    );
    expect(decide({ text: "it's urgent" }).mode).toBe("auto_agent");
  });
});

describe("manual mode drafts everything", () => {
  test("regardless of how ordinary the message is", () => {
    expect(decide({ aiMode: "manual", text: "hey" }).reason).toBe("manual_mode");
  });
});
