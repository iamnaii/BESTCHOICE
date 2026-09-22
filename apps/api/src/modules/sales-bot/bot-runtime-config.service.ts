import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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
  'ร้านมีเครื่องจริงที่หน้าร้านตามปกติ แต่ระบบยังไม่มีรายการเครื่อง — โหมดนี้ไม่มี search_products และ calculate_installment',
  '- ห้ามพูดว่า "หมด" "ของหมดชั่วคราว" "ไม่มีของ" "ของกำลังเข้ามา" "จองไว้ก่อน" "ของเข้าแล้วแจ้ง" "พร้อมส่ง" และห้ามรับปากว่ามีสี/ความจุ/สภาพไหนแน่นอน',
  '- ขั้น 1-3 ถามรุ่นย่อย / ความจุ / มือ 1-มือสอง ตามลำดับเดิม โดยใช้ get_installment_rates (ตัวเลือกความจุจากตาราง) และรายการมือ 1 — ไม่ต้องค้นสต๊อก',
  '- ขั้น 4 ผ่อน = ใช้รูปแบบ 4B แต่ตัดก้อนสถานะของทิ้ง เริ่มที่ก้อนเรทเลย · ปิดท้ายด้วยคำถามเลือกเรท (ห้ามปิดด้วย "ของเข้าแล้วแจ้ง") · ไม่มีจังหวะเสนอเชิงรุก',
  '- โปรฟรีดาวน์เครื่องนอก: ค่างวดจาก search_knowledge_base ตามทางเครื่องนอกเดิม',
  '- ซื้อสด: "ราคาเงินสดขอทีมเช็คแล้วแจ้งกลับนะคะ" แล้วเรียก notify_staff (reason = รุ่น + ขอราคาเงินสด)',
  '- ลูกค้าถาม สี / แบต / สภาพ / ตำหนิ / ขอดูรูปเครื่องจริง / "มีของไหม" → ตอบ 2 บรรทัด "ได้เลยค่ะ" / "เดี๋ยวแอดมินส่งรูปเครื่องจริงให้ดูนะคะ" แล้วเรียก notify_staff ในเทิร์นเดียวกัน (reason = รุ่นที่สนใจ + สิ่งที่ลูกค้าขอ) — เทิร์นนั้นไม่ต้องมีคำถามปิด',
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
