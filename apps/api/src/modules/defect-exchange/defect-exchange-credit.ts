import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { ReceiptVoidRedirect } from '../journal/cpa-templates/receipt-void-reversal.template';
import {
  DEFECT_EXCHANGE_CREDIT_IN_FLOW,
  DEFECT_EXCHANGE_CREDIT_OUT_FLOW,
  classifyDefectExchangeReversal,
} from '../journal/cpa-templates/defect-exchange-reversal.template';
import { buildAdvanceVatConsumeLines, type AdvanceVatLine } from '../journal/advance-vat';
import { findActiveAdvanceExcessIncome } from '../journal/advance-excess-income.util';

type Client = Prisma.TransactionClient | PrismaClient;
const ZERO = new Decimal(0);

/** `Receipt.cnSource` ของใบลดหนี้ที่ออกตอนเปลี่ยนเครื่องตำหนิ (คู่กับ REPOSSESSION / WRITE_OFF ของ CreditNoteDocumentService) */
export const DEFECT_EXCHANGE_CN_SOURCE = 'DEFECT_EXCHANGE';
/** บัญชีพักเครดิตเปลี่ยนเครื่อง (ผังแถว 53) — สุทธิ 0 ทุกครั้ง: Cr สัญญาเดิม = Dr สัญญาใหม่ */
export const DEFECT_EXCHANGE_SUSPENSE_ACCOUNT = '21-1106';
export const DEFECT_EXCHANGE_TAG = 'DEFECT_EXCHANGE';
export { DEFECT_EXCHANGE_CREDIT_IN_FLOW, DEFECT_EXCHANGE_CREDIT_OUT_FLOW };

/** ขั้น ก: กระจกรับชำระย้ายขาเงินสด/ธนาคารไปบัญชีพัก — ธนาคารไม่ขยับ (เจ้าของ 17/10/2569 แนวทาง B) */
export const DEFECT_EXCHANGE_REDIRECT: ReceiptVoidRedirect = {
  accountPrefixes: ['11-11', '11-12'],
  to: DEFECT_EXCHANGE_SUSPENSE_ACCOUNT,
  description: 'โอนเป็นเครดิตเปลี่ยนเครื่อง',
};

/** ใบที่ **ไม่** ออกใบลดหนี้ตอนเปลี่ยนเครื่อง (exclude-list — ครอบ INSTALLMENT/PAYMENT วันนี้ และ ADVANCE_SURPLUS ของ #1703) */
export const EXCHANGE_SKIPPED_RECEIPT_TYPES = ['CREDIT_NOTE', 'EARLY_PAYOFF', 'RESCHEDULE_FEE', 'DOWN_PAYMENT'] as const;

/** ร่องรอยการปรับดิวในสมุดบัญชี — `RescheduleJP6Template` (6a/6b) · `reschedule-collect.service` · 2A หักถังพัก */
export const RESCHEDULE_JE_TAGS: readonly string[] = ['6a', '6b'];
export const RESCHEDULE_JE_FLOWS: readonly string[] = [
  'reschedule-fee',
  'reschedule-bundled',
  'reschedule-final',
  'reschedule-collect',
  'reschedule-park-consume',
];

export const EXCHANGE_BLOCK_RESCHEDULED =
  'สัญญาเดิมมีการเลื่อนนัดชำระ — เปลี่ยนเครื่องผ่านระบบไม่ได้ ติดต่อผู้ดูแลระบบ';
export const EXCHANGE_BLOCK_EXCESS_INCOME =
  'สัญญาเดิมลงรายได้เงินพักส่วนเกิน (42-1106) แล้ว — ต้องให้ผู้ดูแลระบบกลับรายการกวาดก่อน (คำสั่ง advance-excess:reverse)';
export const EXCHANGE_BLOCK_PENDING_VOID =
  'มีคำขอยกเลิกใบเสร็จของสัญญาเดิมค้างอยู่ในคิวอนุมัติ — อนุมัติ/ปฏิเสธคำขอนั้นก่อน';
