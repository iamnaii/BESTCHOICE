import Decimal from 'decimal.js';
import type { BcConfig } from './installment-calc.types';

/**
 * B3 §5 — resolve InterestConfig → BcConfig ที่ `calcBcInstallment` กินได้
 *
 * ตรรกะยกมาจาก `modules/shop-catalog/installment-preview.service.ts:61-96`
 * (ต่างจากเดิมจุดเดียว = ใส่ `orderBy: { createdAt: 'asc' }` ให้ deterministic)
 * แล้วให้ผู้อ่านใช้ร่วมกัน:
 *   - InstallmentPreviewService (ตัวเลขบนเว็บลูกค้า)
 *   - CalculateInstallmentTool (ตัวเลขที่บอทตอบในแชท)
 *   - ProductQuoteService ของ B2 (การ์ดสินค้า/ตัวเลือกสินค้าใน inbox — Task 14)
 * และเป็น **resolver ตัวเดียวของ repo**: batch อื่น (B4) ต้อง import ตัวนี้
 * ห้ามสร้าง service ที่ทำงานเดียวกันขึ้นมาใหม่
 *
 * ทำไมค้นด้วย productCategories ไม่ใช่ช่วง tenure: `sale-writer.service.ts:224-226`
 * และ `contract-lifecycle.service.ts:74-80` — โค้ดที่สร้างสัญญาจริง — ค้นแบบนี้
 * การกรอง tenure ไม่ได้หายไป แต่ย้ายไปอยู่ที่ `allowedMonths` ซึ่ง
 * `calcBcInstallment` ตรวจให้เอง (installment-calc.util.ts:33-35)
 */

interface InterestConfigRow {
  minDownPaymentPct: unknown;
  storeCommissionPct: unknown;
  vatPct: unknown;
  interestRate: unknown;
  minInstallmentMonths: number;
  maxInstallmentMonths: number;
  rates: { months: number; ratePct: unknown }[];
}

interface InterestConfigReader {
  interestConfig: { findFirst: (args: unknown) => Promise<unknown> };
}

export interface BcConfigResolution {
  found: boolean;
  config?: BcConfig;
}

export async function resolveBcConfigForCategory(
  prisma: InterestConfigReader,
  category: string,
): Promise<BcConfigResolution> {
  const config = (await prisma.interestConfig.findFirst({
    where: { productCategories: { has: category }, deletedAt: null, isActive: true },
    include: { rates: { where: { deletedAt: null } } },
    // ⚠️ ของเดิมที่ installment-preview.service.ts:61-68 **ไม่มี orderBy** = ถ้ามี
    // config active มากกว่า 1 ตัวต่อหมวด ผลลัพธ์ขึ้นกับลำดับที่ Postgres คืนมา
    // (ค่างวดเปลี่ยนไปมาโดยไม่มีใครแก้อะไร). ปักหมุดเป็น "ตัวเก่าสุดชนะ" ให้ตรงกับ
    // ProductQuoteService ของ B2 (`getQuotes` ใช้ `orderBy: { createdAt: 'asc' }`
    // แล้วเอาตัวแรกต่อหมวด) — ทั้งระบบต้อง resolve ได้ config ตัวเดียวกันเสมอ
    orderBy: { createdAt: 'asc' },
  })) as InterestConfigRow | null;

  if (!config) return { found: false };

  const ratePctByMonths = new Map<number, Decimal>();
  for (const r of config.rates ?? []) {
    ratePctByMonths.set(r.months, new Decimal(String(r.ratePct)));
  }
  // Fallback เมื่อ InterestConfigRate ยังไม่ seed — สังเคราะห์จาก per-month × m
  if (ratePctByMonths.size === 0) {
    const rate = new Decimal(String(config.interestRate));
    for (let m = config.minInstallmentMonths; m <= config.maxInstallmentMonths; m++) {
      ratePctByMonths.set(m, rate.mul(m));
    }
  }
  const allowedMonths = Array.from(ratePctByMonths.keys()).sort((a, b) => a - b);

  return {
    found: true,
    config: {
      minDownPct: new Decimal(String(config.minDownPaymentPct)),
      commissionPct: new Decimal(String(config.storeCommissionPct)),
      vatPct: new Decimal(String(config.vatPct)),
      ratePctByMonths,
      allowedMonths,
    },
  };
}
