import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  ILlmProvider,
  LlmChatMessage,
  LlmChatRequest,
  LlmChatResponse,
  LlmProviderName,
} from './llm-provider.interface';

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 1024;

@Injectable()
export class ClaudeProvider implements ILlmProvider {
  readonly providerName: LlmProviderName = 'claude';
  private readonly logger = new Logger(ClaudeProvider.name);
  private _client: Anthropic | null = null;

  private get client(): Anthropic {
    if (!this._client) {
      this._client = new Anthropic();
    }
    return this._client;
  }

  async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
    const tools: Anthropic.Tool[] | undefined = req.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
    }));

    const messages = this.projectMessages(req.messages);

    const resp = await this.client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: req.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      system: req.systemPrompt,
      ...(tools ? { tools } : {}),
      messages,
    });

    const toolCalls = resp.content
      .filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use')
      .map((c) => ({
        id: c.id,
        name: c.name,
        input: c.input as Record<string, unknown>,
      }));

    const textBlock = resp.content.find(
      (c): c is Anthropic.TextBlock => c.type === 'text',
    );

    return {
      text: textBlock?.text ?? '',
      toolCalls,
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
      modelName: CLAUDE_MODEL,
    };
  }

  /**
   * Project provider-agnostic LlmChatMessage[] to Anthropic MessageParam[].
   * Consecutive `role: 'tool'` messages collapse into a single user message
   * carrying multiple tool_result blocks (Anthropic requires this shape).
   * Assistant turns with toolCalls render as content blocks (text + tool_use).
   */
  private projectMessages(messages: LlmChatMessage[]): Anthropic.MessageParam[] {
    const out: Anthropic.MessageParam[] = [];
    let pendingToolResults: Anthropic.ToolResultBlockParam[] = [];

    const flushToolResults = () => {
      if (pendingToolResults.length === 0) return;
      out.push({ role: 'user', content: pendingToolResults });
      pendingToolResults = [];
    };

    for (const msg of messages) {
      if (msg.role === 'tool') {
        pendingToolResults.push({
          type: 'tool_result',
          tool_use_id: msg.toolCallId,
          content: msg.content,
        });
        continue;
      }

      flushToolResults();

      if (msg.role === 'user') {
        out.push({ role: 'user', content: msg.content });
        continue;
      }

      // assistant
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (msg.content) {
        blocks.push({ type: 'text', text: msg.content });
      }
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.input,
          });
        }
      }
      // Edge case: assistant turn with neither text nor toolCalls — skip
      if (blocks.length > 0) {
        out.push({ role: 'assistant', content: blocks });
      }
    }

    flushToolResults();
    return out;
  }
}
