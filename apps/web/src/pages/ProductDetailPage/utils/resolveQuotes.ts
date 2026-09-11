import type { BcConfigJson } from '@installment/shared';
import { getPositiveDisplayPrices, type ProductForDisplay } from '@/utils/getDisplayPrices';
import type { CalcState } from '../hooks/useInstallmentCalcState';
import { bcMinDownAmount, buildBcQuote, type BcQuote } from './bcQuote';
import { buildGfinQuote, defaultCommissionPct, type GfinQuote, type GfinTables } from './gfinQuote';
import { pickDefaultMonths } from './monthsOptions';

export interface ProductForQuotes extends ProductForDisplay {
  category: string;
  brand: string;
  model: string;
  storage: string | null;
}

export interface ResolvedBc {
  months: number;
  downAmount: number;
  minDownAmount: number;
  quote: BcQuote;
}

export interface ResolvedGfin {
  /** null = ไม่มีงวดให้เลือกเลย (ตารางเรทว่าง) */
  months: number | null;
  downPct: number;
  commissionPct: number;
  quote: GfinQuote;
}

export interface ResolvedQuotes {
  /** ราคาผ่อนที่ใช้คิด — ผ่าน getPositiveDisplayPrices เสมอ (null = ยังไม่ตั้งราคาผ่อน) */
  installmentPrice: number | null;
  bc: ResolvedBc | null;
  gfin: ResolvedGfin | null;
  gfinAvailable: boolean;
}

/**
 * ค่าที่เครื่องคำนวณ "ใช้จริง" จาก state + ค่าตั้งต้น — ใช้ร่วมกันระหว่างการ์ดคำนวณและสรุปส่งลูกค้า
 * เพื่อให้ตัวเลขที่พนักงานเห็นกับที่คัดลอกไปเป็นชุดเดียวกัน
 * ค่าตั้งต้น: BESTCHOICE 12 งวด (หรืองวดใกล้ 12 ที่สุดที่เปิด) + ดาวน์ขั้นต่ำ · GFIN 12 งวด (ไม่เกินเพดานของรุ่น)
 * + ดาวน์ขั้นต่ำที่ GFIN ตั้งให้ร้าน + คอมตามหมวด (มือถือ 15 · iPad 5)
 */
export function resolveQuotes({
  product,
  state,
  bcConfig,
  gfinTables,
}: {
  product: ProductForQuotes;
  state: CalcState;
  bcConfig?: BcConfigJson;
  gfinTables?: GfinTables;
}): ResolvedQuotes {
  const { installment } = getPositiveDisplayPrices(product);
  const installmentPrice = installment ?? null;
  if (installmentPrice == null) {
    return { installmentPrice: null, bc: null, gfin: null, gfinAvailable: false };
  }

  let bc: ResolvedBc | null = null;
  if (bcConfig && bcConfig.allowedMonths && bcConfig.allowedMonths.length > 0) {
    const months =
      state.bc.months != null && bcConfig.allowedMonths.includes(state.bc.months)
        ? state.bc.months
        : (pickDefaultMonths(bcConfig.allowedMonths) as number);
    const minDownAmount = bcMinDownAmount(bcConfig, installmentPrice);
    const downAmount = state.bc.downAmount ?? minDownAmount;
    bc = {
      months,
      downAmount,
      minDownAmount,
      quote: buildBcQuote(bcConfig, installmentPrice, months, downAmount),
    };
  }

  let gfin: ResolvedGfin | null = null;
  let gfinAvailable = false;
  if (gfinTables) {
    const commissionPct =
      state.gfin.commissionPct ?? defaultCommissionPct(gfinTables.settings, product.category);
    const downPct = state.gfin.downPct ?? gfinTables.settings.minDownPct;
    const preferred = state.gfin.months ?? 12;
    const productForGfin = {
      brand: product.brand,
      model: product.model,
      storage: product.storage,
      category: product.category,
    };
    let months: number | null = preferred;
    let quote = buildGfinQuote(gfinTables, {
      product: productForGfin,
      installmentPrice,
      months: preferred,
      downPct,
      commissionPct,
    });
    // งวดที่เลือก/ตั้งต้นไม่มีเรทหรือเกินเพดานของรุ่น → ถอยไปงวดใกล้ 12 ที่สุดในตัวเลือกที่มี
    if (!quote.available && quote.reason === 'no_factor') {
      months = pickDefaultMonths(
        quote.monthsOptions.map((o) => o.months),
        preferred,
      );
      if (months != null) {
        quote = buildGfinQuote(gfinTables, {
          product: productForGfin,
          installmentPrice,
          months,
          downPct,
          commissionPct,
        });
      }
    }
    gfin = { months: quote.available ? months : null, downPct, commissionPct, quote };
    gfinAvailable = quote.available;
  }

  return { installmentPrice, bc, gfin, gfinAvailable };
}
