import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { DeferredWarning } from './deferred-warning';
import { glContractBalance } from './gl-contract-balance';

/**
 * เงินของลูกค้าที่สัญญายังถือไว้ ณ วันปิดสัญญาด้วยการยึดเครื่อง (JP5) หรือตัดหนี้สูญ.
 *
 * คำตอบฝ่ายบัญชี เล่ม 1 ข้อ 6 (29/09/2569) — ทางเลือก (1) "หักทุกประเภท ทั้งสองกรณี": นำเงินรับล่วงหน้าที่ค้าง
 * ทุกประเภท (21-1103 — ถังพักค่าปรับดิว `rescheduleAdvanceBalance` และถังรวม `advanceBalance`) และเงินเกินของลูกค้า
 * (21-5101 — `creditBalance`) มาหักลูกหนี้ก่อนคำนวณหนี้สูญ / ผลจากการยึดเครื่อง และไม่เหลือยอดค้างของสัญญาหลังปิด.
 *
 * ยอดในสมุดบัญชีเป็นแหล่งจริง (`glContractBalance` — ตัวเดียวกับขาล้างลูกหนี้ของทั้งสองรายการ): ยอดที่หัก = ยอด Cr
 * คงเหลือของบัญชีนั้นของสัญญา (ติดลบ = ไม่มีให้หัก). คอลัมน์ทั้งสามของสัญญาเป็นตัวติดตามระดับแอป — ผลรวมที่ไม่เท่า
 * ยอดในบัญชีเป็นสัญญาณเตือน (ไม่หยุดงาน) ที่ผู้เรียกส่งหลังธุรกรรม commit (`emitDeferredWarnings`). ผู้เรียกตั้ง
 * คอลัมน์ทั้งสามเป็นศูนย์ในธุรกรรมเดียวกับรายการ (`CONTRACT_ADVANCE_COLUMNS_CLEARED`).
 */

/** คอลัมน์เงินของลูกค้าบนสัญญา (ค่าจาก Prisma — แถวจำลองในเทสอาจไม่มี) */
export interface ContractAdvanceColumns {
  advanceBalance?: Prisma.Decimal | string | number | null;
  rescheduleAdvanceBalance?: Prisma.Decimal | string | number | null;
  creditBalance?: Prisma.Decimal | string | number | null;
}

/** เส้นทางปิดสัญญาที่อ่านยอดนี้ (ปิดยอดก่อนกำหนด JP4 — หักเงินพัก + ถังรวมเท่าที่ยอดปิดหัก (PR5ข) + เงินเกินของลูกค้า) */
export type ContractCloseFlow = 'repossession' | 'write-off' | 'early-payoff';

export interface ContractCloseAdvances {
  /** ยอด Cr คงเหลือของ 21-1103 ของสัญญา (ทุกถังรวมกัน) — ไม่ติดลบ */
  advance: Decimal;
  /** ยอด Cr คงเหลือของ 21-5101 ของสัญญา — ไม่ติดลบ */
  credit: Decimal;
  /** คอลัมน์ไม่ตรงกับยอดในบัญชี — ผู้เรียกส่งหลังธุรกรรม commit */
  warnings: DeferredWarning[];
}

export const CLOSE_ADVANCE_MISMATCH_MESSAGE =
  '[contract-close] advance/credit columns differ from the ledger cleared at close';

/** ค่าที่ผู้เรียกเขียนลงสัญญาในธุรกรรมเดียวกับรายการยึดเครื่อง / ตัดหนี้สูญ */
export const CONTRACT_ADVANCE_COLUMNS_CLEARED = {
  advanceBalance: 0,
  rescheduleAdvanceBalance: 0,
  creditBalance: 0,
} as const;

const toDecimal = (v: Prisma.Decimal | string | number | null | undefined): Decimal =>
  new Decimal((v ?? 0).toString());

/**
 * ส่วนคำนวณ (ไม่แตะฐาน): ยอดที่ต้องหักจากยอดในบัญชี (มีเครื่องหมาย) + สัญญาณเตือนเมื่อคอลัมน์ไม่ตรง.
 * `ledger.advance` / `ledger.credit` = ยอด Cr − Dr ของ 21-1103 / 21-5101 ของสัญญา.
 */
export function contractCloseAdvancesFrom(
  contract: { id: string; contractNumber: string } & ContractAdvanceColumns,
  flow: ContractCloseFlow,
  ledger: { advance: Decimal; credit: Decimal },
): ContractCloseAdvances {
  const zero = new Decimal(0);
  const advanceBalance = toDecimal(contract.advanceBalance);
  const rescheduleAdvanceBalance = toDecimal(contract.rescheduleAdvanceBalance);
  const creditBalance = toDecimal(contract.creditBalance);
  const warnings: DeferredWarning[] = [];
  if (
    !ledger.advance.eq(advanceBalance.plus(rescheduleAdvanceBalance)) ||
    !ledger.credit.eq(creditBalance)
  ) {
    warnings.push({
      message: CLOSE_ADVANCE_MISMATCH_MESSAGE,
      tags: { module: 'journal', action: 'close-advance-ledger-mismatch', flow },
      extra: {
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        ledger21_1103: ledger.advance.toFixed(2),
        advanceBalance: advanceBalance.toFixed(2),
        rescheduleAdvanceBalance: rescheduleAdvanceBalance.toFixed(2),
        ledger21_5101: ledger.credit.toFixed(2),
        creditBalance: creditBalance.toFixed(2),
      },
    });
  }
  return {
    advance: Decimal.max(zero, ledger.advance),
    credit: Decimal.max(zero, ledger.credit),
    warnings,
  };
}

/** อ่านยอด 21-1103 / 21-5101 ของสัญญาจากสมุดบัญชี (ในธุรกรรมของผู้เรียก) แล้วคำนวณยอดที่ต้องหัก */
export async function readContractCloseAdvances(
  client: Prisma.TransactionClient | PrismaClient,
  contract: { id: string; contractNumber: string } & ContractAdvanceColumns,
  flow: ContractCloseFlow,
): Promise<ContractCloseAdvances> {
  const advance = await glContractBalance(client, contract.id, '21-1103', 'cr');
  const credit = await glContractBalance(client, contract.id, '21-5101', 'cr');
  return contractCloseAdvancesFrom(contract, flow, { advance, credit });
}
