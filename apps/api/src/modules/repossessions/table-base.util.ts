import { Logger } from '@nestjs/common';
import { TradeInValuationService } from '../trade-in/services/trade-in-valuation.service';

/** ราคากลางแนะนำจากตารางรับซื้อมือสอง สำหรับเกรดที่เลือก (ใช้ทั้งหน้ายึดและใบรับเครื่องคืน) */
export interface TableBaseHint {
  grade: string;
  found: boolean;
  suggestedPrice: number | null;
  note: string | null;
}

const logger = new Logger('lookupTableBase');

/**
 * ราคาตารางรับซื้อของเครื่องนี้ที่เกรดที่เลือก (null = ไม่มี brand/model / ค้นไม่ได้).
 * อ่านอย่างเดียว ล้มเหลวต้องไม่ล้มการยึด/รับคืน — ตารางเป็นตัวช่วย ไม่ใช่ด่านบังคับ
 * (ด่าน ±15% ของผู้เรียกทำงานเฉพาะเมื่อ `found && suggestedPrice > 0`).
 * ย้ายออกจาก RepossessionsService (2026-09-20) ให้ DeviceReturnsService ใช้ร่วมได้.
 */
export async function lookupTableBase(
  valuationService: TradeInValuationService,
  product: { brand: string; model: string; storage?: string | null },
  grade: string,
): Promise<TableBaseHint | null> {
  if (!product.brand || !product.model) return null;
  try {
    const v = await valuationService.lookupValuation(
      product.brand,
      product.model,
      product.storage ?? '',
      grade,
    );
    return { grade, found: v.found, suggestedPrice: v.suggestedPrice, note: v.note };
  } catch (err) {
    logger.warn(
      `valuation lookup failed (${product.brand} ${product.model} ${grade}): ${
        err instanceof Error ? err.message : err
      }`,
    );
    return null;
  }
}
