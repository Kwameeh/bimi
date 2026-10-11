import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every write tool has to be wired through three separate files, and a gap in
 * any of them fails silently until a user actually taps Allow:
 *
 *   assistantTools.ts  declares it and queues the confirmation
 *   assistant.ts       runs it in `resolveConfirmation` — a missing branch
 *                      throws "Unknown write tool" only at approval time
 *   confirm-card.tsx   the Allow/Deny copy — falls back to the useless
 *                      "Bimi wants to perform this action."
 *   voiceText.ts       the spoken prompt — falls back to "I need your
 *                      go-ahead for that."
 *
 * These are source-text assertions rather than behavioural ones because the
 * failure is structural: the wiring exists or it doesn't.
 */

const root = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

const toolsSrc = read('convex/assistantTools.ts');
const assistantSrc = read('convex/assistant.ts');
const cardSrc = read('src/components/assistant/confirm-card.tsx');
const voiceSrc = read('convex/voiceText.ts');

const splitAt = toolsSrc.indexOf('export function buildAssistantActionTools');
const TOOL_NAME = /^ {4}([a-zA-Z]+): tool\(\{/gm;

function toolNames(src: string): string[] {
  return [...src.matchAll(TOOL_NAME)].map((m) => m[1]);
}

const readTools = toolNames(toolsSrc.slice(0, splitAt));
const writeTools = toolNames(toolsSrc.slice(splitAt));

describe('assistant tool wiring', () => {
  it('finds both tool sets', () => {
    expect(splitAt).toBeGreaterThan(0);
    expect(readTools.length).toBeGreaterThan(0);
    expect(writeTools.length).toBeGreaterThan(0);
  });

  it.each(writeTools)('%s executes in resolveConfirmation', (name) => {
    expect(assistantSrc).toMatch(new RegExp(`toolName === ['"]${name}['"]`));
  });

  it.each(writeTools)('%s has Allow/Deny card copy', (name) => {
    expect(cardSrc).toMatch(new RegExp(`^ {2}${name}:`, 'm'));
  });

  it.each(writeTools)('%s has a spoken confirmation prompt', (name) => {
    expect(voiceSrc).toMatch(new RegExp(`case ['"]${name}['"]:`));
  });

  it('has no tool name declared in both sets', () => {
    const overlap = readTools.filter((n) => writeTools.includes(n));
    expect(overlap).toEqual([]);
  });
});

describe('tool descriptions', () => {
  const blocks = [...toolsSrc.matchAll(/ {4}([a-zA-Z]+): tool\(\{([\s\S]*?)\n {4}\}\),/g)].map(
    ([, name, body]) => ({ name, body }),
  );

  it('finds a block for every tool', () => {
    expect(blocks.length).toBe(readTools.length + writeTools.length);
  });

  /**
   * A tool that takes an id it cannot produce is unreachable — the model has
   * no way to obtain a valid value. `rejectDraft` and `dismissReminder` both
   * shipped in this state before `listDrafts` / `listReminders` existed.
   */
  const ID_SOURCES: Record<string, string> = {
    draftId: 'listDrafts',
    reminderId: 'listReminders',
    memoryId: 'searchMemories',
    taskId: 'listTasks',
    meetingId: 'listMeetings',
    summaryId: 'getBriefing',
  };

  it.each(blocks)('$name names the source of every id it consumes', ({ body }) => {
    for (const [param, producer] of Object.entries(ID_SOURCES)) {
      if (body.includes(`${param}: z.string()`)) {
        expect(body).toContain(producer);
      }
    }
  });

  it.each(blocks)('$name has a substantial description', ({ body }) => {
    const match = body.match(/description:\s*\n?\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/);
    expect(match).not.toBeNull();
    const desc = match![1] ?? match![2];
    expect(desc).toBeDefined();
    // Short descriptions correlate with mis-selection; the house pattern is
    // purpose + "Use for:" triggers + "Returns:"/id provenance.
    expect(desc.length).toBeGreaterThan(120);
  });
});
