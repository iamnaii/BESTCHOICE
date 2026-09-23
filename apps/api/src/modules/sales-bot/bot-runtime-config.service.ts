import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SHOP_OPEN_LABEL_TH } from '../../utils/shop-hours.util';

/**
 * ค่าตั้งของบอทขายที่สลับได้ตอนรัน (SystemConfig — มีผลใน ≤60 วิ ไม่ต้อง deploy)
 *
 * - `shop_bot_stock_mode` = 'NO_STOCK' → โหมดไม่มีสต๊อก (เจ้าของสั่ง 2026-09-22: ช่วงเริ่มใช้จริง
 *   ระบบยังไม่มีรายการเครื่อง แต่หน้าร้านมีเครื่องจริง) — บอทไม่ค้นสต๊อก ไม่พูดว่าหมด/กำลังเข้า
 *   และส่งเรื่องสี/แบต/รูปเครื่องจริงให้พนักงาน · ไม่มีแถว/ค่าอื่น = โหมดปกติ (อ่านสต๊อก)
 * - `shop_bot_rate_cards` = JSON `{ "<card>": { "storageKey"?: string, "url"?: string, "label": string } }`
 *   รูปตารางผ่อน/แผนที่ของร้านที่บอทส่งได้ (ดู send-rate-card.tool.ts)
 */
export const STOCK_MODE_CONFIG_KEY = 'shop_bot_stock_mode';
export const RATE_CARDS_CONFIG_KEY = 'shop_bot_rate_cards';

export type StockMode = 'LIVE' | 'NO_STOCK';

export interface RateCardConfigEntry {
  /** object key ในถังเก็บไฟล์ของระบบ — ส่งเป็นลิงก์ลงนามอายุสั้นทุกครั้งที่ส่ง */
  storageKey?: string;
  /** ลิงก์ https สาธารณะ (ถ้ามี ใช้แทน storageKey) */
  url?: string;
  /** ชื่อที่จดลงประวัติแชทเป็น "[รูป <label>]" ให้บอทจำได้ว่าส่งอะไรไปแล้ว */
  label: string;
}

export type RateCardsConfig = Record<string, RateCardConfigEntry>;

const CACHE_TTL_MS = 60_000;

/**
 * บล็อกคำสั่งที่ต่อท้าย system prompt เฉพาะตอน NO_STOCK — อยู่ในโค้ดเพื่อให้สวิตช์เดียว
 * (`shop_bot_stock_mode`) เปิด/ปิดทั้งพฤติกรรมเครื่องมือและถ้อยคำพร้อมกัน
 * ⚠️ แก้ข้อความนี้ = ต้องวัด bot:eval ฉาก NS* ใหม่ (EVAL_NO_STOCK=1)
 */
