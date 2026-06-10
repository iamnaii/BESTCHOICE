import { BadRequestException } from '@nestjs/common';
import { AssetCategory } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

export const CATEGORY_PREFIX: Record<AssetCategory, string> = {
  EQUIPMENT: 'EQ',
  IMPROVEMENT: 'IM',
  FURNITURE: 'FN',
  VEHICLE: 'VH',
};

export function round2(d: Decimal | number | string): Decimal {
  return new Decimal(d).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function round4(d: Decimal | number | string): Decimal {
  return new Decimal(d).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/**
 * Compute derived cost fields (basePrice ex-VAT, vatAmount, purchaseCost,
 * whtAmount, monthlyDepr) from raw input. Used by both `createDraft` and
 * `update` to keep the math identical between insert and edit paths.
 *
 * Input shape accepts either DTO numbers/strings or Prisma Decimal values
 * (since `update` merges the existing asset with the partial DTO).
 */
export function computeCostFields(input: {
  basePrice: Decimal | number | string;
  shippingCost?: Decimal | number | string | null;
  installationCost?: Decimal | number | string | null;
  otherCapitalized?: Decimal | number | string | null;
  residualValue?: Decimal | number | string | null;
  usefulLifeMonths: number;
  hasVat?: boolean | null;
  vatInclusive?: boolean | null;
  hasWht?: boolean | null;
  whtBaseAmount?: Decimal | number | string | null;
  whtRate?: Decimal | number | string | null;
}) {
  const basePriceRaw = new Decimal(input.basePrice.toString());
  const shippingCost = new Decimal((input.shippingCost ?? 0).toString());
  const installationCost = new Decimal((input.installationCost ?? 0).toString());
  const otherCapitalized = new Decimal((input.otherCapitalized ?? 0).toString());
  const residualValue = new Decimal((input.residualValue ?? 0).toString());

  let basePrice = basePriceRaw;
  let vatAmount = new Decimal(0);
  if (input.hasVat) {
    if (input.vatInclusive) {
      // Fix #1.3: extract VAT from inclusive basePrice
      vatAmount = round2(basePriceRaw.times(7).div(107));
      basePrice = basePriceRaw.minus(vatAmount);
    } else {
      vatAmount = round2(basePriceRaw.times('0.07'));
    }
  }

  const purchaseCost = round2(
    basePrice.plus(shippingCost).plus(installationCost).plus(otherCapitalized),
  );

  // WHT — ทป.4/2528 + ม.50 ทวิ + ม.40(7)(8): WHT applies ONLY to service /
  // hire-of-work components, NOT to goods purchases.
  //
  // Asset purchases are predominantly goods. WHT is permitted ONLY on the
  // service portion (e.g. installation cost). We enforce:
  //   1. hasWht=true requires installationCost > 0 (service portion exists)
  //   2. whtBaseAmount must be ≤ installationCost (cannot extend to goods)
  //   3. Default whtBaseAmount = installationCost when not specified
  //
  // CRITICAL #1 fix (2569-05-09): Previously a user could set hasWht=true
  // on a pure goods purchase (e.g. vehicle without installation) and the
  // template would post Cr 21-3102/03 — illegal per ทป.4/2528.
  let whtAmount = new Decimal(0);
  if (input.hasWht && input.whtRate != null) {
    if (installationCost.lte(0)) {
      throw new BadRequestException(
        'ไม่สามารถหัก ณ ที่จ่าย (WHT) สำหรับการซื้อสินค้าได้ ตามทป.4/2528 + ม.50 ทวิ — ' +
          'WHT บังคับใช้กับ "ค่าบริการ" หรือ "ค่าจ้างทำของ" เท่านั้น ' +
          'หากซื้อสินค้าพร้อมบริการติดตั้ง กรุณาแยกค่าติดตั้งใส่ช่อง installationCost',
      );
    }
    const whtBaseRaw = new Decimal(
      (input.whtBaseAmount ?? installationCost).toString(),
    );
    if (whtBaseRaw.gt(installationCost)) {
      throw new BadRequestException(
        `ฐานคำนวณ WHT (${whtBaseRaw.toFixed(2)}) ต้องไม่เกินค่าติดตั้ง/บริการ ` +
          `(${installationCost.toFixed(2)}) — WHT คิดเฉพาะส่วนค่าบริการตาม ทป.4/2528`,
      );
    }
    whtAmount = round2(whtBaseRaw.times(input.whtRate.toString()));
  }

  // Nominal monthly figure (display only) — base / months.
  const monthlyDepr = round4(
    purchaseCost.minus(residualValue).div(input.usefulLifeMonths),
  );
  // Daily rate (actual posting basis) — base ÷ (years × 365), years = months/12.
  // Equivalent to base × 12 / (months × 365). 365-day fixed year per spec R3.
  const totalDays = new Decimal(input.usefulLifeMonths).times(365).div(12);
  const dailyDepr = totalDays.gt(0)
    ? round4(purchaseCost.minus(residualValue).div(totalDays))
    : new Decimal(0);

  return {
    basePrice,
    vatAmount,
    purchaseCost,
    whtAmount,
    monthlyDepr,
    dailyDepr,
    // Echo back inputs that callers also need
    shippingCost,
    installationCost,
    otherCapitalized,
    residualValue,
  };
}
