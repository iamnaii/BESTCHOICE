import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { InstallmentInputVatTemplate } from '../cpa-templates/installment-input-vat.template';
import { receivingTaxInvoice, resolveInputVatEligibility } from './input-vat-eligibility';
import { isPeriodClosedForBackdating } from '../../purchase-orders/services/supplier-doc.util';
import { validatePeriodOpen } from '../../../utils/period-lock.util';
import { formatDateShort, formatMonthName } from '../../../utils/thai-date.util';
import { bangkokCalendarParts } from '../../../utils/date.util';

/**
 * ก้อน 5 — จุดเคลมภาษีซื้อของเครื่องขายผ่อน. ฟังก์ชันรับ `tx` (ไม่ใช่ Nest provider — pattern `ShopCollectShopLegs` /
 * `cleanupCreditContractSale`) ให้เรียกจากใน $transaction ของ `ContractWorkflowService.activate`,
 * `ContractExchangeService.finalizeAfterActivation`, endpoint บันทึกใบกำกับทีหลัง และการยกเลิกสัญญาทั้งสองเส้นทาง
 */
export const INPUT_VAT_PERIOD_TODO_TAG = 'input-vat-period';
export const inputVatPeriodTodoKey = (contractNumber: string): string => `input-vat:${contractNumber}`;
const CANCELED_BEFORE_INVOICE = 'สัญญาถูกยกเลิกก่อนได้ใบกำกับภาษี';

export interface ClaimOnActivationInput {
  contractId: string;
  contractNumber: string;
  productId: string;
  /** วันเปิดสัญญา = postedAt เดียวกับ 1A */
  postedAt: Date;
}

export type ClaimOnActivationResult =
  | { status: 'CLAIMED'; amount: Decimal; entryNo: string; journalEntryId: string }
  | { status: 'PENDING_INVOICE'; amount: Decimal }
  | { status: 'NOT_ELIGIBLE'; reason: string };

const RECEIVING_SELECT = {
  id: true, grNumber: true, supplierDocType: true, supplierDocNumber: true, supplierDocDate: true,
  taxInvoiceNumber: true, taxInvoiceDate: true,
} as const;

/** เปิดสัญญา: ตัดสินเครื่องหลัก → ลง JE / รอใบกำกับ / ไม่เคลม แล้วเขียนคอลัมน์ `Contract.inputVat*` ใน tx เดียวกับ 1A */
export async function claimInputVatOnActivation(
  tx: Prisma.TransactionClient,
  template: InstallmentInputVatTemplate,
  input: ClaimOnActivationInput,
): Promise<ClaimOnActivationResult> {
  const [product, receivingItem] = await Promise.all([
    tx.product.findUnique({ where: { id: input.productId }, select: { checklistResults: true } }),
    tx.goodsReceivingItem.findUnique({
      where: { productId: input.productId },
      select: { receivedVat: true, receiving: { select: RECEIVING_SELECT } },
    }),
  ]);
  const eligibility = resolveInputVatEligibility({ checklistResults: product?.checklistResults ?? null, receivingItem });

  if (eligibility.kind === 'NOT_ELIGIBLE') {
    await tx.contract.update({ where: { id: input.contractId }, data: { inputVatStatus: 'NOT_ELIGIBLE', inputVatReason: eligibility.reason } });
    return { status: 'NOT_ELIGIBLE', reason: eligibility.reason };
  }
  if (eligibility.kind === 'PENDING_INVOICE') {
    await tx.contract.update({ where: { id: input.contractId }, data: { inputVatStatus: 'PENDING_INVOICE', inputVatAmount: eligibility.amount } });
    return { status: 'PENDING_INVOICE', amount: eligibility.amount };
  }
  const posted = await template.execute(
    {
      contractId: input.contractId,
      contractNumber: input.contractNumber,
      productId: input.productId,
      receivingId: eligibility.receivingId,
      grNumber: eligibility.grNumber,
      amount: eligibility.amount,
      taxInvoiceNumber: eligibility.taxInvoice.number,
      taxInvoiceDate: eligibility.taxInvoice.date,
      postedAt: input.postedAt,
    },
    tx,
  );
  await tx.contract.update({
    where: { id: input.contractId },
    data: { inputVatStatus: 'CLAIMED', inputVatAmount: eligibility.amount, inputVatJournalEntryId: posted.journalEntryId, inputVatReason: null },
  });
  return { status: 'CLAIMED', amount: eligibility.amount, entryNo: posted.entryNo, journalEntryId: posted.journalEntryId };
}

