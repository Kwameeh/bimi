import { describe, expect, test } from "vitest";
import {
  DEFAULT_AUTO_REPLY_MAX_CHARS,
  deriveReplyStyle,
  formatReplyStyleGuidance,
} from "./replyStyle";

describe("deriveReplyStyle", () => {
  test("learns concise per-contact length without exceeding the auto-send ceiling", () => {
    const style = deriveReplyStyle({
      userTexts: [
        "yeah I'm good",
        "charley that's fine",
        "we can do friday",
        "cool, send it",
        "I'll check",
      ],
      contactTexts: ["Okay, sounds good", "Nice one"],
    });
    expect(style.targetWords).toBeGreaterThanOrEqual(4);
    expect(style.targetWords).toBeLessThanOrEqual(8);
    expect(style.maxChars).toBeLessThanOrEqual(DEFAULT_AUTO_REPLY_MAX_CHARS);
    expect(style.summary).toContain("words");
    expect(style.examples.length).toBeLessThanOrEqual(6);
  });

  test("contact emoji use is only a weak signal when the user rarely uses them", () => {
    const style = deriveReplyStyle({
      userTexts: ["sounds good", "see you later", "I will check that"],
      contactTexts: ["okay 😂", "nice 😂", "perfect 😂"],
    });
    expect(style.emojiRate).toBeGreaterThan(0);
    expect(style.emojiRate).toBeLessThan(0.2);
    expect(style.commonEmojis).toContain("😂");
  });

  test("approved and edited drafts become style examples", () => {
    const style = deriveReplyStyle({
      userTexts: ["okay"],
      approvedDraftTexts: ["yeah we can do that tomorrow"],
    });
    expect(style.sampleCount).toBe(2);
    expect(style.examples).toContain("yeah we can do that tomorrow");
  });
});

describe("formatReplyStyleGuidance", () => {
  test("keeps explicit tone instructions above learned examples", () => {
    const result = formatReplyStyleGuidance({
      profile: {
        summary: "Usually about 8 words; relaxed casing; an occasional emoji fits",
        targetWords: 8,
        maxChars: 150,
        emojiRate: 0.25,
        commonEmojis: ["😂"],
        examples: ["yeah that's cool"],
        contactExamples: ["nice one"],
      },
      defaultTone: "custom",
      customTone: "Keep client replies professional",
    });
    expect(result.maxChars).toBe(150);
    expect(result.guidance).toContain("At most one emoji");
    expect(result.guidance).toContain(
      "Highest-priority custom instruction: Keep client replies professional",
    );
  });
});

