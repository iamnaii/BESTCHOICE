import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from '../../storage/storage.service';
import { BotRuntimeConfigService, type RateCardsConfig } from '../bot-runtime-config.service';
import { MAX_BOT_ATTACHMENTS, RATE_CARD_ID_PREFIX } from '../../../utils/bot-attachments.util';

/**
 * ส่ง "รูป" ตารางผ่อน/แผนที่ของร้าน (รูปทางการชุดเดียวกับที่พนักงานส่งในแชท — เจ้าของสั่ง 2026-09-22)
 *
 * ตัวรูปอยู่ใน SystemConfig `shop_bot_rate_cards` (card → storageKey/url + label) เปลี่ยนรูปได้โดย
 * อัปโหลดไฟล์ใหม่แล้วแก้ค่าตั้ง ไม่ต้อง deploy. รูปถูกแนบหลังข้อความโดย router จากผลลัพธ์ของ tool นี้
 * (collectAttachmentsFromToolResult) — โมเดลไม่เคยเห็นลิงก์ (redactMediaUrls ตัด photoUrl ออก)
 * และแต่งลิงก์เองไม่ได้
 *
 * นิยามเครื่องมือสร้างตอนรันจากรูปที่ตั้งไว้จริงเท่านั้น (buildSendRateCardTool) — เดิมประกาศครบ 6 ใบ
 * ทั้งที่ prod มีแค่ imported_free_down + shop_map ⇒ โมเดลขอ used_rate1/2 ทุกเทิร์นเรทแรก ได้ missing
 * แล้วข้อความเรทที่เขียนไว้หาย (รีวิว TOOLLOOP-1 / PROMPT-2 2026-09-22)
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

/** ความหมายของแต่ละรูป (บอกโมเดลว่าใช้เมื่อไร) — ชื่อที่จดลงประวัติแชทมาจาก label ในค่าตั้ง */
export const RATE_CARD_MEANINGS: Record<RateCardKey, string> = {
  imported_free_down: 'ตารางโปรฟรีดาวน์ไอโฟนมือ 2 เครื่องนอก',
  used_rate1: 'ตารางไอโฟนมือ 2 เรทที่ 1 (สเตทเม้นท์)',
  used_rate2: 'ตารางไอโฟนมือ 2 เรทที่ 2',
  new_rate1: 'ตารางไอโฟนมือ 1 เรทที่ 1',
  new_rate2: 'ตารางไอโฟนมือ 1 เรทที่ 2',
  shop_map: 'วิธีเดินทางมาร้าน',
};

/** ส่งได้สูงสุดเท่านี้ต่อครั้ง — เท่ากับเพดานช่องแนบของคำตอบ (MAX_BOT_ATTACHMENTS) */
export const MAX_CARDS_PER_CALL = MAX_BOT_ATTACHMENTS;
/** ลิงก์ลงนาม 7 วัน (เพดานของ GCS/S3 V4) — รูปในประวัติแชทของพนักงานยังเปิดได้หลายวัน */
const SIGNED_URL_TTL_SEC = 7 * 24 * 3600;
/** ชื่อรูปแปลก ๆ ที่โมเดลแต่งมา ถูกตัดความยาวก่อนใส่ใน missing (กันข้อความยาวย้อนเข้าโมเดล/ล็อก) */
const MAX_UNKNOWN_KEY_LEN = 40;
/**
 * ใส่ใน missing เมื่อโมเดลเรียกโดยไม่ระบุรูปเลย (cards ว่าง/ไม่ส่ง) — เดิมคืน sent/missing ว่างทั้งคู่
 * ⇒ ไม่นับว่าสำเร็จ แต่ก็ไม่มีหมายเหตุ ลูปวนเงียบแล้วข้อความที่เขียนไว้หาย (รีวิว SB-V3)
 */
export const NO_CARD_REQUESTED = '(ไม่ได้ระบุรูป)';

export function isRateCardKey(key: string): key is RateCardKey {
  return (RATE_CARD_KEYS as readonly string[]).includes(key);
}

/** รูปที่ตั้งไว้จริงใน SystemConfig ∩ รูปที่ระบบรู้จัก (เรียงตาม RATE_CARD_KEYS — prompt cache คงที่) */
export function configuredRateCardKeys(cards: RateCardsConfig | null | undefined): RateCardKey[] {
  if (!cards) return [];
  return RATE_CARD_KEYS.filter((k) => !!cards[k]);
}

export interface SendRateCardToolDefinition {
  name: 'send_rate_card';
  description: string;
  input_schema: {
    type: 'object';
    properties: {
      cards: {
        type: 'array';
        items: { type: 'string'; enum: string[] };
        minItems: 1;
        description: string;
      };
    };
    required: ['cards'];
  };
}

function describeCard(key: RateCardKey, label?: string): string {
  const meaning = RATE_CARD_MEANINGS[key];
  return label && label !== meaning
    ? `${key} = ${meaning} (ในประวัติแชทขึ้นว่า "[รูป ${label}]")`
    : `${key} = ${meaning}`;
}

