import type { BcConfigJson, GfinDeviceOrigin } from '@installment/shared';
import { getPositiveDisplayPrices, normalizePositive, type ProductForDisplay } from '@/utils/getDisplayPrices';
import type { CalcState } from '../hooks/useInstallmentCalcState';
import { bcMinDownAmount, buildBcQuote, type BcQuote } from './bcQuote';
import {
  buildGfinQuote,
  defaultCommissionPct,
  gfinMaxMonthsFor,
  gfinMinDownPctFor,
  type GfinQuote,
  type GfinTables,
} from './gfinQuote';
import { pickDefaultMonths } from './monthsOptions';

/**
 * เงื่อนไขผ่อนของราคากลางที่ตรงกับเครื่อง (API: `templateTerms` ของ `GET /products/:id` และข้อมูลสติกเกอร์ — ตัวเลือกแถว
 * เดียวกับตอนสร้างเครื่อง) · Decimal มาเป็น string
 */
export interface TemplateTermsJson {
  /** ราคาผ่อน BESTCHOICE ของราคากลาง — ดาวน์เรท 1 ของราคากลางใช้เฉพาะเมื่อราคาผ่อนของเครื่องเท่านี้ */
  bcPrice: string | number | null;
  rate1TermMonths: number | null;
  rate1DownPayment: string | number | null;
  rate2TermMonths: number | null;
}

export interface ProductForQuotes extends ProductForDisplay {
  category: string;
  brand: string;
  model: string;
  storage: string | null;
  /** ที่มาเครื่อง — มีผลกับ OVER ของ GFIN (ไทยเต็ม · นอก/ยังไม่ระบุครึ่งเดียว) */
  deviceOrigin?: GfinDeviceOrigin | null;
  /** ราคาขาย GFIN ของเครื่อง (ราคาเต็ม — สเปค 2026-11-19 ข้อ 3.2) · ว่าง/ไม่บวก = เรท 2 ใช้ราคาผ่อน BESTCHOICE */
  financePrice?: string | number | null;
  /** เงื่อนไขผ่อนของราคากลาง — ค่าตั้งต้นของงวด/ดาวน์ · ไม่มี = ค่าตั้งต้นทั่วไป */
  templateTerms?: TemplateTermsJson | null;
}

export interface ResolvedBc {
  months: number;
  downAmount: number;
  minDownAmount: number;
  /** % ขั้นต่ำที่ตั้งไว้ (เต็มจำนวน เช่น 15) — ใช้เป็นป้าย ไม่คำนวณย้อนจากยอดที่ปัดขึ้นแล้ว */
  minDownPct: number;
  quote: BcQuote;
}

export interface ResolvedGfin {
  /** null = ไม่มีงวดให้เลือกเลย (ตารางเรทว่าง) */
  months: number | null;
  downPct: number;
  /** ดาวน์ขั้นต่ำของรุ่นนี้ (เต็มร้อย) — กติกา OVER ก่อน ไม่มีแล้วค่าตั้ง GFIN · ตัวเลือก % ในการ์ดเริ่มที่ค่านี้ */
  minDownPct: number;
  commissionPct: number;
  quote: GfinQuote;
}

export interface ResolvedQuotes {
  /** ราคาผ่อนที่ใช้คิด — ผ่าน getPositiveDisplayPrices เสมอ (null = ยังไม่ตั้งราคาผ่อน) */
  installmentPrice: number | null;
  /** ราคาที่เรท 2 ใช้คิด = financePrice ?? ราคาผ่อน (null = ไม่มีทั้งคู่) */
  gfinSalePrice: number | null;
  /** เครื่องนี้ตั้งราคาขาย GFIN (financePrice > 0) เอง — false = gfinSalePrice เป็นแค่ราคาผ่อน BESTCHOICE ที่ใช้แทน */
  hasFinancePrice: boolean;
  bc: ResolvedBc | null;
  gfin: ResolvedGfin | null;
  gfinAvailable: boolean;
}

