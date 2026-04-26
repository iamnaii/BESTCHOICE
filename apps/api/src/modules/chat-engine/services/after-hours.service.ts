import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

/**
 * AfterHoursService — AI auto-reply for messages received outside business hours.
 *
 * Business hours: 10:00-20:00 Bangkok time (UTC+7), every day.
 * When a customer messages outside these hours:
 * 1. Claude generates a polite, context-aware reply
 * 2. Informs customer that staff will follow up during business hours
 * 3. Can answer general questions (pricing, installments, branches)
 *
 * Falls back to a static Thai reply if ANTHROPIC_API_KEY is not configured.
 */
@Injectable()
export class AfterHoursService {
  private readonly logger = new Logger(AfterHoursService.name);
  private anthropic: Anthropic | null = null;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
      this.logger.log('Anthropic client initialized for after-hours auto-reply');
    } else {
      this.logger.warn(
        'ANTHROPIC_API_KEY not configured — after-hours will use default reply',
      );
    }
  }

  /**
   * Check if current time is outside business hours (10:00-20:00 Bangkok).
   */
  isAfterHours(): boolean {
    const now = new Date();
    const bangkokHour = (now.getUTCHours() + 7) % 24;
    return bangkokHour < 10 || bangkokHour >= 20;
  }

  /**
   * Get next business opening time (10:00 AM Bangkok = 03:00 UTC).
   */
  getNextOpenTime(): Date {
    const now = new Date();
    const bangkokHour = (now.getUTCHours() + 7) % 24;

    const next = new Date(now);

    if (bangkokHour >= 20) {
      // After 20:00 Bangkok — next opening is tomorrow 10:00 Bangkok
      next.setUTCDate(next.getUTCDate() + 1);
    }
    // If before 10:00 Bangkok — next opening is today 10:00 Bangkok

    // Set to 10:00 Bangkok = 03:00 UTC
    next.setUTCHours(3, 0, 0, 0);

    // If the calculated time is in the past (edge case), add a day
    if (next.getTime() <= now.getTime()) {
      next.setUTCDate(next.getUTCDate() + 1);
    }

    return next;
  }

  /**
   * Generate an AI-powered auto-reply for after-hours messages.
   * Falls back to static reply if Anthropic is not configured or call fails.
   */
  async getAutoReply(customerMessage: string): Promise<string> {
    if (!this.anthropic) {
      return this.getDefaultReply();
    }

    try {
      // (Audit finding P1) Cap at 25s so the LINE 30s reply-token window
      // is not blown if Anthropic is slow. SDK default is 600s (10 min)
      // which would silently fail every reply on a slow request.
      const response = await this.anthropic.messages.create(
        {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          system: `คุณเป็นผู้ช่วยร้าน BESTCHOICE (ร้านมือถือ) ตอนนี้อยู่นอกเวลาทำการ (10:00-20:00)
ตอบลูกค้าสั้นๆ สุภาพ แจ้งว่าจะมีเจ้าหน้าที่ติดต่อกลับในเวลาทำการ
ถ้าลูกค้าถามเรื่องทั่วไป (ราคา, ผ่อน, สาขา) ตอบได้เลย
ห้ามสร้างข้อมูลเท็จ ถ้าไม่แน่ใจให้บอกว่าจะให้เจ้าหน้าที่ตอบ
ตอบเป็นภาษาไทย ใช้คำลงท้ายว่า "ค่ะ" หรือ "นะคะ"`,
          messages: [
            {
              role: 'user',
              content: customerMessage || '(ส่งข้อความ)',
            },
          ],
        },
        { timeout: 25_000 },
      );

      const textBlock = response.content.find((b) => b.type === 'text');
      if (textBlock && textBlock.type === 'text') {
        return textBlock.text;
      }

      return this.getDefaultReply();
    } catch (err) {
      this.logger.error(
        `Anthropic API error: ${err instanceof Error ? err.message : err}`,
      );
      return this.getDefaultReply();
    }
  }

  /**
   * Static fallback reply when AI is unavailable.
   */
  private getDefaultReply(): string {
    return 'ขอบคุณที่ติดต่อ BESTCHOICE ค่ะ 🙏\nขณะนี้อยู่นอกเวลาทำการ (10:00-20:00)\nเจ้าหน้าที่จะติดต่อกลับในเวลาทำการนะคะ';
  }
}