/** วันเปิดสัญญา = postedAt ของ 1A (`tag: '1A'`) หรือ A.1 ของสัญญาเปลี่ยนเครื่อง (`flow: 'exchange-new-contract-1a'`) · ไม่มี = null */
export async function findActivationPostedAt(tx: Prisma.TransactionClient, contractId: string): Promise<Date | null> {
  const je = await tx.journalEntry.findFirst({
    where: {
      deletedAt: null,
      status: 'POSTED',
      AND: [
        { metadata: { path: ['contractId'], equals: contractId } as any }, // eslint-disable-line @typescript-eslint/no-explicit-any
        { OR: [
          { metadata: { path: ['tag'], equals: '1A' } as any }, // eslint-disable-line @typescript-eslint/no-explicit-any
          { metadata: { path: ['flow'], equals: 'exchange-new-contract-1a' } as any }, // eslint-disable-line @typescript-eslint/no-explicit-any
        ] },
      ],
    },
    orderBy: { postedAt: 'asc' },
    select: { postedAt: true },
  });
  return je?.postedAt ?? null;
}

export interface ClaimedForReceiving {
  contractId: string;
  contractNumber: string;
  journalEntryNo: string;
  amount: string;
  postedOnInvoiceDate: boolean;
}

/**
 * ใบกำกับมาทีหลัง (Q2): ไล่สัญญา `PENDING_INVOICE` ของทุกเครื่องในใบรับของ → ลง JE ลงวันเปิดสัญญา ·
 * งวดเดือนนั้นปิดแล้ว (`isPeriodClosedForBackdating` FINANCE — ตรวจเข้มแบบใบรับของลงย้อน) → ลงวันนี้ + stamp + Todo MEDIUM ถึงฝ่ายบัญชี
 * สัญญา DRAFT/CANCELED ไม่ถูกเคลม (ยกเลิกไปแล้ว = `markInputVatReversedIfSwept` ตั้ง REVERSED ไว้แล้ว — เป็นตาข่ายสองชั้น)
 */
export async function claimPendingInputVatForReceiving(
  tx: Prisma.TransactionClient,
  template: InstallmentInputVatTemplate,
  input: { receivingId: string; now: Date; actorId: string },
): Promise<{ claimed: ClaimedForReceiving[]; accountingNotified: boolean }> {
  const receiving = await tx.goodsReceiving.findUnique({
    where: { id: input.receivingId },
    select: { ...RECEIVING_SELECT, items: { where: { productId: { not: null }, deletedAt: null }, select: { productId: true, receivedVat: true } }, po: { select: { poNumber: true } } },
  });
  if (!receiving) return { claimed: [], accountingNotified: false };
  const taxInvoice = receivingTaxInvoice(receiving);
  const productIds = receiving.items.map((i) => i.productId).filter((id): id is string => !!id);
  if (!taxInvoice || productIds.length === 0) return { claimed: [], accountingNotified: false };

  const contracts = await tx.contract.findMany({
    where: { productId: { in: productIds }, inputVatStatus: 'PENDING_INVOICE', deletedAt: null, status: { notIn: ['DRAFT', 'CANCELED'] } },
    select: { id: true, contractNumber: true, productId: true, inputVatAmount: true },
    orderBy: { createdAt: 'asc' },
  });
  if (contracts.length === 0) return { claimed: [], accountingNotified: false };

  const finance = await tx.companyInfo.findFirst({ where: { companyCode: 'FINANCE', deletedAt: null }, select: { id: true } });
  if (!finance) throw new Error('FINANCE company not configured');

  const claimed: ClaimedForReceiving[] = [];
  let accountingNotified = false;
  for (const c of contracts) {
    const vatOfUnit = receiving.items.find((i) => i.productId === c.productId)?.receivedVat ?? c.inputVatAmount;
    const amount = new Decimal((vatOfUnit ?? 0).toString());
    if (!amount.gt(0)) continue;
    const activatedAt = (await findActivationPostedAt(tx, c.id)) ?? input.now;
    const closed = await isPeriodClosedForBackdating(tx, activatedAt, finance.id);
    const postedAt = closed ? input.now : activatedAt;
    // วันนี้ก็ต้องเปิด (งวดเดือนปัจจุบันถูกปิดก่อนสิ้นเดือน = ปฏิเสธทั้งคำขอ — ข้อความจาก validatePeriodOpen)
    if (closed) await validatePeriodOpen(tx, postedAt, finance.id);
    const posted = await template.execute(
      {
        contractId: c.id, contractNumber: c.contractNumber, productId: c.productId,
        receivingId: receiving.id, grNumber: receiving.grNumber, amount,
        taxInvoiceNumber: taxInvoice.number, taxInvoiceDate: taxInvoice.date,
        postedAt, postedOnInvoiceDate: closed || undefined,
      },
      tx,
    );
    await tx.contract.update({
      where: { id: c.id },
      data: { inputVatStatus: 'CLAIMED', inputVatAmount: amount, inputVatJournalEntryId: posted.journalEntryId, inputVatReason: null },
    });
    claimed.push({ contractId: c.id, contractNumber: c.contractNumber, journalEntryNo: posted.entryNo, amount: amount.toFixed(2), postedOnInvoiceDate: closed });
    if (closed) {
      const created = await notifyAccountingPeriodClosed(tx, { contractNumber: c.contractNumber, grNumber: receiving.grNumber, poNumber: receiving.po.poNumber, entryNo: posted.entryNo, activatedAt, postedAt, amount, actorId: input.actorId });
      accountingNotified = accountingNotified || created;
    }
  }
  return { claimed, accountingNotified };
}

