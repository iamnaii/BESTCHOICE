import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { AiUsageService } from '../../ai-usage/ai-usage.service';
import { SHOP_CLOSE_HOUR, SHOP_OPEN_HOUR } from '../../../utils/shop-hours.util';

/** "10:00-19:00 น." — เวลาร้านจริง (KB store_location_hours) จากแหล่งเดียวกับบอทขาย */
const SHOP_HOURS_TEXT = `${String(SHOP_OPEN_HOUR).padStart(2, '0')}:00-${SHOP_CLOSE_HOUR}:00 น.`;

/**
 * AfterHoursService — AI auto-reply for messages received outside business hours.
 *
 * ช่วงที่ตอบ (isAfterHours): 20:00-10:00 เวลาไทย — **ใช้ร่วมกับ LINE_FINANCE จึงยังไม่เปลี่ยนเป็น 19:00**
 * (รอเจ้าของเคาะ) ส่วนเนื้อหาที่ตอบใช้ข้อมูลร้านจริง: เปิดทุกวัน 10:00-19:00 น. (C03, 2026-09-22)
 * ทางนี้ทำงานเฉพาะเมื่อบอทขายไม่ได้รับห้องนั้น (AI auto ปิด/ข้าม) — ตอบสั้น ๆ ว่ารับเรื่องแล้ว
 * ทีมงานตอบตอนร้านเปิด · ห้ามบอกตัวเลข (ราคา/ค่างวด/ดาวน์/สต๊อก) · ห้ามแต่งข้อมูลสาขา/ที่อยู่/เบอร์
 *
 * Falls back to a static Thai reply if ANTHROPIC_API_KEY is not configured.
 */
@Injectable()
export class AfterHoursService {
  private readonly logger = new Logger(AfterHoursService.name);
  private anthropic: Anthropic | null = null;
  private static readonly MODEL = 'claude-haiku-4-5-20251001';

  /**
   * ข้อมูลร้านที่โมเดลรู้ได้ — มีเท่านี้จริง ๆ (ไม่มีที่อยู่/เบอร์/รายชื่อสาขาใน prompt โดยตั้งใจ:
   * ของที่ไม่อยู่ในนี้ให้ตอบว่าทีมงานจะแจ้งตอนร้านเปิด แทนการเดา)
   */
  static readonly SYSTEM_PROMPT = `คุณเป็นผู้ช่วยตอบแชทของร้าน BESTCHOICE (ร้านมือถือ) ตอนนี้ร้านปิดแล้ว
ข้อมูลร้านที่ยืนยันได้มีแค่: ร้านเปิดทุกวัน ${SHOP_HOURS_TEXT}

กติกา:
- ตอบสั้น สุภาพ ไม่เกิน 3 บรรทัด: รับเรื่องไว้แล้ว ทีมงานจะเข้ามาตอบตอนร้านเปิด ${SHOP_OPEN_HOUR} โมง
- ถามราคา ค่างวด ผ่อน ดาวน์ โปรโมชัน สต๊อก "มีของไหม" รุ่น/สี/ความจุ: บอกว่าทีมงานจะเช็คแล้วตอบให้ช่วงร้านเปิด
- ห้ามบอกตัวเลขใด ๆ เกี่ยวกับราคา ค่างวด ดาวน์ ดอกเบี้ย จำนวนงวด หรือจำนวนเครื่อง
- ห้ามแต่งที่อยู่ สาขา เบอร์โทร ลิงก์ หรือแผนที่ — ถ้าถามที่ตั้งร้าน บอกว่าทีมงานจะส่งที่ตั้งให้ช่วงร้านเปิด
- เรื่องชำระค่างวด/สัญญาของลูกค้าที่ผ่อนอยู่: บอกว่าทีมงานจะตรวจสอบและแจ้งกลับในเวลาทำการ
- ห้ามสัญญาว่าจะตอบ "สักครู่" หรือ "เดี๋ยวนี้" และห้ามรับปากว่าอนุมัติ/ผ่านแน่นอน
- ตอบเป็นภาษาไทย ใช้คำลงท้ายว่า "ค่ะ" หรือ "นะคะ"`;

  constructor(
    private configService: ConfigService,
    private aiUsage: AiUsageService,
  ) {
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
   * ⚠️ 20:00 (ไม่ใช่ 19:00 ตามเวลาร้าน) — ใช้ร่วมกับ LINE_FINANCE ห้ามเปลี่ยนก่อนเจ้าของเคาะ
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
          model: AfterHoursService.MODEL,
          max_tokens: 300,
          system: AfterHoursService.SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: customerMessage || '(ส่งข้อความ)',
            },
          ],
        },
        { timeout: 25_000 },
      );

      void this.aiUsage.record({
        service: 'after-hours',
        method: 'getAutoReply',
        model: AfterHoursService.MODEL,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        status: 'success',
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      if (textBlock && textBlock.type === 'text' && textBlock.text.trim()) {
        // ตาข่ายชั้นสุดท้าย: โมเดลหลุดบอกตัวเลข (ราคา/ค่างวด/เบอร์) ทั้งที่ prompt ห้าม → ใช้ข้อความมาตรฐาน
        if (AfterHoursService.containsFigures(textBlock.text)) {
          this.logger.warn('[AfterHours] reply contained figures — using default reply');
          return this.getDefaultReply();
        }
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
   * ข้อความมีตัวเลขแบบราคา/ค่างวด/เบอร์โทร (3 หลักขึ้นไป หรือมีจุลภาคคั่นหลักพัน) หรือไม่
   * เวลาแบบ 10:00 / 19.00 ไม่นับ — prompt ให้บอกเวลาร้านได้
   */
  static containsFigures(text: string): boolean {
    const withoutTimes = text.replace(/\b\d{1,2}[:.]\d{2}\b/g, ' ');
    return /\d[\d,]{2,}/.test(withoutTimes);
  }

  /**
   * Static fallback reply when AI is unavailable.
   */
  private getDefaultReply(): string {
    return `ขอบคุณที่ทักมานะคะ 🙏\nตอนนี้ร้านปิดแล้ว (ร้านเปิดทุกวัน ${SHOP_HOURS_TEXT})\nรับเรื่องไว้แล้ว ทีมงานจะเข้ามาตอบตอนร้านเปิด ${SHOP_OPEN_HOUR} โมงค่ะ`;
  }
}
