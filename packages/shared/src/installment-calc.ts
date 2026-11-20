import Decimal from 'decimal.js';
import { downFromPct, roundUpToStep } from './installment-rounding';
import type {
  BcCalcInput,
  BcCalcOutput,
  GfinCalcInput,
  GfinCalcOutput,
  GfinModelMappingRow,
  GfinOverpriceRuleRow,
  GfinRateFactorRow,
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

  // ดาวน์ที่คิดจาก % ปัดขึ้นหลักร้อย (คำตัดสินเจ้าของ 2026-11-19) · ดาวน์ที่ส่งเป็นจำนวนเงินไม่ถูกปัด
  const downAmount =
    customDownAmount !== undefined
      ? round2(customDownAmount)
      : downFromPct(installmentPrice, resolvedDownPct);

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
  // Match CPA installment accrual: round the pre-VAT and VAT portions separately.
  const monthlyPayment = months > 0
    ? subtotal.div(months).toDecimalPlaces(2, Decimal.ROUND_DOWN).plus(round2(vatAmount.div(months)))
    : new Decimal(0);
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

/**
 * สูตร GFIN ตามหน้า "คำนวณสินเชื่อ" / "ขอสินเชื่อ" ของ GFIN (อ่านจากโค้ดหน้าเว็บ + ภาพจริง 2026-09-11):
 * - ยอดจัดหลังหักดาวน์ = ราคาส่ง − เงินดาวน์
 * - รวมเงินผ่อนต่องวด = Math.ceil(ยอดจัด × เรท) + ค่าล็อกเครื่อง (feePerInstallment, 100)
 * - ค่าคอมมิชชั่นสุทธิ = ยอดจัด × %คอม · ยอดโอนให้ร้าน = ยอดจัด + คอม − ค่าทำสัญญา (100)
 * - เรทขึ้นกับ (จำนวนงวด, %คอมที่ร้านเลือก) — ผู้เรียกต้องเลือก rateFactor ด้วย findGfinRateFactor
 *
 * กติกาของร้าน (เจ้าของยืนยัน 2026-09-11): ส่งที่ราคาส่งสูงสุด (ราคากลาง + OVER) เสมอ แล้วเอา
 * ส่วนต่างระหว่างราคาส่งสูงสุดกับราคาผ่อนที่ต้องการมาลดดาวน์ให้ลูกค้า (downDiscount → downAmountActual)
 */
export function calcGfinInstallment(input: GfinCalcInput): GfinCalcOutput {
  const { installmentPrice, months, downPct, mapping, overpriceRule, rateFactor } = input;
  const errors: string[] = [];
  const contractFee = input.contractFee ?? new Decimal(100);
  const shopCommissionPct = input.shopCommissionPct ?? new Decimal(rateFactor.shopCommissionPct);

  const allowanceFull = overpriceRule?.allowance ?? new Decimal(0);
  const allowanceFactor = gfinAllowanceFactor(input.deviceOrigin);
  const allowanceApplied = round2(allowanceFull.mul(allowanceFactor));
  const gfinSubmitPrice = round2(mapping.maxPrice.add(allowanceApplied));
  const priceAboveSubmit = installmentPrice.gt(gfinSubmitPrice);
  const downDiscount = round2(Decimal.max(gfinSubmitPrice.sub(installmentPrice), 0));

  // default เดิม 30% คงไว้เพื่อผู้เรียกเก่า — หน้าเว็บ/preview ส่งค่าจากตั้งค่า GFIN (gfin.minDownPct) เข้ามาเอง
  const resolvedDownPct = downPct ?? new Decimal('0.30');
  const downAmountByFormula = round2(gfinSubmitPrice.mul(resolvedDownPct));
  // ดาวน์ลูกค้าปัดขึ้นหลักร้อย (คำตัดสินเจ้าของ 2026-11-19 · สเปค price-master-retire 4.3)
  // ยอดจัดยังคิดจากดาวน์ตามสูตรที่แจ้ง GFIN (ไม่ปัด) — การปัดเปลี่ยนแค่เงินที่ร้านเก็บจากลูกค้า
  const downAmountActual = roundUpToStep(Decimal.max(downAmountByFormula.sub(downDiscount), 0));
  const financedAmount = round2(gfinSubmitPrice.sub(downAmountByFormula));

  if (rateFactor.months !== months) {
    errors.push(`ตารางอัตราสำหรับ ${months} งวด ไม่ตรงกับ rate factor ที่ส่งเข้ามา`);
  }
  if (!new Decimal(rateFactor.shopCommissionPct).eq(shopCommissionPct)) {
    errors.push(
      `เรทที่ส่งเข้ามาเป็นของคอมมิชชั่น ${rateFactor.shopCommissionPct}% ไม่ใช่ ${shopCommissionPct.toString()}%`,
    );
  }
  if (!rateFactor.isActive) {
    errors.push('อัตราดอกเบี้ย GFIN ปิดใช้งาน');
  }

  // GFIN portal: monthly = Math.ceil(financed × rate) + deviceLockFee (ปัดขึ้นเป็นบาททั้งจำนวน)
  const interestPart = rateFactor.factor.mul(financedAmount).ceil();
  const monthlyPayment = round2(interestPart.add(rateFactor.feePerInstallment));
  const totalPayback = months > 0 ? round2(monthlyPayment.mul(months)) : new Decimal(0);

  const shopCommissionAmount = round2(financedAmount.mul(shopCommissionPct).div(100));
  const netTransferToShop = round2(financedAmount.add(shopCommissionAmount).sub(contractFee));
  const shopTotalReceived = round2(downAmountActual.add(netTransferToShop));

  return {
    allowanceFull,
    allowanceFactor,
    allowanceApplied,
    gfinSubmitPrice,
    downDiscount,
    downPct: resolvedDownPct,
    downAmountByFormula,
    downAmountActual,
    financedAmount,
    monthlyPayment,
    totalPayback,
    feePerInstallment: rateFactor.feePerInstallment,
    shopCommissionPct,
    shopCommissionAmount,
    contractFee,
    netTransferToShop,
    shopTotalReceived,
    priceAboveSubmit,
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * สัดส่วน OVER ตามที่มาเครื่อง: เครื่องไทยได้เต็ม · เครื่องนอกได้ครึ่งเดียว (เจ้าของยืนยัน 2026-09-26
 * ตรวจกับค่างวดที่พนักงานและตารางโปรใช้จริงครบ 21 ตัวเลข) · ยังไม่ระบุ (null) คิดแบบเครื่องนอก
 * · ไม่ส่งมา (undefined) = เต็มตามพฤติกรรมเดิม
 */
export function gfinAllowanceFactor(deviceOrigin: 'THAI' | 'IMPORTED' | null | undefined): Decimal {
  if (deviceOrigin === undefined || deviceOrigin === 'THAI') return new Decimal(1);
  return new Decimal('0.5');
}

/**
 * ดาวน์ขั้นต่ำ GFIN เป็นสัดส่วน (0.30) — กติกา OVER ก่อน ไม่มีแล้วใช้ค่าตั้ง (settingMinDownPct เป็นสัดส่วน เช่น 0.25)
 * ใช้ตั้ง 30% ให้ iPhone 17 / 18 / Air ตามชีต MASTER (สเปค 3.3) · 0 = ตั้งเป็น 0% จริง ไม่ถอยไปค่าตั้ง
 */
export function resolveGfinDownPct(rule: GfinOverpriceRuleRow | null, settingMinDownPct: Decimal): Decimal {
  if (rule?.minDownPct != null) return new Decimal(rule.minDownPct).div(100);
  return settingMinDownPct;
}

/** เรทของ GFIN ต่อคู่ (จำนวนงวด, %คอมมิชชั่น) — เฉพาะแถวที่เปิดใช้งาน */
export function findGfinRateFactor(
  factors: GfinRateFactorRow[],
  months: number,
  commissionPct: number,
): GfinRateFactorRow | null {
  return (
    factors.find(
      (f) => f.isActive && f.months === months && f.shopCommissionPct === commissionPct,
    ) ?? null
  );
}

export function findGfinMapping(
  product: ProductForGfin,
  mappings: GfinModelMappingRow[],
): GfinModelMappingRow | null {
  const normStorage = product.storage.replace(/\s+/g, '').toUpperCase();
  // มือสองเท่านั้นที่เป็น HAND_2 — เครื่องใหม่และ iPad (TABLET) ถือเป็นมือ 1
  const condition = product.category === 'PHONE_USED' ? 'HAND_2' : 'HAND_1';
  const modelLower = product.model.toLowerCase();
  const modelName = modelLower.trim();
  const isExactName = (m: GfinModelMappingRow) => m.modelMatchPattern.trim().toLowerCase() === modelName;

  // สเปค price-master-retire 4.3: ชื่อรุ่นตรงกับคำจับคู่ของแถวที่เปิดใช้แถวใดก็ตาม (ไม่ดูสภาพ/ความจุ)
  // = ใบราคามีรุ่นนี้ → ใช้ได้เฉพาะแถวที่ตรงชื่อทั้งคำ · ไม่มีแถวของสภาพ + ความจุนั้น = GFIN ไม่รับ
  // (เดิม iPhone 13 Pro มือ 1 ได้ราคาของ iPhone 13 มือ 1 เพราะ "iPhone 13 Pro" มีคำว่า "iPhone 13")
  const exactOnly = modelName !== '' && mappings.some((m) => m.isActive && isExactName(m));

  // Sort by pattern length descending so more-specific patterns (e.g. "iPhone 14 Pro Max")
  // are checked before shorter ones (e.g. "iPhone 14 Pro") — prevents false substring matches.
  const sorted = [...mappings].sort((a, b) => b.modelMatchPattern.length - a.modelMatchPattern.length);

  for (const m of sorted) {
    if (!m.isActive) continue;
    if (m.condition !== condition) continue;
    if (m.storage.replace(/\s+/g, '').toUpperCase() !== normStorage) continue;
    if (exactOnly) {
      if (isExactName(m)) return m;
      continue;
    }
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
  // หลายกฎครอบซีรีส์เดียวกันได้ (เช่นแยก "iPhone 15 Pro Max" ออกมาเป็นกฎของตัวเอง แต่ยังไม่ได้ลบจากกฎรวม)
  // → เลือกกฎที่ระบุซีรีส์น้อยที่สุด (เจาะจงที่สุด) แทนการหยิบตัวแรกตามลำดับแถวจากฐาน ซึ่งไม่แน่นอน
  let best: GfinOverpriceRuleRow | null = null;
  let bestSize = Number.POSITIVE_INFINITY;
  for (const rule of rules) {
    if (!rule.isActive) continue;
    if (rule.condition !== mapping.condition) continue;
    const seriesList = rule.seriesPattern.split('|').map(s => s.trim());
    if (!seriesList.includes(mapping.gfinSeries)) continue;
    if (seriesList.length < bestSize) {
      best = rule;
      bestSize = seriesList.length;
    }
  }
  return best;
}
