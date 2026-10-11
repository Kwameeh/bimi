import { describe, expect, it } from 'vitest';
import { INSTANCE, useInstance } from './instance';

describe('instance module', () => {
  it('exports a valid non-empty default or configured instance', () => {
    expect(INSTANCE).toBeDefined();
    expect(typeof INSTANCE).toBe('string');
    expect(INSTANCE.length).toBeGreaterThan(0);
  });

  it('useInstance returns the defined instance', () => {
    expect(useInstance()).toBe(INSTANCE);
  });
});
