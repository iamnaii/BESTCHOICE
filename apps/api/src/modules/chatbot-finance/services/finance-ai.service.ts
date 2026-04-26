import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';
import { ChatMessage, MessageRole } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { FINANCE_TOOLS } from '../tools/tool-definitions';
import { FinanceToolExecutor } from '../tools/tool-executor';
import { FinanceConfigService } from './finance-config.service';
import { FINANCE_BOT_SYSTEM_PROMPT } from '../prompts/system-prompt';
import { IntegrationConfigService } from '../../integrations/integration-config.service';
import { AiUsageService } from '../../ai-usage/ai-usage.service';

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
 *   - Sonnet 4.6 สำหรับ customer-facing replies (Task 8 — quality > cost)
 *   - Loop จนกว่า Claude จะตอบเป็น text (stop_reason !== 'tool_use')
 *   - Max 5 iterations กัน infinite loop
 *   - Task 8: เพิ่ม full conversation history window จาก DB (10 msgs, 20k char budget)
 */
@Injectable()
export class FinanceAiService {
  private readonly logger = new Logger(FinanceAiService.name);
  private anthropic: Anthropic | null = null;

  // Sonnet 4.6 for customer-facing replies — quality matters (Task 8, Week 1 Hybrid C plan)
  private readonly modelSonnet = 'claude-sonnet-4-6';
  private readonly maxTokens = 1024;
  private readonly historyLimit = 20;
  /** DB-backed history window (Task 8): 10 most recent messages, oldest-first */
  private static readonly HISTORY_FETCH_LIMIT = 10;
  /** Char budget for history window — drop oldest until under limit (~30k input tokens headroom) */
  private static readonly HISTORY_CHAR_BUDGET = 20_000;

  /** Cached system prompt from DB — TTL 5 minutes */
  private promptCache: { text: string; fetchedAt: number } | null = null;
  private static readonly PROMPT_CACHE_TTL = 5 * 60 * 1000; // 5 min

  constructor(
    private toolExecutor: FinanceToolExecutor,
    private financeConfig: FinanceConfigService,
    private integrationConfig: IntegrationConfigService,
    private aiUsage: AiUsageService,
    private prisma: PrismaService,
  ) {}

  private async getAnthropicClient(): Promise<Anthropic | null> {
    const apiKey = ((await this.integrationConfig.getValue('claude-ai', 'apiKey')) || '').trim();
    if (!apiKey) return null;
    if (!this.anthropic) {
      this.anthropic = new Anthropic({ apiKey });
      this.logger.log('[FinanceAI] Initialized (Sonnet 4.6 + tools)');
    }
    return this.anthropic;
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
    roomId: string;
  }): Promise<AiReply | null> {
    const client = await this.getAnthropicClient();
    if (!client) return null;

    try {
      const systemPrompt = await this.buildSystemPrompt(params.customerName);
      // Task 8: load full conversation history from DB (last 10 messages, oldest-first)
      // so Claude has full context across turns.
      const dbHistory = await this.loadHistory(params.roomId);
      const messages = this.buildMessagesFromHistory(dbHistory, params.userMessage);

      let totalInput = 0;
      let totalOutput = 0;
      let handoffTriggered = false;
      const toolsUsed: string[] = [];
      const activeModel = this.modelSonnet;

      // Tool use loop
      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        // (Audit finding P1) Cap each iteration at 30s. With MAX_TOOL_ITERATIONS
        // the budget is bounded; the SDK's 600s default would let a single
        // slow iteration starve every other concurrent webhook.
        const response = await client.messages.create(
          {
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
          },
          { timeout: 30_000 },
        );

        totalInput += response.usage.input_tokens;
        totalOutput += response.usage.output_tokens;

        // หยุดเมื่อ Claude ตอบเป็น text
        if (response.stop_reason !== 'tool_use') {
          const textBlock = response.content.find((b) => b.type === 'text');
          const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';
          if (!text) {
            this.logger.warn('[FinanceAI] Empty text response');
            void this.aiUsage.record({
              service: 'finance-ai',
              method: 'generateReply',
              model: activeModel,
              inputTokens: totalInput,
              outputTokens: totalOutput,
              status: 'error',
              errorKind: 'empty_response',
            });
            return null;
          }
          void this.aiUsage.record({
            service: 'finance-ai',
            method: 'generateReply',
            model: activeModel,
            inputTokens: totalInput,
            outputTokens: totalOutput,
            status: 'success',
          });
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
              { customerId: params.customerId, roomId: params.roomId },
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

  /** Fetch system prompt with 5-min cache */
  private async getSystemPromptText(): Promise<string> {
    const now = Date.now();
    if (this.promptCache && now - this.promptCache.fetchedAt < FinanceAiService.PROMPT_CACHE_TTL) {
      return this.promptCache.text;
    }
    try {
      const text = await this.financeConfig.getSystemPrompt();
      this.promptCache = { text, fetchedAt: now };
      return text;
    } catch (err) {
      this.logger.warn(
        `[FinanceAI] Failed to fetch system prompt from DB, using cache/default: ${err instanceof Error ? err.message : err}`,
      );
      return this.promptCache?.text || FINANCE_BOT_SYSTEM_PROMPT;
    }
  }

  /** Invalidate prompt cache (called after admin edits) */
  invalidatePromptCache(): void {
    this.promptCache = null;
  }

  private async buildSystemPrompt(customerName?: string): Promise<string> {
    const basePrompt = await this.getSystemPromptText();
    if (!customerName) return basePrompt;
    return `${basePrompt}\n\n# ลูกค้าปัจจุบัน\nชื่อ: คุณ${customerName} (verify แล้ว)\nคุณสามารถใช้ tools เพื่อดึงข้อมูลของลูกค้าคนนี้ได้เลย — ไม่ต้องถามเลขสัญญา`;
  }

  /**
   * Load last N messages from ChatMessage (oldest-first) for the given room
   * and map to Anthropic's {role, content} shape. Drops oldest entries if
   * total text exceeds HISTORY_CHAR_BUDGET to stay within input-token headroom.
   */
  private async loadHistory(
    roomId: string,
    maxMessages: number = FinanceAiService.HISTORY_FETCH_LIMIT,
  ): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
    const rows = await this.prisma.chatMessage.findMany({
      where: { roomId, text: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: maxMessages,
      select: { role: true, text: true },
    });
    const mapped = rows
      .reverse()
      .filter((r): r is typeof r & { text: string } => r.text !== null)
      .map((r) => ({
        role:
          r.role === MessageRole.STAFF || r.role === MessageRole.BOT
            ? ('assistant' as const)
            : ('user' as const),
        content: r.text,
      }));
    let totalLen = mapped.reduce((s, m) => s + m.content.length, 0);
    while (totalLen > FinanceAiService.HISTORY_CHAR_BUDGET && mapped.length > 1) {
      const dropped = mapped.shift();
      if (dropped) totalLen -= dropped.content.length;
    }
    return mapped;
  }

  /**
   * Build Anthropic messages array from DB-loaded history (oldest-first)
   * and the current user message. Merges adjacent same-role turns and
   * ensures the sequence starts with a user turn.
   */
  private buildMessagesFromHistory(
    history: { role: 'user' | 'assistant'; content: string }[],
    currentUserMessage: string,
  ): MessageParam[] {
    const messages: MessageParam[] = [];
    for (const msg of history) {
      const last = messages[messages.length - 1];
      if (last && last.role === msg.role && typeof last.content === 'string') {
        last.content += '\n' + msg.content;
      } else {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
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
