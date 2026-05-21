import { Test } from '@nestjs/testing';
import Anthropic from '@anthropic-ai/sdk';
import { ClaudeProvider } from './claude.provider';

jest.mock('@anthropic-ai/sdk');

describe('ClaudeProvider', () => {
  let provider: ClaudeProvider;
  let createMock: jest.Mock;

  beforeEach(async () => {
    createMock = jest.fn();
    (Anthropic as unknown as jest.Mock).mockImplementation(() => ({
      messages: { create: createMock },
    }));
    const mod = await Test.createTestingModule({
      providers: [ClaudeProvider],
    }).compile();
    provider = mod.get(ClaudeProvider);
  });

  it('parses text response → LlmChatResponse', async () => {
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
    expect(resp.modelName).toBe('claude-sonnet-4-6');
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
