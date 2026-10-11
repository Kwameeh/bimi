// Unit tests for the pure LLM-output parsers. These lock in the "backstop
// still works" guarantee now that prompts use guided JSON (response_format /
// generateObject): even if a model drifts back to code fences, preamble, or
// truncated output, the parsers must degrade safely instead of throwing.
import { describe, expect, test } from "vitest";
import { parseClassification } from "./classification";
import { parseExtraction } from "./extraction";
import { parseMeetingExtraction } from "./meetings";
import { parseProposals } from "./memoryExtraction";
import { parseImageClassification, parseStructuredVision } from "./media";
import { parseLlmTrends } from "./trends";
import { parseActionPlan } from "./summaries";
import { parseFollowUps } from "./assistantFollowUps";
import { formatDateContext } from "./dateContext";

describe("parseClassification", () => {
  test("valid JSON", () => {
    expect(
      parseClassification('{"category":"payment","priority":"urgent","confidence":0.9}'),
    ).toEqual({ category: "payment", priority: "urgent", confidence: 0.9 });
  });

  test("code-fenced JSON", () => {
    expect(
      parseClassification('```json\n{"category":"meeting","priority":"high","confidence":0.8}\n```'),
    ).toEqual({ category: "meeting", priority: "high", confidence: 0.8 });
  });

  test("leading prose", () => {
    expect(
      parseClassification('Sure! Here is the JSON: {"category":"greeting","priority":"low","confidence":0.95}'),
    ).toEqual({ category: "greeting", priority: "low", confidence: 0.95 });
  });

  test("invalid enum values fall back to defaults", () => {
    expect(
      parseClassification('{"category":"banana","priority":"mega","confidence":0.7}'),
    ).toEqual({ category: "unknown", priority: "normal", confidence: 0.7 });
  });

  test("confidence clamped to 0..1", () => {
    expect(
      parseClassification('{"category":"spam","priority":"low","confidence":7}').confidence,
    ).toBe(1);
  });

  test("truncated JSON returns defaults", () => {
    expect(parseClassification('{"category":"payment","prio')).toEqual({
      category: "unknown",
      priority: "normal",
      confidence: 0.5,
    });
  });

  test("no JSON at all returns defaults", () => {
    expect(parseClassification("I cannot classify this message.")).toEqual({
      category: "unknown",
      priority: "normal",
      confidence: 0.5,
    });
  });
});

describe("parseExtraction", () => {
  test("valid items", () => {
    const items = parseExtraction(
      '{"items":[{"kind":"task","title":"Send the proposal","description":null,"dueAt":"2026-06-06T17:00:00+01:00","priority":"high"}]}',
    );
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("task");
    expect(items[0].title).toBe("Send the proposal");
    expect(items[0].dueAt).toBe(new Date("2026-06-06T17:00:00+01:00").getTime());
    expect(items[0].priority).toBe("high");
  });

  test("caps at 3 items", () => {
    const many = JSON.stringify({
      items: Array.from({ length: 6 }, (_, i) => ({ kind: "task", title: `t${i}` })),
    });
    expect(parseExtraction(many)).toHaveLength(3);
  });

  test("drops items without a title", () => {
    expect(
      parseExtraction('{"items":[{"kind":"task"},{"kind":"task","title":"ok"}]}'),
    ).toHaveLength(1);
  });

  test("unknown kind coerces to task", () => {
    expect(parseExtraction('{"items":[{"kind":"todo","title":"x"}]}')[0].kind).toBe("task");
  });

  test("invalid dueAt string is dropped, item kept", () => {
    const items = parseExtraction('{"items":[{"kind":"task","title":"x","dueAt":"whenever"}]}');
    expect(items[0].dueAt).toBeUndefined();
  });

  test("garbage returns empty", () => {
    expect(parseExtraction("no json here")).toEqual([]);
    expect(parseExtraction('{"items": [{')).toEqual([]);
  });
});

describe("parseMeetingExtraction", () => {
  const now = new Date("2026-06-04T12:00:00Z").getTime();

  test("valid proposal", () => {
    const out = parseMeetingExtraction(
      '{"title":"Design review","proposedTimes":[{"startAt":"2026-06-05T15:00:00+01:00","label":"tomorrow 3pm","durationMinutes":30}],"confirmationDraft":"See you then!"}',
      now,
    );
    expect(out.title).toBe("Design review");
    expect(out.proposedTimes).toHaveLength(1);
    expect(out.confirmationDraft).toBe("See you then!");
  });

  test("past times are dropped", () => {
    const out = parseMeetingExtraction(
      '{"proposedTimes":[{"startAt":"2020-01-01T10:00:00Z"}],"confirmationDraft":"ok"}',
      now,
    );
    expect(out.proposedTimes).toHaveLength(0);
  });

  test("durationMinutes clamped to 5..480", () => {
    const out = parseMeetingExtraction(
      `{"proposedTimes":[{"startAt":"2026-06-05T15:00:00Z","durationMinutes":10000}],"confirmationDraft":"ok"}`,
      now,
    );
    expect(out.proposedTimes[0].durationMinutes).toBe(480);
  });

  test("garbage returns empty proposedTimes", () => {
    expect(parseMeetingExtraction("nope", now)).toEqual({ proposedTimes: [] });
  });
});