export const EXCHANGE_BLOCK_EARLY_PAYOFF = 'สัญญาเดิมมีใบเสร็จปิดยอดก่อนกำหนด — เปลี่ยนเครื่องไม่ได้';
export const EXCHANGE_BLOCK_ORPHAN_CN =
  'สัญญาเดิมมีใบลดหนี้ที่ไม่มีใบต้นทาง (ข้อมูลผิดปกติ) — ให้ฝ่ายบัญชีตรวจก่อน';

export const EXCHANGE_RECEIPT_SELECT = {
  id: true,
  paymentId: true,
  receiptNumber: true,
  receiptType: true,
  installmentNo: true,
  paidDate: true,
  paymentMethod: true,
  amount: true,
  vatAmount: true,
} as const;
export type ExchangeReceiptRow = Prisma.ReceiptGetPayload<{ select: typeof EXCHANGE_RECEIPT_SELECT }>;

/** ใบรับเงินของสัญญาเดิมที่ยังมีผล เรียงตามวันรับเงิน (spec §3 ก) */
export function listReceiptsToCreditNote(client: Client, contractId: string): Promise<ExchangeReceiptRow[]> {
  return client.receipt.findMany({
    where: {
      contractId,
      isVoided: false,
      deletedAt: null,
      receiptType: { notIn: [...EXCHANGE_SKIPPED_RECEIPT_TYPES] },
    },
    orderBy: [{ paidDate: 'asc' }, { receiptNumber: 'asc' }],
    select: EXCHANGE_RECEIPT_SELECT,
  });
}

export function sumReceiptAmounts(rows: readonly { amount: Prisma.Decimal | string | number }[]): Decimal {
  return rows.reduce((s, r) => s.plus(r.amount.toString()), ZERO);
}

const metaOf = (row: { metadata: unknown }): Record<string, unknown> =>
  row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? (row.metadata as Record<string, unknown>)
    : {};

async function activeEntriesOf(client: Client, contractId: string): Promise<Record<string, unknown>[]> {
  const rows = await client.journalEntry.findMany({
    where: { status: 'POSTED', deletedAt: null, metadata: { path: ['contractId'], equals: contractId } },
    select: { metadata: true },
  });
  return rows.map(metaOf).filter((m) => m.reversed !== true);
}

/** สัญญาเดิมเคยปรับดิว (6a แยกใบ / 6b รวมค่างวด) — predicate เดียวของด่าน (spec §5) */
export async function hasRescheduleHistory(
  client: Client,
  contract: { id: string; rescheduleAdvanceBalance?: Prisma.Decimal | string | number | null },
): Promise<boolean> {
  if (new Decimal((contract.rescheduleAdvanceBalance ?? 0).toString()).gt(0)) return true;
  const fee = await client.receipt.count({
    where: { contractId: contract.id, receiptType: 'RESCHEDULE_FEE', isVoided: false, deletedAt: null },
  });
  if (fee > 0) return true;
  const entries = await activeEntriesOf(client, contract.id);
  return entries.some(
    (m) =>
      (typeof m.tag === 'string' && RESCHEDULE_JE_TAGS.includes(m.tag)) ||
      (typeof m.flow === 'string' && RESCHEDULE_JE_FLOWS.includes(m.flow)),
  );
}

/**
 * เหตุผลปฏิเสธด้านเงิน (spec §5) — ใช้ทั้ง `checkEligibility` (นอก tx) และ `execute` (ใน tx ทั้งทางปกติและ bypass).
 * คืนทุกเหตุผลที่พบ เรียงคงที่ — ว่าง = ผ่าน.
 */
