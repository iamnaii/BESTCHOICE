import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import {
  Accrual2AContractFields,
  accrual2AInputOf,
  remainingAccrualPortion,
} from './build-accrual-2a-lines';
import { computeInstallmentBreakdown } from './compute-installment-breakdown';
import { reconstructPriorCleared } from './reconstruct-prior';
import { documentedSoFar } from './receipt-tax-breakdown';

/**
 * ภาษี/ยอดคงเหลือของงวดที่ใบปิดยอดก่อนกำหนดปิด (ฝ่ายบัญชี 16/10/2569 ข้อ 16.1 · 2026-10-18) — กติกาเดียวกับใบรับชำระ
 * ค่างวด (PR3): ใบที่ทำให้ยอดสะสมของงวดครบรับส่วนที่เหลือ = ยอดของงวด − ที่เอกสารก่อนหน้าของงวดแสดงแล้ว
 * (`documentedSoFar` จาก Cr 11-2103 ของรายการรับชำระ/หักเงินรับล่วงหน้าที่ยังมีผล) · งวดสุดท้ายรับเศษ
 * (`computeInstallmentBreakdown` ที่ส่ง installmentNo). Σ ทุกงวด = ภาษีขายของสัญญาที่ยังไม่เคยออกใบกำกับ.
 * ไม่มีแถวตารางงวด (ข้อมูล legacy) = ไม่มีรายการก่อน — นับเต็มงวด.
 */
export interface RemainingInstallmentVat {
  vat: Decimal;
  total: Decimal;
  perInstallment: Array<{ installmentNo: number; vat: Decimal; total: Decimal }>;
}

export async function remainingInstallmentVat(
  client: Prisma.TransactionClient | PrismaService,
  contract: Accrual2AContractFields & { id: string },
  installmentNos: readonly number[],
): Promise<RemainingInstallmentVat> {
  const zero = new Decimal(0);
  const nos = [...new Set(installmentNos)].sort((a, b) => a - b);
  if (nos.length === 0) return { vat: zero, total: zero, perInstallment: [] };

  const scheds = await client.installmentSchedule.findMany({
    where: { contractId: contract.id, deletedAt: null, installmentNo: { in: nos } },
    select: { id: true, installmentNo: true },
  });
  const schedByNo = new Map(scheds.map((s) => [s.installmentNo, s.id]));

  const perInstallment: RemainingInstallmentVat['perInstallment'] = [];
  for (const installmentNo of nos) {
    const basis = computeInstallmentBreakdown(accrual2AInputOf(contract, installmentNo));
    const schedId = schedByNo.get(installmentNo);
    const priorClearings = schedId
      ? (await reconstructPriorCleared(client, schedId, basis.installmentTotal)).priorClearings
      : [];
    const rest = remainingAccrualPortion(basis, documentedSoFar(basis, priorClearings));
    perInstallment.push({ installmentNo, vat: rest.vat, total: rest.total });
  }
  return {
    vat: perInstallment.reduce((sum, r) => sum.plus(r.vat), zero),
    total: perInstallment.reduce((sum, r) => sum.plus(r.total), zero),
    perInstallment,
  };
}
