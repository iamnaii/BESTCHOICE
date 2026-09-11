import Decimal from 'decimal.js';
import { calcBcInstallment, type BcCalcOutput, type BcConfig, type BcConfigJson } from '@installment/shared';
import type { MonthOption } from './monthsOptions';

export interface BcQuote {
  result: BcCalcOutput;
  /** ตัวเลือกงวดทั้งหมด (allowedMonths เรียงจากน้อยไปมาก) พร้อมค่างวดจากดาวน์ที่กรอกอยู่ */
  monthsOptions: MonthOption[];
  /** ดาวน์ขั้นต่ำ = ราคาผ่อน × minDownPct ปัดเป็นบาท (ค่าตั้งต้นของช่องเงินดาวน์) */
  minDownAmount: number;
}

export function toBcConfig(json: BcConfigJson): BcConfig {
  return {
    minDownPct: new Decimal(json.minDownPct),
    commissionPct: new Decimal(json.commissionPct),
    vatPct: new Decimal(json.vatPct),
    ratePctByMonths: new Map(
      Object.entries(json.ratePctByMonths).map(([k, v]) => [Number(k), new Decimal(v)]),
    ),
    allowedMonths: json.allowedMonths,
  };
}

export function bcMinDownAmount(json: BcConfigJson, installmentPrice: number): number {
  return Math.round(installmentPrice * json.minDownPct);
}

/**
 * ค่างวด BESTCHOICE ตามค่าที่เลือก (งวด · เงินดาวน์) + ตัวเลือกงวดพร้อมค่างวด
 * สูตรเดียวกับสัญญาจริง (calcBcInstallment) — ค่าเริ่มต้น 12 งวด/ดาวน์ขั้นต่ำ ตรงกับ computeDefaultBcInstallment
 */
export function buildBcQuote(
  json: BcConfigJson,
  installmentPrice: number,
  months: number,
  downAmount: number,
): BcQuote {
  const config = toBcConfig(json);
  const price = new Decimal(installmentPrice);
  const down = new Decimal(downAmount);
  const quoteFor = (m: number) =>
    calcBcInstallment({ installmentPrice: price, months: m, customDownAmount: down, config });
  const monthsOptions: MonthOption[] = [...json.allowedMonths]
    .sort((a, b) => a - b)
    .map((m) => ({ months: m, monthly: quoteFor(m).monthlyPayment.toNumber() }));
  return {
    result: quoteFor(months),
    monthsOptions,
    minDownAmount: bcMinDownAmount(json, installmentPrice),
  };
}
