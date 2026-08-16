import { Test } from '@nestjs/testing';
import Anthropic from '@anthropic-ai/sdk';
import { ClaudeProvider } from './claude.provider';
import { PrismaService } from '../../../prisma/prisma.service';

jest.mock('@anthropic-ai/sdk');

describe('ClaudeProvider', () => {
  let provider: ClaudeProvider;
  let createMock: jest.Mock;
  let configFindMany: jest.Mock;

  beforeEach(async () => {
    createMock = jest.fn();
    configFindMany = jest.fn().mockResolvedValue([]);
    (Anthropic as unknown as jest.Mock).mockImplementation(() => ({
      messages: { create: createMock },
    }));
    const mod = await Test.createTestingModule({
      providers: [
        ClaudeProvider,
        {
          provide: PrismaService,
          useValue: { systemConfig: { findMany: configFindMany } },
        },
      ],
    }).compile();
    provider = mod.get(ClaudeProvider);
  });

  it('parses text response → LlmChatResponse (default model = Haiku 4.5)', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'สวัสดีค่ะ' }],
      usage: { input_tokens: 50, output_tokens: 10 },
    });
    const resp = await provider.chat({
      systemPrompt: 'persona',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(resp.text).toBe('สวัสดีค่ะ');
    expect(resp.toolCalls).toHaveLength(0);
    expect(resp.inputTokens).toBe(50);
    expect(resp.outputTokens).toBe(10);
    expect(resp.modelName).toBe('claude-haiku-4-5-20251001');
    expect(createMock.mock.calls[0][0].model).toBe('claude-haiku-4-5-20251001');
  });

  it('shop_bot_claude_model in SystemConfig overrides the default model', async () => {
    configFindMany.mockResolvedValue([
      { key: 'shop_bot_claude_model', value: 'claude-sonnet-4-6' },
    ]);
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const resp = await provider.chat({
      systemPrompt: 'persona',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(resp.modelName).toBe('claude-sonnet-4-6');
    expect(createMock.mock.calls[0][0].model).toBe('claude-sonnet-4-6');
  });

  it('effort: default medium; shop_bot_claude_effort overrides; ค่าเพี้ยนตกกลับ default', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    // default (ไม่มีแถว config)
    await provider.chat({ systemPrompt: 'p', messages: [{ role: 'user', content: 'hi' }] });
    expect(createMock.mock.calls[0][0].output_config).toEqual({ effort: 'medium' });

    // override เป็น low (สร้าง provider ใหม่ให้ cache ว่าง)
    const mod2 = await Test.createTestingModule({
      providers: [
        ClaudeProvider,
        {
          provide: PrismaService,
          useValue: {
            systemConfig: {
              findMany: jest.fn().mockResolvedValue([
                { key: 'shop_bot_claude_effort', value: 'low' },
              ]),
            },
          },
        },
      ],
    }).compile();
    const p2 = mod2.get(ClaudeProvider);
    await p2.chat({ systemPrompt: 'p', messages: [{ role: 'user', content: 'hi' }] });
    expect(createMock.mock.calls[1][0].output_config).toEqual({ effort: 'low' });

    // ค่าเพี้ยน → default
    const mod3 = await Test.createTestingModule({
      providers: [
        ClaudeProvider,
        {
          provide: PrismaService,
          useValue: {
            systemConfig: {
              findMany: jest.fn().mockResolvedValue([
                { key: 'shop_bot_claude_effort', value: 'turbo' },
              ]),
            },
          },
        },
      ],
    }).compile();
    const p3 = mod3.get(ClaudeProvider);
    await p3.chat({ systemPrompt: 'p', messages: [{ role: 'user', content: 'hi' }] });
    expect(createMock.mock.calls[2][0].output_config).toEqual({ effort: 'medium' });
  });

  it('SystemConfig read failure falls back to default model (never blocks the reply)', async () => {
    configFindMany.mockRejectedValue(new Error('db down'));
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const resp = await provider.chat({
      systemPrompt: 'persona',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(resp.modelName).toBe('claude-haiku-4-5-20251001');
  });

  it('marks system prompt + last tool with cache_control (prompt caching)', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await provider.chat({
      systemPrompt: 'persona',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        { name: 'a', description: 'A', inputSchema: { type: 'object' } },
        { name: 'b', description: 'B', inputSchema: { type: 'object' } },
      ],
    });
    const call = createMock.mock.calls[0][0];
    // system เป็น array block พร้อม cache_control
    expect(call.system).toEqual([
      {
        type: 'text',
        text: 'persona',
        cache_control: { type: 'ephemeral' },
      },
    ]);
    // เฉพาะ tool ตัวสุดท้ายถูกปัก cache_control
    expect(call.tools[0].cache_control).toBeUndefined();
    expect(call.tools[1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('inputTokens = billing-equivalent (cache read ×0.1, cache write ×1.25) — cost ตรงบิลจริง', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: {
        input_tokens: 300,
        output_tokens: 20,
        cache_read_input_tokens: 9000,
        cache_creation_input_tokens: 500,
      },
    });
    const resp = await provider.chat({
      systemPrompt: 'persona',
      messages: [{ role: 'user', content: 'hi' }],
    });
    // 300 + 9000×0.1 + 500×1.25 = 300 + 900 + 625 = 1825
    // (เดิมรวมดิบ 9800 → costUsd โชว์แพงเกินจริง ~5 เท่าเพราะ cache read จ่ายแค่ 0.1×)
    expect(resp.inputTokens).toBe(1825);
  });

  it('parses tool_use blocks → LlmToolCall[]', async () => {
    createMock.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          id: 'tu_abc',
          name: 'search_products',
          input: { query: 'iPhone 15' },
        },
      ],
      usage: { input_tokens: 60, output_tokens: 8 },
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
    expect(resp.toolCalls).toEqual([
      { id: 'tu_abc', name: 'search_products', input: { query: 'iPhone 15' } },
    ]);
  });

  it('projects tool round-trip into Anthropic message shape', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'พบ iPhone 15 ราคา 32,900' }],
      usage: { input_tokens: 200, output_tokens: 25 },
    });

    await provider.chat({
      systemPrompt: 'persona',
      messages: [
        { role: 'user', content: 'iPhone 15 กี่บาท' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'tu_1', name: 'search_products', input: { query: 'iPhone 15' } },
          ],
        },
        {
          role: 'tool',
          toolCallId: 'tu_1',
          content: '{"products":[{"name":"iPhone 15"}]}',
        },
      ],
    });

    const call = createMock.mock.calls[0][0];
    expect(call.messages).toHaveLength(3);
    expect(call.messages[0]).toEqual({ role: 'user', content: 'iPhone 15 กี่บาท' });
    // assistant turn with only tool_use (no text) — text block omitted
    expect(call.messages[1].role).toBe('assistant');
    expect(call.messages[1].content[0].type).toBe('tool_use');
    expect(call.messages[1].content[0].id).toBe('tu_1');
    // tool result becomes user turn with tool_result block
    expect(call.messages[2].role).toBe('user');
    expect(call.messages[2].content[0].type).toBe('tool_result');
    expect(call.messages[2].content[0].tool_use_id).toBe('tu_1');
  });
});
