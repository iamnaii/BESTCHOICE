import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import Anthropic from '@anthropic-ai/sdk';

export interface SlipExtraction {
  isSlip: boolean;
  bankName?: string;
  amount?: number;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:mm
  refNo?: string;
  fromAccount?: string;
  toAccount?: string;
  toName?: string;
  confidence: number;
}

const SLIP_PROMPT = `คุณคือระบบ extract ข้อมูลจากสลิปโอนเงินธนาคารไทย
อ่านรูปสลิปนี้และตอบเป็น JSON เท่านั้น (ห้ามมี markdown หรือคำอธิบาย):

{
  "isSlip": true | false,
  "bankName": "ธนาคารกสิกรไทย",
  "amount": 2500.00,
  "date": "2026-04-15",
  "time": "14:30",
  "refNo": "เลขที่อ้างอิง",
  "fromAccount": "บัญชีต้นทาง (มาส์กแล้ว)",
  "toAccount": "203-1-16520-5",
  "toName": "บจก. เบสท์ช้อยส์โฟน",
  "confidence": 0.95
}

ถ้าไม่ใช่สลิป ตอบ: {"isSlip": false, "confidence": 0}
ถ้าอ่านไม่ออกบาง field ใส่ null
ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่น`;

/**
 * Vision Service — extract slip data จากรูป
 * ใช้ Claude Sonnet 4.5 vision (built-in)
 */
@Injectable()
export class VisionService {
  private readonly logger = new Logger(VisionService.name);
  private readonly anthropic: Anthropic | null;
  private readonly model = 'claude-sonnet-4-5-20250929';

  constructor(private config: ConfigService) {
    const apiKey = (
      this.config.get<string>('ANTHROPIC_API_KEY') ||
      process.env.ANTHROPIC_API_KEY ||
      ''
    ).trim();
    this.anthropic = apiKey ? new Anthropic({ apiKey }) : null;
  }

  get isEnabled(): boolean {
    return this.anthropic !== null;
  }

  async extractSlip(imageBuffer: Buffer, mediaType = 'image/jpeg'): Promise<SlipExtraction | null> {
    if (!this.anthropic) {
      this.logger.warn('[Vision] Disabled — no API key');
      return null;
    }

    try {
      const base64 = imageBuffer.toString('base64');

      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: this.normalizeMediaType(mediaType),
                  data: base64,
                },
              },
              { type: 'text', text: SLIP_PROMPT },
            ],
          },
        ],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';
      if (!text) {
        this.logger.warn('[Vision] Empty response from Claude');
        return null;
      }

      // Parse JSON (Claude บางครั้งห่อด้วย code fence)
      const jsonStr = text.replace(/```json\n?|```/g, '').trim();
      try {
        const parsed = JSON.parse(jsonStr) as SlipExtraction;
        this.logger.log(
          `[Vision] Extracted: amount=${parsed.amount} confidence=${parsed.confidence}`,
        );
        return parsed;
      } catch (parseErr) {
        // Log raw text (truncated) เพื่อ debug ว่า Claude ตอบรูปแบบอะไรมา
        this.logger.error(
          `[Vision] JSON parse failed: ${parseErr instanceof Error ? parseErr.message : parseErr}\n` +
            `Raw response: ${text.slice(0, 500)}`,
        );
        return null;
      }
    } catch (err) {
      this.logger.error(
        `[Vision] API error: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, {
        tags: { module: 'chatbot-finance', action: 'vision_extract' },
      });
      return null;
    }
  }

  private normalizeMediaType(mt: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
    const lower = mt.toLowerCase();
    if (lower.includes('png')) return 'image/png';
    if (lower.includes('gif')) return 'image/gif';
    if (lower.includes('webp')) return 'image/webp';
    return 'image/jpeg';
  }
}
