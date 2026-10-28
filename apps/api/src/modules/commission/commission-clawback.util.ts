import { ConflictException } from '@nestjs/common';
import { CommissionStatus, Prisma } from '@prisma/client';

/**
 * 410 for the old pay paths (`POST /commissions/:id/pay`, `POST /commissions/payouts/generate`,
 * `PATCH /commissions/payouts/:id/paid`) — D4 Part 2: commissions are paid only through payroll.
 * The body carries `code` so the web can recognise it (SentryExceptionFilter forwards `code` on 4xx).
 */
export const COMMISSION_PAY_VIA_PAYROLL_MSG =
  'จ่ายค่าคอมผ่านใบเงินเดือนเท่านั้น — สร้างใบเงินเดือนที่หน้ารายจ่าย › สร้างเอกสารใหม่ › เงินเดือน (PR) ระบบดึงค่าคอมที่อนุมัติแล้วให้เอง';
export const COMMISSION_PAY_VIA_PAYROLL_CODE = 'COMMISSION_PAY_VIA_PAYROLL';

const STATUS_CHANGED_MSG = 'สถานะค่าคอมเปลี่ยนแล้ว กรุณาตรวจใหม่';

export interface ClawbackCandidate {
  id: string;
  status: CommissionStatus;
  commissionAmount: Prisma.Decimal;
  paidAt: Date | null;
  paidAmount: Prisma.Decimal | null;
}

/**
 * The amount a clawback records on one row (P2-R8: "paid" means `paidAt` is set).
 *
 * - Paid → `HALF_UP(paidAmount × percent / 100, 2)`: what the next payroll deducts (Tasks 3–4). A
 *   PARTIALLY_CLAWED_BACK paid row upgraded at 100% therefore records the full paid amount; the
 *   payroll side subtracts what earlier CLAWBACK items already deducted. `paidAmount` null with
 *   `paidAt` set falls back to `commissionAmount` (every writer of `paidAt` stores
 *   `paidAmount = commissionAmount`).
 * - Unpaid at 100% → null (nothing left the company; nothing to deduct).
 * - Unpaid below 100% (the early-default cron on an APPROVED row) → `HALF_UP(commissionAmount × %, 2)`.
 */
export function clawbackAmountOf(row: ClawbackCandidate, percent: number): Prisma.Decimal | null {
  const factor = new Prisma.Decimal(percent).div(100);
  if (row.paidAt !== null) {
    return new Prisma.Decimal(row.paidAmount ?? row.commissionAmount)
      .mul(factor)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }
  if (percent === 100) return null;
  return new Prisma.Decimal(row.commissionAmount).mul(factor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * The one clawback writer — sale void, credit-return cleanup, the early-default cron
 * (`CommissionService.applyClawbackForContract`) and contract cancellation (PENDING/APPROVED rows only).
 *
 * - skips rows already CLAWED_BACK;
 * - `status` = CLAWED_BACK at 100%, PARTIALLY_CLAWED_BACK below; `clawbackAmount` per `clawbackAmountOf`;
 * - always writes `clawbackPercent`, `clawbackAt`, `clawbackReason`; `monthsPaidBeforeDefault` only when given;
 * - one conditional `updateMany` per row on `(id, status)`, rows in id order (the payroll post writes
 *   commission rows in the same order, so the two never deadlock); a count ≠ 1 means the row changed
 *   since the caller read it → 409, and the caller's whole transaction rolls back.
 *
 * Takes no `payroll-clawback:${userId}` lock on purpose: on a paid row (the only kind payroll deducts)
 * it only ever raises `clawbackAmount` (100% records the full paid amount, ≥ any earlier partial), and
 * every write is a status CAS, so it cannot shrink an outstanding amount a payroll read under that lock;
 * the payroll gate re-checks at approve/post.
 */
export async function clawBackCommissions(
  tx: Prisma.TransactionClient,
  rows: ClawbackCandidate[],
  a: { reason: string; now: Date; percent?: number; monthsPaidBeforeDefault?: number },
): Promise<{ unpaidIds: string[]; paidIds: string[]; paidTotal: Prisma.Decimal }> {
  const percent = a.percent ?? 100;
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
    throw new Error(`clawBackCommissions: percent must be an integer 1–100 (got ${percent})`);
  }
  const status: CommissionStatus = percent === 100 ? 'CLAWED_BACK' : 'PARTIALLY_CLAWED_BACK';
  const unpaidIds: string[] = [];
  const paidIds: string[] = [];
  let paidTotal = new Prisma.Decimal(0);

  const pending = rows
    .filter((r) => r.status !== 'CLAWED_BACK')
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  for (const row of pending) {
    const clawbackAmount = clawbackAmountOf(row, percent);
    const result = await tx.salesCommission.updateMany({
      where: { id: row.id, status: row.status },
      data: {
        status,
        clawbackAmount,
        clawbackPercent: percent,
        clawbackAt: a.now,
        clawbackReason: a.reason,
        ...(a.monthsPaidBeforeDefault !== undefined && { monthsPaidBeforeDefault: a.monthsPaidBeforeDefault }),
      },
    });
    if (result.count !== 1) throw new ConflictException(STATUS_CHANGED_MSG);
    if (row.paidAt !== null) {
      paidIds.push(row.id);
      paidTotal = paidTotal.add(clawbackAmount ?? 0);
    } else {
      unpaidIds.push(row.id);
    }
  }
  return { unpaidIds, paidIds, paidTotal };
}