describe("parseProposals", () => {
  test("valid proposals", () => {
    const out = parseProposals(
      '{"proposals":[{"scope":"contact","type":"fact","content":"Sarah works at Wartech","confidence":0.9}]}',
    );
    expect(out).toHaveLength(1);
    expect(out[0].scope).toBe("contact");
  });

  test("caps at 6 and drops empty/oversized content", () => {
    const many = JSON.stringify({
      proposals: Array.from({ length: 9 }, (_, i) => ({
        scope: "user",
        type: "fact",
        content: i === 0 ? "" : `fact ${i}`,
        confidence: 0.8,
      })),
    });
    const out = parseProposals(many);
    expect(out.length).toBeLessThanOrEqual(6);
    expect(out.every((p) => p.content.length > 0)).toBe(true);
  });

  test("garbage returns empty", () => {
    expect(parseProposals("")).toEqual([]);
    expect(parseProposals("not json")).toEqual([]);
  });
});

describe("parseImageClassification", () => {
  test("valid", () => {
    expect(
      parseImageClassification('{"imageType":"receipt","extractedFields":{"amount":"50"}}'),
    ).toEqual({ imageType: "receipt", extractedFields: { amount: "50" } });
  });

  test("normalizes spaces/hyphens in type", () => {
    expect(parseImageClassification('{"imageType":"server-error","extractedFields":{}}').imageType).toBe(
      "server_error",
    );
  });

  test("unknown type falls back to other", () => {
    expect(parseImageClassification('{"imageType":"selfie","extractedFields":{}}').imageType).toBe(
      "other",
    );
  });

  test("garbage falls back to other/empty", () => {
    expect(parseImageClassification("???")).toEqual({ imageType: "other", extractedFields: {} });
  });
});

describe("parseStructuredVision", () => {
  test("valid", () => {
    const out = parseStructuredVision(
      '{"description":"A bank transfer receipt for GHS 200","imageType":"receipt","extractedFields":{"amount":"200","currency":"GHS"}}',
    );
    expect(out).not.toBeNull();
    expect(out!.imageType).toBe("receipt");
    expect(out!.description).toContain("receipt");
  });

  test("missing description returns null (caller falls back to two-hop)", () => {
    expect(parseStructuredVision('{"imageType":"receipt","extractedFields":{}}')).toBeNull();
  });

  test("garbage returns null", () => {
    expect(parseStructuredVision("just words")).toBeNull();
  });
});

describe("parseLlmTrends", () => {
  const validMsgIds = new Set(["m1", "m2"]);
  const validContactIds = new Set(["c1"]);

  test("keeps only ids present in input (hallucinated ids dropped)", () => {
    const out = parseLlmTrends(
      '{"trends":[{"label":"Wartech project","messageIds":["m1","FAKE"],"contactIds":["c1","ALSO_FAKE"]}]}',
      validMsgIds,
      validContactIds,
    );
    expect(out).toHaveLength(1);
    expect(out[0].messageIds).toEqual(["m1"]);
    expect(out[0].contactIds).toEqual(["c1"]);
  });

  test("drops trends with zero valid ids", () => {
    const out = parseLlmTrends(
      '{"trends":[{"label":"Ghost trend","messageIds":["FAKE"],"contactIds":[]}]}',
      validMsgIds,
      validContactIds,
    );
    expect(out).toHaveLength(0);
  });

  test("garbage returns empty", () => {
    expect(parseLlmTrends("nope", validMsgIds, validContactIds)).toEqual([]);
  });
});

describe("parseActionPlan", () => {
  test("valid plan", () => {
    const out = parseActionPlan(
      '{"plan":[{"order":1,"action":"Reply to Alvin","reason":"urgent payment","priority":"urgent","contactId":"c1","sourceMessageId":"m1"}]}',
    );
    expect(out).toHaveLength(1);
    expect(out[0].action).toBe("Reply to Alvin");
  });

  test("caps at 7 items", () => {
    const many = JSON.stringify({
      plan: Array.from({ length: 10 }, (_, i) => ({
        order: i + 1,
        action: `Do thing ${i}`,
        priority: "normal",
      })),
    });
    expect(parseActionPlan(many).length).toBeLessThanOrEqual(7);
  });

  test("garbage returns empty", () => {
    expect(parseActionPlan("no plan")).toEqual([]);
    expect(parseActionPlan('{"plan":[{')).toEqual([]);
  });
});

describe("parseFollowUps", () => {
  test("valid", () => {
    expect(
      parseFollowUps('{"questions":["What about Sarah?","Any meetings today?","Show urgent items"]}'),
    ).toHaveLength(3);
  });

  test("drops empty and >80 char questions, caps at 3", () => {
    const out = parseFollowUps(
      JSON.stringify({ questions: ["", "x".repeat(100), "ok?", "two?", "three?", "four?"] }),
    );
    expect(out).toEqual(["ok?", "two?", "three?"]);
  });

  test("garbage returns empty", () => {
    expect(parseFollowUps("")).toEqual([]);
    expect(parseFollowUps("not json")).toEqual([]);
  });
});

describe("formatDateContext", () => {
  test("includes weekday, date, time, offset, and timezone name", () => {
    const out = formatDateContext("Africa/Lagos");
    expect(out).toMatch(
      /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{4}-\d{2}-\d{2} \d{2}:\d{2} GMT[+-]\d{2}:\d{2} \(Africa\/Lagos\)$/,
    );
    expect(out).toContain("GMT+01:00");
  });

  test("falls back to UTC for missing or invalid timezone", () => {
    expect(formatDateContext(null)).toContain("(UTC)");
    expect(formatDateContext("Not/AZone")).toContain("(UTC)");
  });
});