export const NO_STOCK_PROMPT = [
  '',
  '# โหมดชั่วคราว: ระบบสต๊อกยังไม่เชื่อม (กติกาหัวข้อนี้ชนะทุกกติกาเรื่องสต๊อกข้างบน)',
  'ร้านมีเครื่องจริงที่หน้าร้านตามปกติ แต่ระบบยังไม่มีรายการเครื่อง — โหมดนี้ search_products และ calculate_installment คืน unavailable เสมอ: ไม่ต้องเรียก (เผลอเรียกให้ข้ามผลนั้นแล้วทำต่อ) ทุกกติกาข้างบนที่สั่งให้ใช้ผลสองตัวนี้ ให้ข้ามไปเลย',
  '- ห้ามพูดว่า "หมด" "ของหมดชั่วคราว" "ไม่มีของ" "ของกำลังเข้ามา" "จองไว้ก่อน" "ของเข้าแล้วแจ้ง" "พร้อมส่ง" และห้ามรับปากว่ามีสี/ความจุ/สภาพไหนแน่นอน · สคริปต์สต๊อกข้างบน ("ของกำลังจะเข้ามาอีก 1-2 วัน" / ก้อนนำ "มีของพร้อมรับที่ร้านค่ะ" / สถานะของในการ์ด) ให้ตัดทิ้ง',
  '- ขั้น 1-3 ถามรุ่นย่อย / ความจุ / มือ 1-มือสอง ตามลำดับเดิม โดยใช้ get_installment_rates (ตัวเลือกความจุจากตาราง) และรายการมือ 1 — ไม่ต้องค้นสต๊อก · ขั้น 3 ตัดสินมือ 1/มือสองจากรายการมือ 1 + condition ในตารางเรท (ไม่มีข้อมูลสต๊อกไม่ได้แปลว่ามีทางเดียว)',
  '- ทางเครื่องไทย (มือสอง) หรือมือ 1 ที่ลูกค้ายังไม่ส่งสัญญาณซื้อสด (ยังไม่พูดว่าเงินสด/ซื้อสด/จ่ายสด และไม่ได้ถามราคาสดเอง) → ห้ามถาม "เงินสดหรือผ่อน" · เรียก get_installment_rates({query: "<รุ่น ความจุ>", condition: "มือสอง" หรือ "มือ 1"}) (ไม่ต้องใส่ deviceOrigin) แล้วเสนอเรทแบบ 4B ในเทิร์นนั้นเลย — ไม่มีข้อมูลสต๊อก = กรณี "ไม่เจอของ" ที่ให้เสนอเรททันที · กติกา "เจอของในสต็อก (4A) ถามเงินสด/ผ่อนก่อน" ไม่ใช้ในโหมดนี้',
  '- ขั้น 4 ผ่อน = ใช้รูปแบบ 4B แต่ตัดก้อนสถานะของทิ้ง เริ่มที่ก้อนเรทเลย · ปิดท้ายด้วยคำถามเลือกเรท (ห้ามปิดด้วย "ของเข้าแล้วแจ้ง") · ไม่มีจังหวะเสนอเชิงรุก',
  '- โปรฟรีดาวน์เครื่องนอก: ค่างวดจาก search_knowledge_base ตามทางเครื่องนอกเดิม',
  '- recommend_devices โหมดนี้ไม่มีข้อมูลสต๊อก (ไม่มี inStock/unitCount/sampleUnit): การ์ดแนะนำห้ามมีแบต%/สี และห้ามพูด "มีของ" "พร้อมรับที่ร้าน" "หมด" "กำลังเข้า" — ใส่แค่รุ่น ความจุ มือ 1/มือสอง เรท ดาวน์ ผ่อน งวด ตามผล',
  '- notify_staff = ปักธงให้แอดมินตามเรื่อง บอทยังตอบห้องนี้ต่อได้ตามปกติ (ไม่ใช่การส่งต่อทั้งห้อง) · ในประวัติบอกลูกค้าไปแล้วว่าแอดมินจะตามเรื่องเดียวกัน = ไม่ต้องเรียกซ้ำ ไม่ต้องพูดซ้ำ',
  '- ซื้อสด (ลูกค้าส่งสัญญาณซื้อสดหรือถามราคาสดเอง): "ราคาเงินสดขอทีมเช็คแล้วแจ้งกลับนะคะ" แล้วเรียก notify_staff (reason = รุ่น + ขอราคาเงินสด) ในข้อความเดียวกัน · เทิร์นนั้นไม่ต้องขอชื่อ-เบอร์ ไม่ต้องมีคำถามปิด (ทีมงานแจ้งราคาในแชทนี้) · เสนอเรทผ่อนแทนได้เฉพาะเมื่อลูกค้าถามเอง',
  `- ลูกค้าถาม สี / แบต / สภาพ / ตำหนิ / ขอดูรูปเครื่องจริง / "มีของไหม" → ห้ามบอกสีหรือแบตเอง ห้ามรับปากว่ามี · ก้อนแรก 2 บรรทัด "ได้เลยค่ะ" / "เดี๋ยวแอดมินส่งรูปเครื่องจริงให้ดูนะคะ" (นอกเวลาทำการ: "แอดมินส่งรูปให้ช่วงร้านเปิด ${SHOP_OPEN_LABEL_TH}นะคะ") แล้วเรียก notify_staff ในข้อความเดียวกัน (reason = รุ่นที่สนใจ + สิ่งที่ลูกค้าขอ · รุ่นย่อยยังไม่ชัดก็เรียกเลย ใส่รุ่นเท่าที่รู้) ไม่ต้องค้นอะไรก่อน · บอทคุยต่อได้: ก้อนถัดไปเดินขั้นขายต่อ 1 เรื่องตามปกติ (รุ่นย่อย/ความจุยังไม่ชัด → ถามพร้อมปุ่ม · ข้อความเดียวกันถามเรื่องอื่นด้วย → ตอบเรื่องนั้น) · ห้ามเติมโปร/ประกัน/ราคาที่ลูกค้าไม่ได้ถาม`,
  '- ลูกค้าถามว่าร้านมีรุ่นไหนบ้าง → บอกรุ่นที่มีเรทให้ผ่อน (ตาราง/ผลเครื่องมือ) ไม่ใช่รายการของในสต๊อก',
].join('\n');

