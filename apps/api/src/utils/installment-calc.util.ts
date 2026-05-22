import Decimal from 'decimal.js';
import type {
  BcCalcInput,
  BcCalcOutput,
  GfinCalcInput,
  GfinCalcOutput,
  GfinModelMappingRow,
  GfinOverpriceRuleRow,
  ProductForGfin,
} from './installment-calc.types';

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

function round2(d: Decimal): Decimal {
  return d.toDecimalPlaces(2);
}

export function calcBcInstallment(input: BcCalcInput): BcCalcOutput {
  const { installmentPrice, months, downPct, customDownAmount, config } = input;
  const errors: string[] = [];

  // Resolve down
  const resolvedDownPct =
    customDownAmount !== undefined && installmentPrice.gt(0)
      ? customDownAmount.div(installmentPrice)
      : downPct ?? config.minDownPct;

  const downAmount =
    customDownAmount !== undefined
      ? round2(customDownAmount)
      : round2(installmentPrice.mul(resolvedDownPct));

  if (!config.allowedMonths.includes(months)) {
    errors.push(`จำนวนงวด ${months} ไม่อยู่ในตารางอัตราดอกเบี้ย`);
  }
  if (resolvedDownPct.lt(config.minDownPct)) {
    errors.push(`เงินดาวน์ต่ำกว่าขั้นต่ำ ${config.minDownPct.mul(100).toFixed(0)}%`);
  }
  if (downAmount.gte(installmentPrice)) {
    errors.push('เงินดาวน์ต้องน้อยกว่าราคาขาย');
  }

  const ratePct = config.ratePctByMonths.get(months) ?? new Decimal(0);
  const financedAmount = round2(installmentPrice.sub(downAmount));
  const interestAmount = round2(financedAmount.mul(ratePct));
  const commissionAmount = round2(financedAmount.mul(config.commissionPct));
  const subtotal = round2(financedAmount.add(interestAmount).add(commissionAmount));
  const vatAmount = round2(subtotal.mul(config.vatPct));
  const totalWithVat = round2(subtotal.add(vatAmount));
  const monthlyPayment = months > 0 ? round2(totalWithVat.div(months)) : new Decimal(0);
  const financeToShop = round2(financedAmount.add(commissionAmount));

  return {
    sellingPrice: installmentPrice,
    downPct: resolvedDownPct,
    downAmount,
    financedAmount,
    interestPct: ratePct,
    interestAmount,
    commissionPct: config.commissionPct,
    commissionAmount,
    subtotal,
    vatAmount,
    totalWithVat,
    monthlyPayment,
    financeToShop,
    isValid: errors.length === 0,
    errors,
  };
}

export function calcGfinInstallment(input: GfinCalcInput): GfinCalcOutput {
  const { installmentPrice, months, downPct, mapping, overpriceRule, rateFactor } = input;
  const errors: string[] = [];

  const allowance = overpriceRule?.allowance ?? new Decimal(0);
  const gfinSubmitPrice = round2(mapping.maxPrice.add(allowance));
  const downDiscount = round2(Decimal.max(gfinSubmitPrice.sub(installmentPrice), 0));

  const resolvedDownPct = downPct ?? new Decimal('0.30');
  const downAmountByFormula = round2(gfinSubmitPrice.mul(resolvedDownPct));
  const downAmountActual = round2(Decimal.max(downAmountByFormula.sub(downDiscount), 0));
  const financedAmount = round2(gfinSubmitPrice.sub(downAmountByFormula));

  if (rateFactor.months !== months) {
    errors.push(`ตารางอัตราสำหรับ ${months} งวด ไม่ตรงกับ rate factor ที่ส่งเข้ามา`);
  }
  if (!rateFactor.isActive) {
    errors.push('อัตราดอกเบี้ย GFIN ปิดใช้งาน');
  }

  const interestPart = round2(rateFactor.factor.mul(financedAmount));
  const monthlyPayment = round2(interestPart.add(rateFactor.feePerInstallment));
  const totalPayback = months > 0 ? round2(monthlyPayment.mul(months)) : new Decimal(0);

  return {
    gfinSubmitPrice,
    downDiscount,
    downPct: resolvedDownPct,
    downAmountByFormula,
    downAmountActual,
    financedAmount,
    monthlyPayment,
    totalPayback,
    feePerInstallment: rateFactor.feePerInstallment,
    isValid: errors.length === 0,
    errors,
  };
}

export function findGfinMapping(
  product: ProductForGfin,
  mappings: GfinModelMappingRow[],
): GfinModelMappingRow | null {
  const normStorage = product.storage.replace(/\s+/g, '').toUpperCase();
  const condition = product.category === 'PHONE_NEW' ? 'HAND_1' : 'HAND_2';
  const modelLower = product.model.toLowerCase();

  // Sort by pattern length descending so more-specific patterns (e.g. "iPhone 14 Pro Max")
  // are checked before shorter ones (e.g. "iPhone 14 Pro") — prevents false substring matches.
  const sorted = [...mappings].sort((a, b) => b.modelMatchPattern.length - a.modelMatchPattern.length);

  for (const m of sorted) {
    if (!m.isActive) continue;
    if (m.condition !== condition) continue;
    if (m.storage.replace(/\s+/g, '').toUpperCase() !== normStorage) continue;
    const patternLower = m.modelMatchPattern.toLowerCase();
    // Match whole-pattern: after the match position, ensure no additional word characters follow.
    const idx = modelLower.indexOf(patternLower);
    if (idx === -1) continue;
    const after = modelLower[idx + patternLower.length];
    if (after !== undefined && /\w/.test(after)) continue;
    return m;
  }
  return null;
}

export function findGfinOverpriceRule(
  mapping: GfinModelMappingRow,
  rules: GfinOverpriceRuleRow[],
): GfinOverpriceRuleRow | null {
  for (const rule of rules) {
    if (!rule.isActive) continue;
    if (rule.condition !== mapping.condition) continue;
    const seriesList = rule.seriesPattern.split('|').map(s => s.trim());
    if (!seriesList.includes(mapping.gfinSeries)) continue;
    return rule;
  }
  return null;
}
