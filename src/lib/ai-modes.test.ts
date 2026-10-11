import { describe, expect, it } from 'vitest';
import { AI_MODE_OPTIONS, type AiMode } from './ai-modes';

describe('ai-modes', () => {
  it('defines the expected four AI modes', () => {
    const values = AI_MODE_OPTIONS.map((opt) => opt.value);
    const expectedModes: AiMode[] = ['manual', 'semi_auto', 'full_auto', 'silent'];
    expect(values).toEqual(expectedModes);
  });

  it('provides non-empty labels and descriptions for all modes', () => {
    for (const opt of AI_MODE_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0);
      expect(opt.description.length).toBeGreaterThan(0);
    }
  });

  it('has unique values for each mode', () => {
    const values = AI_MODE_OPTIONS.map((opt) => opt.value);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
  });
});
