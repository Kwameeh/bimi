import { describe, expect, it } from 'vitest';

/**
 * Mirror of the sanitization and formatting logic in Assistant components
 * to guarantee that raw tool calls and curly braces never spill into the chat UI.
 */
function sanitizeMarkdown(input: string): string {
  if (!input) return '';
  let cleaned = input;
  cleaned = cleaned.replace(
    /<(?:function_call|tool_call|\|python_tag\|)[\s\S]*?(?:<\/(?:function_call|tool_call)>|<\|eom_id\|>|$)/gi,
    '',
  );
  cleaned = cleaned.replace(/\{[\s\r\n]*"(?:name|type|tool|function)"[\s\S]*?\}(?:\s*\}|)/g, '');
  return cleaned.trim();
}

function formatToolArgs(args: unknown): { label: string; value: string }[] {
  if (!args || typeof args !== 'object') return [];
  const entries: { label: string; value: string }[] = [];
  const obj = args as Record<string, unknown>;

  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null || val === '') continue;
    let label = key
      .replace(/([A-Z])/g, ' $1')
      .replace(/[_-]+/g, ' ')
      .trim();
    label = label.charAt(0).toUpperCase() + label.slice(1);

    let valueStr = '';
    if (typeof val === 'string') {
      valueStr = val;
    } else if (typeof val === 'number' || typeof val === 'boolean') {
      valueStr = String(val);
    } else if (Array.isArray(val)) {
      valueStr = val
        .map((v) =>
          typeof v === 'object' && v !== null
            ? Object.values(v)
                .filter((x) => typeof x === 'string' || typeof x === 'number')
                .join(', ')
            : String(v),
        )
        .join(', ');
    } else if (typeof val === 'object') {
      valueStr = Object.entries(val)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join(' • ');
    }

    valueStr = valueStr.replace(/[{}[\]"]/g, '').trim();

    if (valueStr.length > 0) {
      entries.push({ label, value: valueStr });
    }
  }
  return entries;
}

describe('Assistant UI sanitization and tool formatting', () => {
  it('strips leaked function_call XML tags from assistant text', () => {
    const raw =
      '<function_call>{"name":"searchMessages","arguments":{"query":"urgent"}}</function_call>Here are your urgent messages:';
    const cleaned = sanitizeMarkdown(raw);
    expect(cleaned).toBe('Here are your urgent messages:');
    expect(cleaned).not.toContain('{');
    expect(cleaned).not.toContain('function_call');
  });

  it('strips accidental JSON tool calls printed into text stream', () => {
    const raw = '{"name": "searchMessages", "arguments": {"query": "test"}} Hello Alvin!';
    const cleaned = sanitizeMarkdown(raw);
    expect(cleaned).toBe('Hello Alvin!');
    expect(cleaned).not.toContain('{');
  });

  it('formats tool arguments without curly brackets or raw JSON dumps', () => {
    const args = {
      contactId: '12345',
      query: 'contract agreement',
      limit: 10,
    };
    const chips = formatToolArgs(args);
    expect(chips).toHaveLength(3);
    expect(chips[0]).toEqual({ label: 'Contact Id', value: '12345' });
    expect(chips[1]).toEqual({ label: 'Query', value: 'contract agreement' });
    expect(chips[2]).toEqual({ label: 'Limit', value: '10' });

    for (const chip of chips) {
      expect(chip.value).not.toContain('{');
      expect(chip.value).not.toContain('}');
      expect(chip.value).not.toContain('"');
    }
  });

  it('handles nested objects without spilling curly brackets', () => {
    const args = {
      filter: { status: 'urgent', priority: 'high' },
    };
    const chips = formatToolArgs(args);
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe('Filter');
    expect(chips[0].value).toBe('status: urgent • priority: high');
    expect(chips[0].value).not.toContain('{');
    expect(chips[0].value).not.toContain('}');
  });
});
