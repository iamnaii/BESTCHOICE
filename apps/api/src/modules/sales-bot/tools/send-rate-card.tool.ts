import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from '../../storage/storage.service';
import { BotRuntimeConfigService } from '../bot-runtime-config.service';

/**
 * ส่ง "รูป" ตารางผ่อน/แผนที่ของร้าน (รูปทางการชุดเดียวกับที่พนักงานส่งในแชท — เจ้าของสั่ง 2026-09-22)
 *
 * ตัวรูปอยู่ใน SystemConfig `shop_bot_rate_cards` (card → storageKey/url + label) เปลี่ยนรูปได้โดย
 * อัปโหลดไฟล์ใหม่แล้วแก้ค่าตั้ง ไม่ต้อง deploy. รูปถูกแนบหลังข้อความโดย router จากผลลัพธ์ของ tool นี้
 * (collectAttachmentsFromToolResult) — โมเดลไม่เคยเห็นลิงก์ (redactMediaUrls ตัด photoUrl ออก)
 * และแต่งลิงก์เองไม่ได้
 */
export const RATE_CARD_KEYS = [
  'imported_free_down',
  'used_rate1',
  'used_rate2',
  'new_rate1',
  'new_rate2',
  'shop_map',
] as const;
export type RateCardKey = (typeof RATE_CARD_KEYS)[number];

/** ส่งได้สูงสุดเท่านี้ต่อเทิร์น — เท่ากับ MAX_BOT_ATTACHMENTS ของ router */
const MAX_CARDS_PER_CALL = 2;
/** ลิงก์ลงนาม 7 วัน (เพดานของ GCS/S3 V4) — รูปในประวัติแชทของพนักงานยังเปิดได้หลายวัน */
const SIGNED_URL_TTL_SEC = 7 * 24 * 3600;

export const SEND_RATE_CARD_TOOL = {
  name: 'send_rate_card',
  description:
    'ส่งรูปตารางผ่อน/แผนที่ร้าน (รูปทางการของร้าน) ให้ลูกค้า — ระบบแนบรูปต่อท้ายข้อความของคุณเอง ' +
    'ห้ามพิมพ์ลิงก์ ห้ามพิมพ์ตารางซ้ำทั้งตาราง ส่งได้สูงสุด 2 รูปต่อเทิร์น. ' +
    'cards: imported_free_down = ตารางโปรฟรีดาวน์ไอโฟนมือ 2 เครื่องนอก · ' +
    'used_rate1 = ตารางไอโฟนมือ 2 เรทที่ 1 (สเตทเม้นท์) · used_rate2 = ตารางไอโฟนมือ 2 เรทที่ 2 · ' +
    'new_rate1 = ตารางไอโฟนมือ 1 เรทที่ 1 · new_rate2 = ตารางไอโฟนมือ 1 เรทที่ 2 · shop_map = วิธีเดินทางมาร้าน. ' +
    'ผลลัพธ์ sent = รูปที่ส่งจริง · missing = ยังไม่ได้ตั้งรูป (ตอบเป็นข้อความตามปกติ ห้ามบอกว่าส่งรูปแล้ว)',
  input_schema: {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: { type: 'string', enum: [...RATE_CARD_KEYS] },
        description: 'รูปที่จะส่ง 1-2 ใบ',
      },
    },
    required: ['cards'],
  },
};

export interface SendRateCardResult {
  sent: { card: string; label: string }[];
  missing: string[];
  /** อ่านโดย collectAttachmentsFromToolResult เท่านั้น — photoUrl ถูกตัดก่อนถึงโมเดล */
  images: { id: string; photoUrl: string; productName: string }[];
}

const HTTPS_RE = /^https:\/\//i;

@Injectable()
export class SendRateCardTool {
  private readonly logger = new Logger(SendRateCardTool.name);

  constructor(
    private readonly runtimeConfig: BotRuntimeConfigService,
    private readonly storage: StorageService,
  ) {}

  async run(input: { cards?: unknown }): Promise<SendRateCardResult> {
    const requested = (Array.isArray(input?.cards) ? input.cards : [input?.cards])
      .map((c) => String(c ?? '').trim())
      .filter((c): c is RateCardKey => (RATE_CARD_KEYS as readonly string[]).includes(c));
    const unique = [...new Set(requested)].slice(0, MAX_CARDS_PER_CALL);

    const config = await this.runtimeConfig.getRateCards();
    const result: SendRateCardResult = { sent: [], missing: [], images: [] };
    for (const card of unique) {
      const entry = config[card];
      if (!entry) {
        result.missing.push(card);
        continue;
      }
      let url: string | null = null;
      if (entry.url && HTTPS_RE.test(entry.url)) {
        url = entry.url;
      } else if (entry.storageKey) {
        try {
          url = await this.storage.getSignedDownloadUrl(entry.storageKey, SIGNED_URL_TTL_SEC);
        } catch (err) {
          this.logger.warn(
            `[send_rate_card] sign failed card=${card} key=${entry.storageKey}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      if (!url || !HTTPS_RE.test(url)) {
        result.missing.push(card);
        continue;
      }
      result.sent.push({ card, label: entry.label });
      result.images.push({ id: `card:${card}`, photoUrl: url, productName: entry.label });
    }
    return result;
  }
}