export async function exchangeMoneyBlockers(
  client: Client,
  contract: { id: string; rescheduleAdvanceBalance?: Prisma.Decimal | string | number | null },
): Promise<string[]> {
  const out: string[] = [];
  if (await hasRescheduleHistory(client, contract)) out.push(EXCHANGE_BLOCK_RESCHEDULED);
  if ((await findActiveAdvanceExcessIncome(client, contract.id)).length > 0) out.push(EXCHANGE_BLOCK_EXCESS_INCOME);
  const pendingVoid = await client.paymentApprovalRequest.findFirst({
    where: { contractId: contract.id, action: 'VOID_RECEIPT', status: 'PENDING', deletedAt: null },
    select: { id: true },
  });
  if (pendingVoid) out.push(EXCHANGE_BLOCK_PENDING_VOID);
  const earlyPayoff = await client.receipt.count({
    where: { contractId: contract.id, receiptType: 'EARLY_PAYOFF', isVoided: false, deletedAt: null },
  });
  if (earlyPayoff > 0) out.push(EXCHANGE_BLOCK_EARLY_PAYOFF);
  const orphanCn = await client.receipt.count({
    where: { contractId: contract.id, receiptType: 'CREDIT_NOTE', voidedReceiptId: null, cnSource: null, deletedAt: null },
  });
  if (orphanCn > 0) out.push(EXCHANGE_BLOCK_ORPHAN_CN);
  return out;
}

/** ขั้น ข (spec §3): เงินของลูกค้าที่เหลือในสัญญาเดิม → บัญชีพัก + กลับภาษีที่พักไว้ (ถังหมด ⇒ ทั้งก้อน) */
export function buildCreditOutLines(advance: Decimal, credit: Decimal, vat: Decimal): AdvanceVatLine[] {
  const total = advance.plus(credit);
  if (!total.gt(0)) return [];
  const lines: AdvanceVatLine[] = [];
  if (advance.gt(0)) {
    lines.push({ accountCode: '21-1103', dr: advance, cr: ZERO, description: 'โอนเงินรับล่วงหน้าที่เหลือเป็นเครดิตเปลี่ยนเครื่อง' });
  }
  if (credit.gt(0)) {
    lines.push({ accountCode: '21-5101', dr: credit, cr: ZERO, description: 'โอนเครดิตที่เหลือเป็นเครดิตเปลี่ยนเครื่อง' });
  }
  const vatLines = buildAdvanceVatConsumeLines(vat);
  const vatDr = vatLines.filter((l) => l.dr.gt(0));
  const vatCr = vatLines.filter((l) => l.cr.gt(0));
  lines.push(...vatDr);
  lines.push({
    accountCode: DEFECT_EXCHANGE_SUSPENSE_ACCOUNT,
    dr: ZERO,
    cr: total,
    description: 'เงินของลูกค้ารอโอนเป็นเครดิตสัญญาใหม่ (เปลี่ยนเครื่องตำหนิ)',
  });
  lines.push(...vatCr);
  return lines;
}

/** ขั้น ง (spec §3): ตั้งเครดิตสัญญาใหม่ — ไม่ stamp ภาษี (spec §7) */
export function buildCreditInLines(total: Decimal): AdvanceVatLine[] {
  if (!total.gt(0)) return [];
  return [
    { accountCode: DEFECT_EXCHANGE_SUSPENSE_ACCOUNT, dr: total, cr: ZERO, description: 'รับโอนเครดิตจากสัญญาเดิม (เปลี่ยนเครื่องตำหนิ)' },
    { accountCode: '21-5101', dr: ZERO, cr: total, description: 'เครดิตจากการเปลี่ยนเครื่องตำหนิ — ใช้ชำระค่างวด' },
  ];
}

// ---------- กล่องยืนยัน: ประมาณเครดิตที่จะย้าย = สิ่งที่ขั้น ก/ค/ข จะทำจริง (ผู้ตรวจอิสระ I2) ----------

export interface EstimateEntryLine {
  accountCode: string;
  debit: Prisma.Decimal | string | number;
  credit: Prisma.Decimal | string | number;
}
export interface EstimateEntry {
  entryNumber: string;
  metadata: unknown;
  lines: readonly EstimateEntryLine[];
}
export interface CreditTransferEstimate {
  /** = T ที่ขั้น ง จะตั้ง (ก่อน clamp ที่ 0 ของถังที่ติดลบ) */
  estimate: Decimal;
  /** ขาเงินสด/ธนาคารของใบที่จะยกเลิก — ส่วนที่ถูก redirect ไป 21-1106 */
  cashFromReceipts: Decimal;
  /** 21-1103 / 21-5101 หลังกระจกรายการ (ขั้น ก + ค) = ยอดที่ขั้น ข จะย้าย */
  advanceAfter: Decimal;
  creditAfter: Decimal;
  /** รายการเงินสดที่ขั้น ค จะปฏิเสธ (ใบรับชำระที่ไม่มีใบเสร็จ) — กล่องยืนยันต้องบอกก่อน ไม่ใช่ 400 ตอนยืนยัน */
  unmirrorable: string[];
}

