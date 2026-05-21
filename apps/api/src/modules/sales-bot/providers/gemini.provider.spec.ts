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

function makeConfig(overrides: Record<string, string | undefined> = {}) {
  const base: Record<string, string | undefined> = {
    GEMINI_MODEL: 'gemini-2.5-flash',
    VERTEX_LOCATION: 'us-central1',
    ...overrides,
  };
  return {
    provide: ConfigService,
    useValue: { get: (k: string) => base[k] },
  };
}

async function buildProvider(overrides: Record<string, string | undefined> = {}) {
  const mod = await Test.createTestingModule({
    providers: [GeminiProvider, makeConfig(overrides)],
  }).compile();
  return mod.get(GeminiProvider);
}

function fakeFetchResponse(spy: jest.SpyInstance, body: object, status = 200) {
  spy.mockResolvedValue(
    new Response(JSON.stringify(body), { status }) as unknown as Response,
  );
}

describe('GeminiProvider', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('mode detection', () => {
    it('uses AI Studio when GEMINI_API_KEY set (regardless of GOOGLE_CLOUD_PROJECT)', async () => {
      const p = await buildProvider({
        GEMINI_API_KEY: 'ai-studio-key',
        GOOGLE_CLOUD_PROJECT: 'some-project',
      });
      expect(p.isReady()).toBe(true);
      fakeFetchResponse(fetchSpy, {
        candidates: [{ content: { parts: [{ text: 'hi' }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 },
      });
      await p.chat({
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
      });
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toContain('generativelanguage.googleapis.com');
      expect(url).toContain('key=ai-studio-key');
    });

    it('uses Vertex when GOOGLE_CLOUD_PROJECT set and no GEMINI_API_KEY', async () => {
      const p = await buildProvider({ GOOGLE_CLOUD_PROJECT: 'bestchoice-prod' });
      expect(p.isReady()).toBe(true);
      fakeFetchResponse(fetchSpy, {
        candidates: [{ content: { parts: [{ text: 'hi' }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 },
      });
      await p.chat({
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
      });
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toContain('us-central1-aiplatform.googleapis.com');
      expect(url).toContain('bestchoice-prod');
      expect((init.headers as Record<string, string>).Authorization).toBe(
        'Bearer fake-token',
      );
    });

    it('isReady=false when neither env set', async () => {
      const p = await buildProvider({});
      expect(p.isReady()).toBe(false);
    });

    it('throws ServiceUnavailable when chat called without config', async () => {
      const p = await buildProvider({});
      await expect(
        p.chat({ systemPrompt: 'x', messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow(/not configured/);
    });
  });

  describe('chat — AI Studio mode', () => {
    let p: GeminiProvider;
    beforeEach(async () => {
      p = await buildProvider({ GEMINI_API_KEY: 'test-key' });
    });

    it('parses text response', async () => {
      fakeFetchResponse(fetchSpy, {
        candidates: [{ content: { parts: [{ text: 'สวัสดีค่ะ' }] } }],
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 12 },
      });
      const resp = await p.chat({
        systemPrompt: 'persona',
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(resp.text).toBe('สวัสดีค่ะ');
      expect(resp.toolCalls).toHaveLength(0);
      expect(resp.inputTokens).toBe(50);
      expect(resp.outputTokens).toBe(12);
      expect(resp.modelName).toBe('gemini-2.5-flash (aistudio)');
    });

    it('does NOT send Authorization header (uses key param)', async () => {
      fakeFetchResponse(fetchSpy, {
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 },
      });
      await p.chat({
        systemPrompt: 'x',
        messages: [{ role: 'user', content: 'hi' }],
      });
      const [, init] = fetchSpy.mock.calls[0];
      expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    });
  });

  describe('chat — Vertex mode', () => {
    let p: GeminiProvider;
    beforeEach(async () => {
      p = await buildProvider({ GOOGLE_CLOUD_PROJECT: 'test-project' });
    });

    it('parses functionCall part → toolCalls with synthesized id', async () => {
      fakeFetchResponse(fetchSpy, {
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
      const resp = await p.chat({
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
      expect(resp.modelName).toBe('gemini-2.5-flash (vertex)');
    });

    it('sends system instruction + tools as functionDeclarations + sanitizes schema', async () => {
      fakeFetchResponse(fetchSpy, {
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 },
      });
      await p.chat({
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
      expect(body.tools[0].functionDeclarations[0].parameters).not.toHaveProperty(
        '$schema',
      );
      expect(body.tools[0].functionDeclarations[0].parameters).not.toHaveProperty(
        'additionalProperties',
      );
      expect(body.tools[0].functionDeclarations[0].parameters.properties.q.type).toBe(
        'string',
      );
    });

    it('round-trips tool-use turn → tool result correctly', async () => {
      fakeFetchResponse(fetchSpy, {
        candidates: [{ content: { parts: [{ text: 'พบ iPhone 15 ราคา 32,900' }] } }],
        usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 25 },
      });
      await p.chat({
        systemPrompt: 'persona',
        messages: [
          { role: 'user', content: 'iPhone 15 กี่บาท' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'fn_0_search_products',
                name: 'search_products',
                input: { query: 'iPhone 15' },
              },
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
      expect(body.contents[2].parts[0].functionResponse.name).toBe(
        'search_products',
      );
      expect(
        body.contents[2].parts[0].functionResponse.response.products[0].name,
      ).toBe('iPhone 15');
    });

    it('throws ServiceUnavailable when Vertex returns non-2xx', async () => {
      fetchSpy.mockResolvedValue(
        new Response('quota exceeded', { status: 429 }) as unknown as Response,
      );
      await expect(
        p.chat({ systemPrompt: 'x', messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow(/Gemini vertex failed: 429/);
    });
  });

  // Regression — 2026-05-21 prod: Nai's "15 ธรรมดา" triggered persona's
  // 3-Combo Anchor (search + calc×3 in one turn). Service pushed 4 tool
  // results as 4 separate user turns; Gemini returned 400 "function response
  // parts ≠ function call parts of the function call turn". This block
  // verifies the grouping fix.
  describe('multi-tool-call response grouping', () => {
    it('groups N consecutive tool results into ONE user turn (the Nai case)', async () => {
      const p = await buildProvider({ GOOGLE_CLOUD_PROJECT: 'bestchoice-prod' });
      fakeFetchResponse(fetchSpy, {
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 5 },
      });

      await p.chat({
        systemPrompt: 'persona',
        messages: [
          { role: 'user', content: '15 ธรรมดา' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              { id: 'fn_0_search_products', name: 'search_products', input: { query: 'iPhone 15' } },
              { id: 'fn_1_calculate_installment', name: 'calculate_installment', input: { productId: 'p1', downPct: 10, tenureMonths: 12 } },
              { id: 'fn_2_calculate_installment', name: 'calculate_installment', input: { productId: 'p1', downPct: 20, tenureMonths: 12 } },
              { id: 'fn_3_calculate_installment', name: 'calculate_installment', input: { productId: 'p1', downPct: 30, tenureMonths: 12 } },
            ],
          },
          { role: 'tool', toolCallId: 'fn_0_search_products', content: '{"products":[{"id":"p1","priceThb":28900}]}' },
          { role: 'tool', toolCallId: 'fn_1_calculate_installment', content: '{"monthly":2890}' },
          { role: 'tool', toolCallId: 'fn_2_calculate_installment', content: '{"monthly":2570}' },
          { role: 'tool', toolCallId: 'fn_3_calculate_installment', content: '{"monthly":2250}' },
        ],
      });

      const [, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(init.body as string);

      // Expected shape: 3 turns total — user (text), model (4 functionCalls),
      // user (4 functionResponses grouped). NOT 6 turns (1+1+4 separate).
      expect(body.contents).toHaveLength(3);
      expect(body.contents[0]).toEqual({
        role: 'user',
        parts: [{ text: '15 ธรรมดา' }],
      });
      expect(body.contents[1].role).toBe('model');
      expect(body.contents[1].parts).toHaveLength(4);
      expect(body.contents[1].parts.every((p: any) => 'functionCall' in p)).toBe(true);
      // The critical assertion: all 4 functionResponses live in ONE user turn,
      // not split across 4 separate user turns.
      expect(body.contents[2].role).toBe('user');
      expect(body.contents[2].parts).toHaveLength(4);
      expect(body.contents[2].parts.every((p: any) => 'functionResponse' in p)).toBe(true);
      // Names preserved in correct order via positional iteration.
      expect(body.contents[2].parts.map((p: any) => p.functionResponse.name)).toEqual([
        'search_products',
        'calculate_installment',
        'calculate_installment',
        'calculate_installment',
      ]);
    });

    it('single tool result still produces its own user turn (no regression)', async () => {
      const p = await buildProvider({ GOOGLE_CLOUD_PROJECT: 'bestchoice-prod' });
      fakeFetchResponse(fetchSpy, {
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 },
      });

      await p.chat({
        systemPrompt: 'persona',
        messages: [
          { role: 'user', content: 'iPhone 15 ราคา' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              { id: 'fn_0_search_products', name: 'search_products', input: { query: 'iPhone 15' } },
            ],
          },
          { role: 'tool', toolCallId: 'fn_0_search_products', content: '{"products":[]}' },
        ],
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
      // 3 turns: user, model (1 functionCall), user (1 functionResponse).
      expect(body.contents).toHaveLength(3);
      expect(body.contents[2].role).toBe('user');
      expect(body.contents[2].parts).toHaveLength(1);
      expect(body.contents[2].parts[0]).toHaveProperty('functionResponse.name', 'search_products');
    });

    it('does NOT group tool result into a user turn that contains text', async () => {
      // Defensive: if a `tool` message arrives right after a regular user
      // text turn (shouldn't happen via our service, but could via test or
      // future caller), don't pollute the text turn. Start a fresh user turn.
      const p = await buildProvider({ GOOGLE_CLOUD_PROJECT: 'bestchoice-prod' });
      fakeFetchResponse(fetchSpy, {
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 },
      });

      await p.chat({
        systemPrompt: 'persona',
        messages: [
          { role: 'user', content: 'some text' },
          { role: 'tool', toolCallId: 'fn_0_foo', content: '{"x":1}' },
        ],
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
      // 2 turns: user (text) + user (functionResponse). Separate.
      expect(body.contents).toHaveLength(2);
      expect(body.contents[0].parts[0]).toHaveProperty('text', 'some text');
      expect(body.contents[1].parts[0]).toHaveProperty('functionResponse.name', 'foo');
    });
  });

  describe('thinkingConfig (2.5-series only)', () => {
    it('sets thinkingBudget=0 on gemini-2.5-flash to skip hidden reasoning', async () => {
      const p = await buildProvider({
        GOOGLE_CLOUD_PROJECT: 'bestchoice-prod',
        GEMINI_MODEL: 'gemini-2.5-flash',
      });
      fakeFetchResponse(fetchSpy, {
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 },
      });
      await p.chat({
        systemPrompt: 'x',
        messages: [{ role: 'user', content: 'hi' }],
      });
      const [, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(init.body as string);
      expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    });

    it('does NOT set thinkingConfig on pre-2.5 models', async () => {
      const p = await buildProvider({
        GOOGLE_CLOUD_PROJECT: 'bestchoice-prod',
        GEMINI_MODEL: 'gemini-2.0-flash',
      });
      fakeFetchResponse(fetchSpy, {
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 },
      });
      await p.chat({
        systemPrompt: 'x',
        messages: [{ role: 'user', content: 'hi' }],
      });
      const [, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(init.body as string);
      expect(body.generationConfig.thinkingConfig).toBeUndefined();
    });
  });
});
