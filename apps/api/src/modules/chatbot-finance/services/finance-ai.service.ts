import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ChatMessage, MessageRole } from '@prisma/client';
import { FINANCE_BOT_SYSTEM_PROMPT } from '../prompts/system-prompt';

export interface AiReply {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Wrapper รอบ Claude API สำหรับ Finance Bot
 *
 * Phase A2: text-only, conversation history, no tools yet
 * Phase B+:  จะเพิ่ม tool use (get_balance, process_slip, handoff) + vision
 */
@Injectable()
export class FinanceAiService {
  private readonly logger = new Logger(FinanceAiService.name);
  private readonly anthropic: Anthropic | null;

  // Phase A2 ใช้ Sonnet สำหรับคุณภาพ (ไม่มี tools ยังประหยัดได้พอ)
  // Phase B จะ split: Sonnet สำหรับงานใช้ tools, Haiku สำหรับ FAQ ง่าย
  private readonly model = 'claude-haiku-4-5-20251001';
  private readonly maxTokens = 500;
  private readonly historyLimit = 20;

  constructor(private config: ConfigService) {
    const apiKey = (
      this.config.get<string>('ANTHROPIC_API_KEY') ||
      process.env.ANTHROPIC_API_KEY ||
      ''
    ).trim();

    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
      this.logger.log('[FinanceAI] Initialized');
    } else {
      this.anthropic = null;
      this.logger.warn('[FinanceAI] ANTHROPIC_API_KEY not set — AI disabled');
    }
  }

  get isEnabled(): boolean {
    return this.anthropic !== null;
  }

  /**
   * สร้างคำตอบจาก Claude โดยใช้ history เป็น context
   * @returns null ถ้า AI ไม่พร้อม → controller จะ fallback
   */
  async generateReply(params: {
    userMessage: string;
    history: ChatMessage[];
    customerName?: string;
  }): Promise<AiReply | null> {
    if (!this.anthropic) return null;

    try {
      const systemPrompt = this.buildSystemPrompt(params.customerName);
      const messages = this.buildMessages(params.history, params.userMessage);

      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: systemPrompt,
        messages,
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';

      if (!text) {
        this.logger.warn('[FinanceAI] Empty response from Claude');
        return null;
      }

      return {
        text,
        model: this.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    } catch (err) {
      this.logger.error(
        `[FinanceAI] Claude error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** เพิ่มชื่อลูกค้าเข้า system prompt ถ้ามี (ทำให้ bot เรียกชื่อได้) */
  private buildSystemPrompt(customerName?: string): string {
    if (!customerName) return FINANCE_BOT_SYSTEM_PROMPT;
    return `${FINANCE_BOT_SYSTEM_PROMPT}\n\n# ลูกค้าปัจจุบัน\nชื่อ: คุณ${customerName} (verify แล้ว)`;
  }

  /**
   * แปลง ChatMessage[] เป็น Anthropic messages format
   * - CUSTOMER → user
   * - BOT/STAFF/AUTO_TRIGGER → assistant
   * - SYSTEM → ข้าม (ไม่ส่งให้ Claude)
   */
  private buildMessages(
    history: ChatMessage[],
    currentUserMessage: string,
  ): { role: 'user' | 'assistant'; content: string }[] {
    const recent = history.slice(-this.historyLimit);
    const messages: { role: 'user' | 'assistant'; content: string }[] = [];

    for (const msg of recent) {
      if (msg.role === MessageRole.SYSTEM) continue;
      if (!msg.text) continue;

      const role: 'user' | 'assistant' =
        msg.role === MessageRole.CUSTOMER ? 'user' : 'assistant';

      // รวมข้อความ consecutive same-role (Anthropic ต้องการสลับ user/assistant)
      const last = messages[messages.length - 1];
      if (last && last.role === role) {
        last.content += '\n' + msg.text;
      } else {
        messages.push({ role, content: msg.text });
      }
    }

    // ใส่ข้อความปัจจุบันเป็น user message สุดท้าย
    const last = messages[messages.length - 1];
    if (last && last.role === 'user') {
      last.content += '\n' + currentUserMessage;
    } else {
      messages.push({ role: 'user', content: currentUserMessage });
    }

    // Anthropic ต้องการ message แรกเป็น user เสมอ
    while (messages.length > 0 && messages[0].role !== 'user') {
      messages.shift();
    }

    return messages;
  }
}
