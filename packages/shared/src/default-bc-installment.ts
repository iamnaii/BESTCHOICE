import Decimal from 'decimal.js';
import { calcBcInstallment } from './installment-calc';

/** shape ของ GET /interest-configs/resolved?category=... */
export interface BcConfigJson {
  minDownPct: number;
  commissionPct: number;
  vatPct: number;
  ratePctByMonths: Record<number, number>;
  allowedMonths: number[];
}

export interface DefaultInstallment {
  months: number;
  downAmount: number;
  monthlyPayment: number;
}

/**
 * ค่างวด "เริ่มต้น" ของหน้าสินค้า — คำนวณด้วย calcBcInstallment ตรง เพราะ
 * BcCalculatorCard เก็บ state ไว้ภายในและไม่ expose ผลลัพธ์ออกมา (spec §3).
 * ค่า default ต้องตรงกับ BcCalculatorCard.tsx:29-31 เป๊ะ ไม่งั้นข้อความที่
 * คัดลอกจะไม่ตรงกับตัวเลขที่พนักงานเห็นบนจอ.
 */
export function computeDefaultBcInstallment(
  installmentPrice: number | null | undefined,
  config: BcConfigJson | null | undefined,
): DefaultInstallment | null {
  if (installmentPrice == null || !(installmentPrice > 0)) return null;
  if (!config || !config.allowedMonths || config.allowedMonths.length === 0) return null;

  const months = config.allowedMonths.includes(12) ? 12 : config.allowedMonths[0];
  const downAmount = Math.round(installmentPrice * config.minDownPct);

  const result = calcBcInstallment({
    installmentPrice: new Decimal(installmentPrice),
    months,
    customDownAmount: new Decimal(downAmount),
    config: {
      minDownPct: new Decimal(config.minDownPct),
      commissionPct: new Decimal(config.commissionPct),
      vatPct: new Decimal(config.vatPct),
      ratePctByMonths: new Map(
        Object.entries(config.ratePctByMonths).map(([k, v]) => [Number(k), new Decimal(v)]),
      ),
      allowedMonths: config.allowedMonths,
    },
  });

  if (!result.isValid) return null;

  const downAmountNum = result.downAmount.toNumber();
  const monthlyPaymentNum = result.monthlyPayment.toNumber();
  // decimal.js accepts NaN/Infinity as valid Decimal values (no throw) — a corrupt
  // config (e.g. minDownPct/vatPct already NaN upstream) can sail through calcBcInstallment
  // with isValid still true. Treat a non-finite result as invalid so the caller never
  // receives a NaN/Infinity to print into a customer-facing message.
  if (!Number.isFinite(downAmountNum) || !Number.isFinite(monthlyPaymentNum)) return null;

  return {
    months,
    downAmount: downAmountNum,
    monthlyPayment: monthlyPaymentNum,
  };
}