function toolDefinitionFor(keys: RateCardKey[], cards?: RateCardsConfig): SendRateCardToolDefinition {
  return {
    name: 'send_rate_card',
    description:
      'ส่งรูปตารางผ่อน/แผนที่ร้าน (รูปทางการของร้าน) ให้ลูกค้า — ระบบแนบรูปต่อท้ายข้อความของคุณเอง ' +
      `ห้ามพิมพ์ลิงก์ ห้ามพิมพ์ตารางซ้ำทั้งตาราง ส่งได้สูงสุด ${MAX_CARDS_PER_CALL} รูปต่อเทิร์น. ` +
      `รูปที่มีในระบบตอนนี้ (มีแค่นี้ — รูปอื่นส่งไม่ได้ ให้ตอบเป็นข้อความโดยไม่พูดถึงรูป): ${keys
        .map((k) => describeCard(k, cards?.[k]?.label))
        .join(' · ')}. ` +
      'ผลลัพธ์ sent = รูปที่แนบถึงลูกค้าจริง · missing = ส่งไม่ได้ (ห้ามบอกว่าส่งรูปนั้นแล้ว ห้ามพูดถึงรูปนั้น) · ' +
      'มี systemNote ในผลลัพธ์ = ทำตามก่อนตอบ',
    input_schema: {
      type: 'object',
      properties: {
        cards: {
          type: 'array',
          items: { type: 'string', enum: [...keys] },
          // Gemini ตัดคีย์นี้ทิ้งเอง (sanitizeSchema) — Claude ใช้ได้ · ด่านจริงอยู่ใน run (NO_CARD_REQUESTED)
          minItems: 1,
          description: `รูปที่จะส่ง 1-${MAX_CARDS_PER_CALL} ใบ`,
        },
      },
      required: ['cards'],
    },
  };
}

/**
 * นิยาม send_rate_card ของเทิร์นนี้ — enum/คำอธิบายมีเฉพาะรูปที่ตั้งไว้ใน `shop_bot_rate_cards`
 * (∩ RATE_CARD_KEYS) พร้อมชื่อที่จดลงประวัติแชท · ไม่มีรูปที่ตั้งไว้เลย = null (ไม่ต้องประกาศเครื่องมือ)
 */
export function buildSendRateCardTool(
  cards: RateCardsConfig | null | undefined,
): SendRateCardToolDefinition | null {
  const keys = configuredRateCardKeys(cards);
  if (keys.length === 0) return null;
  return toolDefinitionFor(keys, cards ?? undefined);
}

/**
 * @deprecated ประกาศครบทุกรูปโดยไม่ดูค่าตั้ง — ใช้ `buildSendRateCardTool(<ค่าตั้งจริง>)` แทน
 * (เก็บไว้ให้ผู้เรียกเดิม เช่น bot-eval ที่ยังไม่ย้าย) · prod ใช้ตัวสร้างตอนรันเสมอ
 */
export const SEND_RATE_CARD_TOOL: SendRateCardToolDefinition = toolDefinitionFor([...RATE_CARD_KEYS]);

export interface SendRateCardResult {
  sent: { card: string; label: string }[];
  /**
   * ส่งไม่ได้ทุกกรณี: ยังไม่ตั้งรูป / ลงนามลิงก์พัง / เกินเพดานต่อครั้ง / ชื่อที่ระบบไม่รู้จัก / ช่องแนบเต็ม /
   * ไม่ได้ระบุรูปเลย (NO_CARD_REQUESTED)
   */
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
    const requested = [
      ...new Set(
        (Array.isArray(input?.cards) ? input.cards : [input?.cards])
          .map((c) => String(c ?? '').trim())
          .filter(Boolean),
      ),
    ];

    const result: SendRateCardResult = { sent: [], missing: [], images: [] };
    if (requested.length === 0) {
      result.missing.push(NO_CARD_REQUESTED);
      return result;
    }
    const config = await this.runtimeConfig.getRateCards();
    for (const card of requested) {
      // ชื่อที่ไม่รู้จัก = บอกโมเดลตามจริงว่าส่งไม่ได้ (เดิมทิ้งเงียบ แล้วผลดู "ครบ")
      if (!isRateCardKey(card)) {
        result.missing.push(card.slice(0, MAX_UNKNOWN_KEY_LEN));
        continue;
      }
      const entry = config?.[card];
      if (!entry) {
        result.missing.push(card);
        continue;
      }
      // เพดานนับเฉพาะใบที่ส่งได้จริง — ใบที่ยังไม่ตั้ง/ลงนามพังไม่กินโควตา (เดิมนับก่อนเช็ค ⇒
      // ['used_rate1','used_rate2','shop_map'] บน prod ส่งไม่ได้สักใบ ทั้งที่แผนที่ตั้งไว้แล้ว — รีวิว SB-V4)
      if (result.sent.length >= MAX_CARDS_PER_CALL) {
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
      result.images.push({ id: `${RATE_CARD_ID_PREFIX}${card}`, photoUrl: url, productName: entry.label });
    }
    return result;
  }
}
