import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Allow-list of account codes that may appear on a multi-line Adjustment row
 * (W1 hardening). The adjustment rows absorb cash-leg deltas between
 * amount_paid and (totalAmount − wht); only small-amount tolerance / bank-fee
 * / discount accounts are sensible here. Allowing arbitrary CoA codes lets the
 * preparer pick Revenue or Cash, balancing the JE but causing accounting drift.
 *
 * Codes from accounting.md FINANCE chart (apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv):
 *   52-1104 — ส่วนลดเศษสตางค์ (≤1฿ rounding tolerance)
 *   52-1106 — ส่วนลดดอกเบี้ย-ปิดยอด (Early payoff discount)
 *   53-1303 — ค่าธรรมเนียมธนาคาร
 *   53-1503 — กำไร/ขาดทุนจากการปัดเศษ
 */
export const ADJUSTMENT_ALLOWLIST = new Set<string>([
  '52-1104',
  '52-1106',
  '53-1303',
  '53-1503',
]);

// ─── V12/V13/V14 — Multi-line Adjustment validation (shared) ────────
// Fix Report P0-4 + B2. Validates that:
//   V12  Σ signed(adjustments) === amountPaid − netExpected
//   V13  every accountCode exists in CoA and is on ADJUSTMENT_ALLOWLIST
//   V14  every row.amount > 0 and accountCode is non-empty
// Signed convention: CR contributes +amount, DR contributes −amount.
export async function validateAdjustments(
  tx: Prisma.TransactionClient,
  opts: {
    adjustments: { accountCode: string; side: 'DR' | 'CR'; amount: string | number; note?: string }[];
    netExpected: Prisma.Decimal;
    amountPaid: Prisma.Decimal;
  },
): Promise<void> {
  const { adjustments, netExpected, amountPaid } = opts;
  const diff = amountPaid.minus(netExpected);

  if (adjustments.length === 0 && diff.eq(0)) return; // fast path — no adjustments needed

  // V14 — non-empty accountCode + positive amount
  for (let i = 0; i < adjustments.length; i++) {
    const a = adjustments[i];
    if (!a.accountCode || !a.accountCode.trim()) {
      // NOTE: message intentionally carries the "V13:" prefix (pre-existing behavior) even though
      // this is the V14 block — clients may key off the prefix; do NOT "fix" it to "V14:".
      throw new BadRequestException(`V13: บัญชีปรับผลต่างแถวที่ ${i + 1} ยังไม่ได้เลือกบัญชี`);
    }
    const amt = new Prisma.Decimal(a.amount);
    if (amt.lte(0)) {
      throw new BadRequestException(
        `V14: บัญชีปรับผลต่างแถวที่ ${i + 1}: จำนวนต้องมากกว่า 0`,
      );
    }
  }

  // V13 — code exists in CoA AND on the allow-list
  if (adjustments.length > 0) {
    const adjCodes = [...new Set(adjustments.map((a) => a.accountCode))];
    const adjCoaRows = await tx.chartOfAccount.findMany({
      where: { code: { in: adjCodes }, deletedAt: null },
      select: { code: true },
    });
    const adjFound = new Set(adjCoaRows.map((r) => r.code));
    for (const c of adjCodes) {
      if (!adjFound.has(c)) {
        throw new BadRequestException(`V13: บัญชีปรับผลต่าง ${c} ไม่พบในผังบัญชี`);
      }
      if (!ADJUSTMENT_ALLOWLIST.has(c)) {
        throw new BadRequestException(
          `V13: บัญชีปรับผลต่าง ${c} ไม่อยู่ในรายการที่อนุญาต — ` +
            `อนุญาตเฉพาะ ${[...ADJUSTMENT_ALLOWLIST].join(', ')}`,
        );
      }
    }
  }

  // V12 — Σ signed(adjustments) === diff
  const signedSum = adjustments.reduce<Prisma.Decimal>((s, a) => {
    const amt = new Prisma.Decimal(a.amount);
    return a.side === 'CR' ? s.plus(amt) : s.minus(amt);
  }, new Prisma.Decimal(0));
  if (!signedSum.eq(diff)) {
    throw new BadRequestException(
      `V12: ผลรวมบัญชีปรับผลต่าง (signed = ${signedSum.toFixed(2)}) ` +
        `ไม่เท่ากับผลต่าง amount_paid − net_expected (${diff.toFixed(2)})`,
    );
  }
}