const isRedirectedCash = (code: string) => DEFECT_EXCHANGE_REDIRECT.accountPrefixes.some((p) => code.startsWith(p));
const netOf = (lines: readonly EstimateEntryLine[], accountCode: string, side: 'dr' | 'cr'): Decimal =>
  lines
    .filter((l) => l.accountCode === accountCode)
    .reduce((s, l) => {
      const d = new Decimal(l.debit.toString());
      const c = new Decimal(l.credit.toString());
      return s.plus(side === 'dr' ? d.minus(c) : c.minus(d));
    }, ZERO);

/**
 * จำลองขั้น ก (ใบที่ยังมีผล → กระจกรายการรับชำระของมัน ขาเงินสดถูกย้ายไป 21-1106) + ขั้น ค (`classifyDefectExchangeReversal`
 * ตัวเดียวกับ template) + ขั้น ข (ยอดถังที่เหลือหลังกระจก): T = ขาเงินสดที่ย้าย + max(0, 21-1103 หลังกระจก) + max(0, 21-5101 หลังกระจก).
 * ไม่ใช่ "Σ ใบ + ยอดถังตอนนี้" — ใบที่จ่ายด้วยเครดิต/หักถังไม่มีขาเงินสด (กระจกคืนถังแล้วขั้น ข ย้าย) และเงินที่รอบกลางคืนหักเข้างวด
 * โดยไม่มีใบจะกลับเข้าถังเมื่อขั้น ค กระจก. รายการเงินสดที่กลับไม่ได้ (ไม่มีใบ) รายงานแยก ไม่นับ.
 * ใบที่ขั้น ก ยกเลิก = รายการที่ `paymentId` อยู่ในใบที่ยังมีผล และ tag `receipt`/`2B` (กติกาเดียวกับ `voidReceiptInTx`).
 */
export function estimateCreditToTransfer(input: {
  entries: readonly EstimateEntry[];
  livePaymentIds: ReadonlySet<string>;
  ledgerAdvance: Decimal;
  ledgerCredit: Decimal;
}): CreditTransferEstimate {
  let cash = ZERO;
  let advance = input.ledgerAdvance;
  let credit = input.ledgerCredit;
  const unmirrorable: string[] = [];
  for (const je of input.entries) {
    const meta = (je.metadata ?? {}) as Record<string, unknown>;
    if (meta['reversed'] === true) continue;
    const paymentId = typeof meta['paymentId'] === 'string' ? meta['paymentId'] : null;
    const receiptEntry = meta['tag'] === 'receipt' || meta['tag'] === '2B';
    let mirrored = false;
    if (paymentId && receiptEntry && input.livePaymentIds.has(paymentId)) {
      mirrored = true;
      for (const l of je.lines) {
        if (isRedirectedCash(l.accountCode)) cash = cash.plus(new Decimal(l.debit.toString()).minus(l.credit.toString()));
      }
    } else {
      const kind = classifyDefectExchangeReversal(je);
      if (kind === 'MIRROR') mirrored = true;
      else if (kind === 'UNMIRRORABLE_CASH') {
        unmirrorable.push(je.entryNumber);
        continue;
      } else continue;
    }
    if (mirrored) {
      advance = advance.minus(netOf(je.lines, '21-1103', 'cr'));
      credit = credit.minus(netOf(je.lines, '21-5101', 'cr'));
    }
  }
  const advanceAfter = Decimal.max(0, advance);
  const creditAfter = Decimal.max(0, credit);
  return { estimate: cash.plus(advanceAfter).plus(creditAfter), cashFromReceipts: cash, advanceAfter, creditAfter, unmirrorable };
}