@Injectable()
export class BotRuntimeConfigService {
  private readonly logger = new Logger(BotRuntimeConfigService.name);
  private cache: { stockMode: StockMode; rateCards: RateCardsConfig; readAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async getStockMode(): Promise<StockMode> {
    return (await this.load()).stockMode;
  }

  async getRateCards(): Promise<RateCardsConfig> {
    return (await this.load()).rateCards;
  }

  private async load(): Promise<{ stockMode: StockMode; rateCards: RateCardsConfig }> {
    const now = Date.now();
    if (this.cache && now - this.cache.readAt < CACHE_TTL_MS) return this.cache;
    let stockMode: StockMode = 'LIVE';
    let rateCards: RateCardsConfig = {};
    try {
      const rows = await this.prisma.systemConfig.findMany({
        where: { key: { in: [STOCK_MODE_CONFIG_KEY, RATE_CARDS_CONFIG_KEY] }, deletedAt: null },
        select: { key: true, value: true },
      });
      for (const r of rows) {
        if (r.key === STOCK_MODE_CONFIG_KEY) {
          stockMode = r.value?.trim().toUpperCase() === 'NO_STOCK' ? 'NO_STOCK' : 'LIVE';
        } else if (r.key === RATE_CARDS_CONFIG_KEY) {
          rateCards = parseRateCards(r.value);
        }
      }
    } catch (err) {
      // อ่านค่าไม่ได้ = โหมดปกติ + ไม่มีรูปตาราง (บอทยังตอบข้อความได้) — ไม่ cache ค่าผิด
      this.logger.warn(`[BotRuntimeConfig] read failed: ${err instanceof Error ? err.message : err}`);
      return { stockMode, rateCards };
    }
    this.cache = { stockMode, rateCards, readAt: now };
    return this.cache;
  }
}

/** JSON พัง/รูปแบบผิด = ว่าง (ไม่ throw — รูปตารางเป็นของเสริม ห้ามล้มทั้งเทิร์น) */
export function parseRateCards(raw: string | null | undefined): RateCardsConfig {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: RateCardsConfig = {};
  for (const [key, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const e = v as Record<string, unknown>;
    const label = typeof e.label === 'string' ? e.label.trim() : '';
    const storageKey = typeof e.storageKey === 'string' ? e.storageKey.trim() : '';
    const url = typeof e.url === 'string' ? e.url.trim() : '';
    if (!label || (!storageKey && !url)) continue;
    out[key] = { label, ...(storageKey ? { storageKey } : {}), ...(url ? { url } : {}) };
  }
  return out;
}
