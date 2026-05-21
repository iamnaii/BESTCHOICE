import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GeminiProvider } from './gemini.provider';

jest.mock('google-auth-library', () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({
    getClient: jest.fn().mockResolvedValue({
      getAccessToken: jest.fn().mockResolvedValue({ token: 'fake-token' }),
    }),
  })),
}));

describe('GeminiProvider', () => {
  let provider: GeminiProvider;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        GeminiProvider,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'GOOGLE_CLOUD_PROJECT') return 'test-project';
              if (key === 'VERTEX_LOCATION') return 'us-central1';
              if (key === 'VERTEX_GEMINI_MODEL') return 'gemini-2.0-flash-001';
              return undefined;
            },
          },
        },
      ],
    }).compile();
    provider = mod.get(GeminiProvider);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function fakeFetchResponse(body: object) {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200 }) as unknown as Response,
    );
  }

  it('parses text-only Vertex response → LlmChatResponse', async () => {
    fakeFetchResponse({
      candidates: [
        {
          content: { parts: [{ text: 'สวัสดีค่ะ' }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 12 },
    });

    const resp = await provider.chat({
      systemPrompt: 'persona',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(resp.text).toBe('สวัสดีค่ะ');
    expect(resp.toolCalls).toHaveLength(0);
    expect(resp.inputTokens).toBe(50);
    expect(resp.outputTokens).toBe(12);
    expect(resp.modelName).toBe('gemini-2.0-flash-001');
  });

  it('parses functionCall part → toolCalls with synthesized id', async () => {
    fakeFetchResponse({
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: 'search_products',
                  args: { query: 'iPhone 15' },
                },
              },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 5 },
    });

    const resp = await provider.chat({
      systemPrompt: 'persona',
      messages: [{ role: 'user', content: 'หา iPhone 15' }],
      tools: [
        {
          name: 'search_products',
          description: 'Search catalog',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
    });

    expect(resp.text).toBe('');
    expect(resp.toolCalls).toHaveLength(1);
    expect(resp.toolCalls[0].name).toBe('search_products');
    expect(resp.toolCalls[0].input).toEqual({ query: 'iPhone 15' });
    expect(resp.toolCalls[0].id).toMatch(/^fn_\d+_search_products$/);
  });

  it('sends system instruction + tools as functionDeclarations', async () => {
    fakeFetchResponse({
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 },
    });

    await provider.chat({
      systemPrompt: 'YOU ARE A SALES BOT',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          name: 't1',
          description: 'desc',
          inputSchema: {
            type: 'object',
            properties: { q: { type: 'string' } },
            $schema: 'http://json-schema.org/draft-07/schema#',
            additionalProperties: false,
          },
        },
      ],
    });

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe('YOU ARE A SALES BOT');
    expect(body.tools[0].functionDeclarations[0].name).toBe('t1');
    // Schema sanitization: drops $schema + additionalProperties
    expect(body.tools[0].functionDeclarations[0].parameters).not.toHaveProperty('$schema');
    expect(body.tools[0].functionDeclarations[0].parameters).not.toHaveProperty(
      'additionalProperties',
    );
    expect(body.tools[0].functionDeclarations[0].parameters.properties.q.type).toBe(
      'string',
    );
  });

  it('round-trips tool-use turn → tool result correctly', async () => {
    fakeFetchResponse({
      candidates: [{ content: { parts: [{ text: 'พบ iPhone 15 ราคา 32,900' }] } }],
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 25 },
    });

    await provider.chat({
      systemPrompt: 'persona',
      messages: [
        { role: 'user', content: 'iPhone 15 กี่บาท' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'fn_0_search_products', name: 'search_products', input: { query: 'iPhone 15' } },
          ],
        },
        {
          role: 'tool',
          toolCallId: 'fn_0_search_products',
          content: '{"products":[{"name":"iPhone 15","priceThb":32900}]}',
        },
      ],
    });

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);

    expect(body.contents).toHaveLength(3);
    expect(body.contents[0]).toEqual({
      role: 'user',
      parts: [{ text: 'iPhone 15 กี่บาท' }],
    });
    expect(body.contents[1].role).toBe('model');
    expect(body.contents[1].parts[0].functionCall.name).toBe('search_products');
    expect(body.contents[2].role).toBe('user');
    expect(body.contents[2].parts[0].functionResponse.name).toBe('search_products');
    expect(body.contents[2].parts[0].functionResponse.response.products[0].name).toBe(
      'iPhone 15',
    );
  });

  it('throws ServiceUnavailable when project not configured', async () => {
    const mod = await Test.createTestingModule({
      providers: [
        GeminiProvider,
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    const p = mod.get(GeminiProvider);
    await expect(
      p.chat({ systemPrompt: 'x', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/GOOGLE_CLOUD_PROJECT/);
  });

  it('throws ServiceUnavailable when Vertex returns non-2xx', async () => {
    fetchSpy.mockResolvedValue(
      new Response('quota exceeded', { status: 429 }) as unknown as Response,
    );
    await expect(
      provider.chat({ systemPrompt: 'x', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/Vertex Gemini failed: 429/);
  });
});
