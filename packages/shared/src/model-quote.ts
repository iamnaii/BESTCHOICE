import Decimal from 'decimal.js';
import {
  calcBcInstallment,
  calcGfinInstallment,
  findGfinMapping,
  findGfinOverpriceRule,
  findGfinRateFactor,
  resolveGfinDownPct,
} from './installment-calc';
import { displayInstallment } from './installment-rounding';
import type {
  BcConfig,
  GfinDeviceOrigin,
  GfinModelMappingRow,
  GfinOverpriceRuleRow,
  GfinRateFactorRow,
  ProductForGfin,
} from './installment-calc.types';

/** ตาราง GFIN ที่ใช้คิดเรท 2 — ผู้เรียกโหลดครั้งเดียวต่อคำขอแล้วใช้กับทุกรุ่น */
export interface ModelQuoteGfinContext {
  mappings: GfinModelMappingRow[];
  rules: GfinOverpriceRuleRow[];
  rateFactors: GfinRateFactorRow[];
  /** ค่าตั้ง gfin.minDownPct เป็นสัดส่วน เช่น 0.25 */
  settingMinDownPct: Decimal;
  /** % คอมที่ร้านเลือก เช่น 15 (มือถือ) / 5 (iPad) */
  commissionPct: number;
  /** ค่าทำสัญญาที่ GFIN หัก เช่น 100 */
  contractFee: Decimal;
}

export interface ModelQuoteInput {
  product: ProductForGfin;
  /** null = ยังไม่รู้ไทย/นอก → OVER ครึ่ง */
  deviceOrigin: GfinDeviceOrigin | null;
  cashPrice: number | null;
  /** ราคาผ่อน BESTCHOICE (ราคาเต็ม) */
  bcPrice: number | null;
  /** ราคาขาย GFIN (ราคาเต็ม) · null → ใช้ bcPrice */
  financePrice: number | null;
  rate1TermMonths?: number | null;
  /** ดาวน์เรท 1 ที่กำหนดเป็นจำนวนเงิน — ไม่ปัด */
  rate1DownPayment?: number | null;
  rate2TermMonths?: number | null;
  /** null → เรท 1 = null */
  bcConfig: BcConfig | null;
  /** null → เรท 2 ใช้ไม่ได้ 'NO_CONFIG' */
  gfin: ModelQuoteGfinContext | null;
  /** มีค่า = เติมกำไร · ไม่มี = กำไรเป็น null (ผู้ไม่เห็นทุน) */
  costPrice?: number | null;
}

export interface CashQuote {
  price: number;
  profit: number | null;
}

export interface Rate1Quote {
  price: number;
  downAmount: number;
  months: number;
  /** ค่างวดในสัญญา (สตางค์) จาก calcBcInstallment */
  monthlyContract: number;
  /** displayInstallment(monthlyContract) */
  monthlyDisplay: number;
  /** ราคา 2 = ปัดลง(ดาวน์ + ยอดจัด × (1 + ค่าคอม)) */
  recordedSalePrice: number;
  profit: number | null;
  /** งวดที่ตั้งค่าดอกเบี้ยมีอัตรา (เพิ่มจากสัญญากลาง — บอทบอกลูกค้าเมื่อขอจำนวนงวดที่ทำไม่ได้) */
  allowedMonths: number[];
}

export type Rate2Quote =
  | {
      available: true;
      salePrice: number;
      submitPrice: number;
      downAmount: number;
      months: number;
      monthly: number;
      /** ราคา 3 = ปัดลง(ยอดจัด × (1 + คอม %) − ค่าทำสัญญา + ดาวน์ลูกค้า) */
      recordedSalePrice: number;
      profit: number | null;
      /** true เมื่อไม่รู้ไทย/นอก (คิด OVER ครึ่งไว้ก่อน) */
      originNote: boolean;
    }
  | { available: false; reason: 'NO_PRICE_LIST' | 'NO_RULE' | 'NO_RATE' | 'NO_PRICE' | 'NO_CONFIG'; message: string };

export interface ModelQuote {
  cash: CashQuote | null;
  rate1: Rate1Quote | null;
  rate2: Rate2Quote;
}

