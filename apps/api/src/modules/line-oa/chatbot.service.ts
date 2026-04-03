import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { CHATBOT_SYSTEM_PROMPT } from './chatbot-system-prompt.constants';

/**
 * ChatbotService — AI-powered response generation สำหรับน้องเบส
 * ใช้สำหรับ freeform messages ที่ไม่ใช่ keyword commands
 */
@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private anthropic: Anthropic | null = null;
  private static readonly MODEL = 'claude-haiku-4-5-20251001'; // Haiku สำหรับ chatbot (เร็ว + ประหยัด)
  private static readonly MAX_TOKENS = 500;

  constructor(private configService: ConfigService) {
    const apiKey = (
      this.configService.get<string>('ANTHROPIC_API_KEY') ||
      process.env.ANTHROPIC_API_KEY ||
      ''
    ).trim();
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
      this.logger.log('[Chatbot] AI service initialized');
    } else {
      this.logger.warn('[Chatbot] ANTHROPIC_API_KEY not set — AI responses disabled');
    }
  }

  get isEnabled(): boolean {
    return this.anthropic !== null;
  }

  /**
   * สร้าง AI response สำหรับข้อความที่ไม่ match keyword commands
   * ถ้า AI ไม่พร้อม จะ return null (controller จะใช้ fallback response แทน)
   */
  async generateResponse(userMessage: string): Promise<string | null> {
    if (!this.anthropic) {
      return null;
    }

    try {
      const response = await this.anthropic.messages.create({
        model: ChatbotService.MODEL,
        max_tokens: ChatbotService.MAX_TOKENS,
        system: CHATBOT_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: userMessage,
          },
        ],
      });

      const textBlock = response.content.find((block) => block.type === 'text');
      return textBlock ? textBlock.text : null;
    } catch (err) {
      this.logger.error(`[Chatbot] AI response error: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }
}