async function notifyAccountingPeriodClosed(
  tx: Prisma.TransactionClient,
  p: { contractNumber: string; grNumber: string; poNumber: string; entryNo: string; activatedAt: Date; postedAt: Date; amount: Decimal; actorId: string },
): Promise<boolean> {
  const key = inputVatPeriodTodoKey(p.contractNumber);
  const open = await tx.todo.findFirst({ where: { tags: { hasEvery: [INPUT_VAT_PERIOD_TODO_TAG, key] }, status: { not: 'DONE' }, deletedAt: null }, select: { id: true } });
  if (open) return false;
  const month = `${formatMonthName(p.activatedAt)} ${bangkokCalendarParts(p.activatedAt).year + 543}`;
  await tx.todo.create({
    data: {
      title: `ภาษีซื้อเครื่องขายผ่อน สัญญา ${p.contractNumber} ลงวันที่ ${formatDateShort(p.postedAt)} แทนวันเปิดสัญญา (งวด${month}ปิดแล้ว)`,
      description:
        `ใบกำกับภาษีของใบรับของ ${p.grNumber} (ใบสั่งซื้อ ${p.poNumber}) มาถึงหลังฝ่ายบัญชีปิดงวด${month} — ระบบลงรายการ ${p.entryNo} ` +
        `Dr 11-4101 / Cr 42-1108 ${p.amount.toFixed(2)} บาท วันที่ ${formatDateShort(p.postedAt)} แทนวันเปิดสัญญา ${formatDateShort(p.activatedAt)}\n` +
        'ตรวจว่าต้องปรับปรุงรายการหรือยื่น ภ.พ.30 เพิ่มเติมหรือไม่ — ระบบไม่ลงรายการปรับปรุงให้อัตโนมัติ',
      priority: 'MEDIUM',
      tags: [INPUT_VAT_PERIOD_TODO_TAG, key],
      createdById: p.actorId,
    },
  });
  return true;
}

/**
 * หลังตัวกวาดยกเลิกสัญญากระจก JE ทุกใบที่ stamp contractId (รวมใบภาษีซื้อนี้) → ตั้งสถานะบนสัญญาให้ตรงสมุด.
 * เรียกใน tx เดียวกับการยกเลิก **หลัง** `ContractCancellationTemplate.execute` / `ExchangeCancelReversalTemplate.reverse`
 */
export async function markInputVatReversedIfSwept(tx: Prisma.TransactionClient, contractId: string): Promise<'REVERSED' | 'UNCHANGED'> {
  const c = await tx.contract.findUnique({ where: { id: contractId }, select: { inputVatStatus: true, inputVatJournalEntryId: true } });
  if (!c) return 'UNCHANGED';
  if (c.inputVatStatus === 'PENDING_INVOICE') {
    await tx.contract.update({ where: { id: contractId }, data: { inputVatStatus: 'REVERSED', inputVatReason: CANCELED_BEFORE_INVOICE } });
    return 'REVERSED';
  }
  if (c.inputVatStatus !== 'CLAIMED' || !c.inputVatJournalEntryId) return 'UNCHANGED';
  const je = await tx.journalEntry.findUnique({ where: { id: c.inputVatJournalEntryId }, select: { metadata: true } });
  const meta = (je?.metadata ?? null) as Record<string, unknown> | null;
  if (meta?.reversed !== true) return 'UNCHANGED';
  await tx.contract.update({ where: { id: contractId }, data: { inputVatStatus: 'REVERSED' } });
  return 'REVERSED';
}
