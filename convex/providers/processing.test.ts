import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonSchema, tool } from 'ai';
import { describeImage, generateReply, generateText, summarizeDocument } from './processing';
import { runJsonExtraction, streamAssistantTurn } from './aiSdk';

const fetchMock = vi.fn();
const completion = (text: string) =>
  Response.json({
    id: 'test-completion',
    object: 'chat.completion',
    created: 1,
    model: 'test-model',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  });
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  vi.stubEnv('BIMI_AI_PROVIDER', 'openai');
  vi.stubEnv('OPENAI_API_KEY', 'test-private-key');
  vi.stubEnv('OPENAI_MODEL', 'test-model');
  for (const key of [
    'BIMI_AI_MODEL',
    'BIMI_AI_TEXT_MODEL',
    'BIMI_AI_JSON_MODEL',
    'BIMI_AI_REPLY_MODEL',
    'BIMI_AI_SUMMARY_MODEL',
  ])
    vi.stubEnv(key, '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('processing through provider protocols', () => {
  it('sends background text to the chosen provider with the task model', async () => {
    vi.stubEnv('BIMI_AI_TEXT_MODEL', 'background-model');
    fetchMock.mockResolvedValue(completion(' summary '));
    expect(await generateText({ system: 'Summarize', user: 'Hello', maxTokens: 80 })).toBe(
      'summary',
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'background-model',
      max_tokens: 80,
    });
  });

  it('preserves reply style/context and summary truncation through the shared adapter', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(completion('response')));
    await generateReply({
      latestIncoming: 'hello',
      history: [],
      style: 'professional',
      styleGuidance: 'No emoji',
      memoryBlock: 'Client speaks English',
    });
    const reply = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(reply.messages[0].content).toContain('Professional and polished');
    expect(reply.messages[0].content).toContain('Client speaks English');
    expect(reply.messages.at(-1).content).toBe('hello');
    const result = await summarizeDocument({
      text: 'a'.repeat(15_000),
      fileKind: 'text',
    });
    expect(result).toEqual({ summary: 'response', truncated: true });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).messages[1].content).toContain('truncated');
  });

  it('falls back from unsupported structured output with the schema in the prompt', async () => {
    fetchMock.mockResolvedValueOnce(new Response('unsupported schema', { status: 400 }));
    fetchMock.mockResolvedValueOnce(completion('{"value":"ok"}'));
    const result = await runJsonExtraction({
      system: 'Extract',
      messages: [{ role: 'user', content: 'Hello' }],
      schema: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
        additionalProperties: false,
      },
    });
    expect(JSON.parse(result)).toEqual({ value: 'ok' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).messages[0].content).toContain(
      'Return only JSON matching this schema',
    );
  });

  it('routes vision independently and serializes image content', async () => {
    vi.stubEnv('BIMI_AI_PROVIDER', 'deepseek');
    vi.stubEnv('BIMI_VISION_PROVIDER', 'openai');
    vi.stubEnv('BIMI_VISION_MODEL', 'vision-model');
    fetchMock.mockResolvedValue(completion('A receipt'));
    expect(await describeImage({ base64: btoa('image'), mimeType: 'image/png' })).toBe('A receipt');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('vision-model');
    expect(body.messages[0].content[1].image_url.url).toBe(
      `data:image/png;base64,${btoa('image')}`,
    );
  });

  it('streams native tool calls and executes them through the assistant', async () => {
    const lookup = vi.fn(async () => 'found');
    const chunks = [
      {
        id: 'test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'test-model',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'lookup', arguments: '{"query":"hello"}' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'test-model',
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      },
    ];
    fetchMock.mockResolvedValue(
      new Response(
        chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    const stream = streamAssistantTurn({
      system: 'Use tools',
      messages: [{ role: 'user', content: 'Find hello' }],
      maxSteps: 1,
      tools: {
        lookup: tool({
          inputSchema: jsonSchema<{ query: string }>({
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
            additionalProperties: false,
          }),
          execute: lookup,
        }),
      },
    });
    const events = [];
    for await (const event of stream.fullStream) events.push(event);
    expect(events.some((e) => e.type === 'tool-call')).toBe(true);
    expect(events.some((e) => e.type === 'tool-result')).toBe(true);
    expect(lookup).toHaveBeenCalledWith({ query: 'hello' }, expect.anything());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream).toBe(true);
  });
});