/**
 * ค่าที่เครื่องคำนวณ "ใช้จริง" จาก state + ค่าตั้งต้น — ใช้ร่วมกันระหว่างการ์ดคำนวณ สติกเกอร์ และสรุปส่งลูกค้า
 * เพื่อให้ตัวเลขที่พนักงานเห็นกับที่คัดลอกไปเป็นชุดเดียวกัน
 * ค่าตั้งต้นชุดเดียวกับ `buildModelQuote` (การ์ดหน้าเพิ่มสินค้า · หน้า "ราคาและเรทผ่อน" · บอท):
 * BESTCHOICE = งวดของราคากลาง (ถ้าตั้งค่าดอกเบี้ยมีอัตรา) ไม่งั้น 12 (หรืองวดใกล้ 12 ที่สุดที่เปิด) + ดาวน์ของราคากลาง
 * (เฉพาะเมื่อราคาผ่อนของเครื่องเท่าราคากลาง) ไม่งั้นดาวน์ขั้นต่ำ · GFIN = งวดของราคากลาง ไม่งั้นงวดสูงสุดของกติกา OVER
 * ไม่งั้น 12 + ดาวน์ขั้นต่ำที่ GFIN ตั้งให้ร้าน + คอมตามหมวด (มือถือ 15 · iPad 5) · ค่าที่ผู้ใช้เลือก (state) ทับได้เสมอ
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
  const financePrice = normalizePositive(product.financePrice);
  const hasFinancePrice = financePrice != null;
  const gfinSalePrice = financePrice ?? installmentPrice;
  if (installmentPrice == null && gfinSalePrice == null) {
    return { installmentPrice: null, gfinSalePrice: null, hasFinancePrice, bc: null, gfin: null, gfinAvailable: false };
  }

  const terms = product.templateTerms ?? null;
  let bc: ResolvedBc | null = null;
  if (installmentPrice != null && bcConfig && bcConfig.allowedMonths && bcConfig.allowedMonths.length > 0) {
    const allowed = bcConfig.allowedMonths;
    const templateMonths = terms?.rate1TermMonths ?? null;
    const months =
      state.bc.months != null && allowed.includes(state.bc.months)
        ? state.bc.months
        : templateMonths != null && allowed.includes(templateMonths)
          ? templateMonths
          : (pickDefaultMonths(allowed) as number);
    const minDownAmount = bcMinDownAmount(bcConfig, installmentPrice);
    // ดาวน์กำหนดเองของราคากลางผูกกับราคาผ่อนของราคากลาง — ราคาผ่อนของเครื่องต่างไป = ดาวน์ขั้นต่ำ (ไม่ปัด — จำนวนเงินที่ตั้งไว้)
    const templateDown =
      terms && normalizePositive(terms.bcPrice) === installmentPrice ? normalizePositive(terms.rate1DownPayment) : null;
    const downAmount = state.bc.downAmount ?? templateDown ?? minDownAmount;
    bc = {
      months,
      downAmount,
      minDownAmount,
      minDownPct: Math.round(bcConfig.minDownPct * 100),
      quote: buildBcQuote(bcConfig, installmentPrice, months, downAmount),
    };
  }

  let gfin: ResolvedGfin | null = null;
  let gfinAvailable = false;
  if (gfinTables && gfinSalePrice != null) {
    const commissionPct =
      state.gfin.commissionPct ?? defaultCommissionPct(gfinTables.settings, product.category);
    const productForGfin = {
      brand: product.brand,
      model: product.model,
      storage: product.storage,
      category: product.category,
      deviceOrigin: product.deviceOrigin,
    };
    // ดาวน์ขั้นต่ำตามกติกา OVER ของรุ่น (ไม่มีแล้วค่าตั้ง GFIN) — ค่าเริ่มของการ์ดและสติกเกอร์
    const minDownPct = gfinMinDownPctFor(gfinTables, productForGfin);
    const downPct = state.gfin.downPct ?? minDownPct;
    const preferred =
      state.gfin.months ?? terms?.rate2TermMonths ?? gfinMaxMonthsFor(gfinTables, productForGfin) ?? 12;
    let months: number | null = preferred;
    let quote = buildGfinQuote(gfinTables, {
      product: productForGfin,
      installmentPrice: gfinSalePrice,
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
          installmentPrice: gfinSalePrice,
          months,
          downPct,
          commissionPct,
        });
      }
    }
    gfin = { months: quote.available ? months : null, downPct, minDownPct, commissionPct, quote };
    gfinAvailable = quote.available;
  }

  return { installmentPrice, gfinSalePrice, hasFinancePrice, bc, gfin, gfinAvailable };
}
