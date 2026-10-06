import type { InboundAttribution } from '../interfaces/channel-adapter.interface';

/**
 * ค่า Meta `referral.source` ของโฆษณาจริง (click-to-Messenger) — buildFbAttribution
 * (chat-adapters/facebook-webhook.controller.ts) คัดลอก referral.source มาไว้ที่ `referrerUrl`
 * ค่าอื่นที่เจอจริง: 'SHORTLINK' = ลิงก์ m.me ของหน้าสินค้าบนเว็บร้าน (ไม่ใช่โฆษณา)
 * 🚨 customer-journey/sql/journey-state.sql (CTE earliest_room) ใช้ literal เดียวกัน — แก้ต้องแก้คู่
 */
export const AD_REFERRAL_SOURCE = 'ADS';

/**
 * referral นี้นับเป็น "ทักจากโฆษณา" หรือไม่ (เจ้าของเคาะ 2026-09-15 ข้อ 7)
 * เทียบตรงตัวเท่านั้น — ไม่แปลงตัวพิมพ์ ไม่ถอยไปดู adId — ให้ TypeScript กับ SQL ตัดสินตรงกันเสมอ
 */
export function isAdAttribution(
  a: Pick<InboundAttribution, 'referrerUrl'> | null | undefined,
): boolean {
  return a?.referrerUrl === AD_REFERRAL_SOURCE;
}
