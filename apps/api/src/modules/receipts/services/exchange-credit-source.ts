import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { INSTALLMENT_MONEY_RECEIPT_TYPES } from '../receipt-types.constants';
import {
  DEFECT_EXCHANGE_CN_SOURCE,
  DEFECT_EXCHANGE_CREDIT_IN_FLOW,
} from '../../defect-exchange/defect-exchange-credit';

export interface ExchangeCreditSource {
  parentContractNumber: string;
  transferred: Decimal;
  creditNotes: { number: string; originalNumber: string | null }[];
}

interface CreditBalanceReceiptRow {
  id: string;
  paidDate: Date;
  receiptNumber: string;
  amount: Prisma.Decimal | string | number;
}

/**
 * ที่มาของเครดิตบนใบใช้เครดิต (spec §6 — ตัดสินตอนพิมพ์ ไม่มีคอลัมน์ใหม่): ใบเป็นช่องทาง CREDIT_BALANCE ของสัญญาที่มี
 * สัญญาเดิม และ Σ ใบ CREDIT_BALANCE ที่ยังมีผลของสัญญา เรียงตาม paidDate แล้ว receiptNumber จนถึงใบนี้ ≤ T + 0.01
 * (เครดิตเข้าสัญญาได้ทางเดียวก่อนเปิดใช้ และถูกใช้ทันทีตอนเปิดใช้ ⇒ ใบแรก ๆ เสมอ) · เกิน = เครดิตจากจ่ายเกินทีหลัง
 */
export function exchangeCreditSourceFrom(input: {
  receipt: { id: string; paymentMethod: string | null; receiptType: string; isVoided: boolean };
  parentContractNumber: string | null;
  transferred: Decimal | null;
  creditBalanceReceipts: CreditBalanceReceiptRow[];
  creditNotes: { number: string; originalNumber: string | null }[];
}): ExchangeCreditSource | null {
  const { receipt, parentContractNumber, transferred } = input;
  if (receipt.paymentMethod !== 'CREDIT_BALANCE' || receipt.isVoided) return null;
  if (!(INSTALLMENT_MONEY_RECEIPT_TYPES as readonly string[]).includes(receipt.receiptType)) return null;
  if (!parentContractNumber || !transferred || !transferred.gt(0)) return null;
  const ordered = [...input.creditBalanceReceipts].sort((a, b) =>
    a.paidDate.getTime() !== b.paidDate.getTime()
      ? a.paidDate.getTime() - b.paidDate.getTime()
      : a.receiptNumber.localeCompare(b.receiptNumber),
  );
  let cumulative = new Decimal(0);
  for (const row of ordered) {
    cumulative = cumulative.plus(row.amount.toString());
    if (row.id === receipt.id) {
      return cumulative.lte(transferred.plus('0.01'))
        ? { parentContractNumber, transferred, creditNotes: input.creditNotes }
        : null;
    }
  }
  return null;
}

/** อ่านข้อมูลประกอบจากฐาน แล้วตัดสินด้วย `exchangeCreditSourceFrom` — คืน null เร็วเมื่อไม่ใช่ใบใช้เครดิตของสัญญาเปลี่ยนเครื่อง */
export async function resolveExchangeCreditSource(
  prisma: PrismaClient,
  receipt: { id: string; contractId: string; paymentMethod: string | null; receiptType: string; isVoided: boolean },
  contract: { parentContractId: string | null; parentContract: { contractNumber: string } | null },
): Promise<ExchangeCreditSource | null> {
  if (receipt.paymentMethod !== 'CREDIT_BALANCE' || !contract.parentContractId) return null;
  const creditIn = await prisma.journalEntry.findMany({
    where: { status: 'POSTED', deletedAt: null, metadata: { path: ['contractId'], equals: receipt.contractId } },
    select: { metadata: true },
  });
  let transferred = new Decimal(0);
  for (const e of creditIn) {
    const m = (e.metadata ?? {}) as Record<string, unknown>;
    if (m.flow !== DEFECT_EXCHANGE_CREDIT_IN_FLOW || m.reversed === true) continue;
    if (typeof m.amount === 'string' || typeof m.amount === 'number') transferred = transferred.plus(m.amount);
  }
  const [creditBalanceReceipts, cnRows] = await Promise.all([
    prisma.receipt.findMany({
      where: {
        contractId: receipt.contractId, paymentMethod: 'CREDIT_BALANCE', isVoided: false, deletedAt: null,
        receiptType: { in: [...INSTALLMENT_MONEY_RECEIPT_TYPES] },
      },
      select: { id: true, paidDate: true, receiptNumber: true, amount: true },
    }),
    prisma.receipt.findMany({
      where: { contractId: contract.parentContractId, receiptType: 'CREDIT_NOTE', cnSource: DEFECT_EXCHANGE_CN_SOURCE, deletedAt: null },
      select: { receiptNumber: true, voidedReceiptId: true },
      orderBy: { receiptNumber: 'asc' },
    }),
  ]);
  const originals = cnRows.some((r) => r.voidedReceiptId)
    ? await prisma.receipt.findMany({
        where: { id: { in: cnRows.map((r) => r.voidedReceiptId).filter((x): x is string => !!x) } },
        select: { id: true, receiptNumber: true },
      })
    : [];
  const originalNumber = new Map(originals.map((o) => [o.id, o.receiptNumber]));
  return exchangeCreditSourceFrom({
    receipt,
    parentContractNumber: contract.parentContract?.contractNumber ?? null,
    transferred: transferred.gt(0) ? transferred : null,
    creditBalanceReceipts,
    creditNotes: cnRows.map((r) => ({ number: r.receiptNumber, originalNumber: r.voidedReceiptId ? (originalNumber.get(r.voidedReceiptId) ?? null) : null })),
  });
}
