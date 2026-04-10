import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';
import { ChatMessage, MessageRole } from '@prisma/client';
import { FINANCE_BOT_SYSTEM_PROMPT } from '../prompts/system-prompt';
import { FINANCE_TOOLS } from '../tools/tool-definitions';
import { FinanceToolExecutor } from '../tools/tool-executor';

export interface AiReply {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  toolsUsed: string[];
  handoffTriggered: boolean;
}

const MAX_TOOL_ITERATIONS = 5;

/**
 * Wrapper รอบ Claude API สำหรับ Finance Bot
 *
 * Phase B: รองรับ tool use loop
 *   - Sonnet 4.5 สำหรับ tool use (แม่นกว่า)
 *   - Loop จนกว่า Claude จะตอบเป็น text (stop_reason !== 'tool_use')
 *   - Max 5 iterations กัน infinite loop
 */
@Injectable()
export class FinanceAiService {
  private readonly logger = new Logger(FinanceAiService.name);
  private readonly anthropic: Anthropic | null;

  // Sonnet for tool use — accurate for multi-step conversations
  private readonly modelSonnet = 'claude-sonnet-4-5-20250929';
  private readonly maxTokens = 1024;
  private readonly historyLimit = 20;

  constructor(
    private config: ConfigService,
    private toolExecutor: FinanceToolExecutor,
  ) {
    const apiKey = (
      this.config.get<string>('ANTHROPIC_API_KEY') ||
      process.env.ANTHROPIC_API_KEY ||
      ''
    ).trim();

    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
      this.logger.log('[FinanceAI] Initialized (Sonnet + tools)');
    } else {
      this.anthropic = null;
      this.logger.warn('[FinanceAI] ANTHROPIC_API_KEY not set — AI disabled');
    }
  }

  get isEnabled(): boolean {
    return this.anthropic !== null;
  }

  /**
   * สร้างคำตอบจาก Claude พร้อม tool use loop
   * @returns null ถ้า AI ไม่พร้อม
   */
  async generateReply(params: {
    userMessage: string;
    history: ChatMessage[];
    customerId: string;
    customerName: string;
    sessionId: string;
  }): Promise<AiReply | null> {
    if (!this.anthropic) return null;

    try {
      const systemPrompt = this.buildSystemPrompt(params.customerName);
      const messages = this.buildMessages(params.history, params.userMessage);

      let totalInput = 0;
      let totalOutput = 0;
      let handoffTriggered = false;
      const toolsUsed: string[] = [];
      const activeModel = this.modelSonnet;

      // Tool use loop
      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        const response = await this.anthropic.messages.create({
          model: activeModel,
          max_tokens: this.maxTokens,
          system: [
            {
              type: 'text',
              text: systemPrompt,
              cache_control: { type: 'ephemeral' },
            },
          ],
          tools: FINANCE_TOOLS,
          messages,
        });

        totalInput += response.usage.input_tokens;
        totalOutput += response.usage.output_tokens;

        // หยุดเมื่อ Claude ตอบเป็น text
        if (response.stop_reason !== 'tool_use') {
          const textBlock = response.content.find((b) => b.type === 'text');
          const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';
          if (!text) {
            this.logger.warn('[FinanceAI] Empty text response');
            return null;
          }
          return {
            text,
            model: activeModel,
            inputTokens: totalInput,
            outputTokens: totalOutput,
            toolsUsed,
            handoffTriggered,
          };
        }

        // มี tool_use → execute แล้ว append result
        const toolUseBlocks = response.content.filter(
          (b): b is ToolUseBlock => b.type === 'tool_use',
        );

        // เก็บ assistant message ที่มี tool_use ไว้ใน history
        messages.push({ role: 'assistant', content: response.content });

        // Execute ทุก tool calls แบบ parallel
        const toolResults = await Promise.all(
          toolUseBlocks.map(async (block) => {
            toolsUsed.push(block.name);
            const result = await this.toolExecutor.execute(
              { name: block.name, input: block.input as Record<string, unknown> },
              { customerId: params.customerId, sessionId: params.sessionId },
            );
            if (result.triggeredHandoff) handoffTriggered = true;
            return {
              type: 'tool_result' as const,
              tool_use_id: block.id,
              content: result.ok
                ? JSON.stringify(result.data)
                : `Error: ${result.error}`,
              is_error: !result.ok,
            };
          }),
        );

        messages.push({ role: 'user', content: toolResults });
      }

      this.logger.warn(
        `[FinanceAI] Max tool iterations (${MAX_TOOL_ITERATIONS}) reached. ` +
          `Tools called: [${toolsUsed.join(', ')}] | ` +
          `Tokens: in=${totalInput} out=${totalOutput} | ` +
          `Customer: ${params.customerId.slice(0, 8)}...`,
      );
      Sentry.captureMessage('FinanceAI max tool iterations reached', {
        level: 'warning',
        tags: { module: 'chatbot-finance', action: 'ai_max_iterations' },
        extra: { toolsUsed, totalInput, totalOutput },
      });
      return null;
    } catch (err) {
      this.logger.error(
        `[FinanceAI] Claude error: ${err instanceof Error ? err.message : String(err)}`,
      );
      Sentry.captureException(err, {
        tags: { module: 'chatbot-finance', action: 'ai_generate_reply' },
      });
      return null;
    }
  }

  private buildSystemPrompt(customerName?: string): string {
    if (!customerName) return FINANCE_BOT_SYSTEM_PROMPT;
    return `${FINANCE_BOT_SYSTEM_PROMPT}\n\n# ลูกค้าปัจจุบัน\nชื่อ: คุณ${customerName} (verify แล้ว)\nคุณสามารถใช้ tools เพื่อดึงข้อมูลของลูกค้าคนนี้ได้เลย — ไม่ต้องถามเลขสัญญา`;
  }

  private buildMessages(history: ChatMessage[], currentUserMessage: string): MessageParam[] {
    const recent = history.slice(-this.historyLimit);
    const messages: MessageParam[] = [];

    for (const msg of recent) {
      if (msg.role === MessageRole.SYSTEM) continue;
      if (!msg.text) continue;

      const role: 'user' | 'assistant' =
        msg.role === MessageRole.CUSTOMER ? 'user' : 'assistant';

      const last = messages[messages.length - 1];
      if (last && last.role === role && typeof last.content === 'string') {
        last.content += '\n' + msg.text;
      } else {
        messages.push({ role, content: msg.text });
      }
    }

    // ใส่ข้อความปัจจุบัน
    const last = messages[messages.length - 1];
    if (last && last.role === 'user' && typeof last.content === 'string') {
      last.content += '\n' + currentUserMessage;
    } else {
      messages.push({ role: 'user', content: currentUserMessage });
    }

    while (messages.length > 0 && messages[0].role !== 'user') {
      messages.shift();
    }

    return messages;
  }
}