function positive(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

function profitOf(price: number, cost: number | null | undefined): number | null {
  return cost != null && Number.isFinite(cost) ? price - cost : null;
}

/** งวดเรท 1: งวดของรุ่นถ้าตั้งค่าดอกเบี้ยมีอัตรา · ไม่งั้น 12 ถ้ามี · ไม่งั้นงวดแรกที่มี (สเปคข้อ 4.2) */
function pickRate1Months(allowedMonths: number[], wanted: number | null | undefined): number | null {
  if (allowedMonths.length === 0) return null;
  if (wanted != null && allowedMonths.includes(wanted)) return wanted;
  return allowedMonths.includes(12) ? 12 : allowedMonths[0];
}

function buildRate1(input: ModelQuoteInput): Rate1Quote | null {
  const price = positive(input.bcPrice);
  const config = input.bcConfig;
  if (price === null || !config) return null;
  const months = pickRate1Months(config.allowedMonths, input.rate1TermMonths);
  if (months === null) return null;
  const fixedDown = positive(input.rate1DownPayment);
  const out = calcBcInstallment({
    installmentPrice: new Decimal(price),
    months,
    // ดาวน์กำหนดเองเป็นจำนวนเงิน (ไม่ปัด) · ไม่มี = ขั้นต่ำจาก % ที่ calcBcInstallment ปัดขึ้นหลักร้อยให้
    customDownAmount: fixedDown !== null ? new Decimal(fixedDown) : undefined,
    config,
  });
  if (!out.isValid) return null;
  const recordedSalePrice = out.downAmount.add(out.financeToShop).floor().toNumber();
  return {
    price,
    downAmount: out.downAmount.toNumber(),
    months,
    monthlyContract: out.monthlyPayment.toNumber(),
    monthlyDisplay: displayInstallment(out.monthlyPayment),
    recordedSalePrice,
    profit: profitOf(recordedSalePrice, input.costPrice),
    allowedMonths: [...config.allowedMonths],
  };
}

function unavailable(
  reason: 'NO_PRICE_LIST' | 'NO_RULE' | 'NO_RATE' | 'NO_PRICE' | 'NO_CONFIG',
  message: string,
): Rate2Quote {
  return { available: false, reason, message };
}

function buildRate2(input: ModelQuoteInput): Rate2Quote {
  const g = input.gfin;
  if (!g) return unavailable('NO_CONFIG', 'ยังไม่ได้ตั้งค่า GFIN');
  const salePrice = positive(input.financePrice) ?? positive(input.bcPrice);
  if (salePrice === null) return unavailable('NO_PRICE', 'ยังไม่มีราคาขาย GFIN ของรุ่นนี้');
  const mapping = findGfinMapping(input.product, g.mappings);
  if (!mapping) return unavailable('NO_PRICE_LIST', 'GFIN ไม่รับรุ่นนี้');
  const rule = findGfinOverpriceRule(mapping, g.rules);
  // สเปก 2026-11-20 §4: มีราคาแต่ไม่มีเงื่อนไขของรุ่น = ยังคิดไม่ได้ (เดิมคิดแบบไม่จำกัดงวด + OVER 0)
  if (!rule) return unavailable('NO_RULE', 'ยังไม่ได้ตั้งเงื่อนไข GFIN ของรุ่นนี้');
  // งวดกำหนดเองของรุ่น · ไม่มี = งวดสูงสุดของกติกา OVER · กติกาไม่จำกัดงวด = 12
  const months = positive(input.rate2TermMonths) ?? rule.maxMonths ?? 12;
  const rateFactor = findGfinRateFactor(g.rateFactors, months, g.commissionPct);
  if (!rateFactor) return unavailable('NO_RATE', `ยังไม่มีเรท GFIN ${months} งวด`);
  const out = calcGfinInstallment({
    installmentPrice: new Decimal(salePrice),
    product: input.product,
    months,
    downPct: resolveGfinDownPct(rule, g.settingMinDownPct),
    shopCommissionPct: new Decimal(g.commissionPct),
    contractFee: g.contractFee,
    mapping,
    overpriceRule: rule,
    rateFactor,
    deviceOrigin: input.deviceOrigin,
  });
  if (!out.isValid) return unavailable('NO_RATE', out.errors[0] ?? 'คิดเรท GFIN ไม่ได้');
  const recordedSalePrice = out.shopTotalReceived.floor().toNumber();
  return {
    available: true,
    salePrice,
    submitPrice: out.gfinSubmitPrice.toNumber(),
    downAmount: out.downAmountActual.toNumber(),
    months,
    monthly: out.monthlyPayment.toNumber(),
    recordedSalePrice,
    profit: profitOf(recordedSalePrice, input.costPrice),
    originNote: input.deviceOrigin === null,
  };
}

/**
 * ใบเสนอราคาของรุ่นหนึ่ง: เงินสด · เรท 1 (BESTCHOICE) · เรท 2 (GFIN) · กำไร (สเปคข้อ 4.2–4.4)
 * ผู้ใช้: API `PricingQuoteService` (หน้า "ราคาและเรทผ่อน" + บอทขาย) และการ์ดราคาขายในหน้าเพิ่มสินค้า (ช่วง 4)
 */
export function buildModelQuote(input: ModelQuoteInput): ModelQuote {
  const cashPrice = positive(input.cashPrice);
  return {
    cash: cashPrice === null ? null : { price: cashPrice, profit: profitOf(cashPrice, input.costPrice) },
    rate1: buildRate1(input),
    rate2: buildRate2(input),
  };
}
