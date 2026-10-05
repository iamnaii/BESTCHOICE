import { InputVatStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { bangkokDateString } from '../../../utils/date.util';
import { invoiceAgeMonths, receivingTaxInvoice } from './input-vat-eligibility';
import { canSeeInputVat } from './input-vat-visibility.util';

export interface ContractInputVatView {
  status: InputVatStatus;
  /** 2dp · null เมื่อ role ไม่มีสิทธิ์ (Q5) หรือไม่มียอด */
  amount: string | null;
  journalEntryNo: string | null;
  taxInvoice: { number: string; date: string; ageMonths: number } | null;
  grNumber: string | null;
  receivingId: string | null;
  poId: string | null;
  poNumber: string | null;
  reason: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface ViewClient {
  goodsReceivingItem: { findUnique: (args: any) => Promise<any> };
  journalEntry: { findUnique: (args: any) => Promise<any> };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
interface ContractForView {
  productId: string;
  inputVatStatus: InputVatStatus;
  inputVatAmount: Decimal | null;
  inputVatJournalEntryId: string | null;
  inputVatReason: string | null;
}

/** ก้อน `inputVat` ของ `GET /contracts/:id` — การ์ด "ภาษีซื้อของเครื่อง" 3 สถานะ (ยอดเฉพาะ OWNER/FM/ACCOUNTANT) */
export async function buildContractInputVatView(
  client: ViewClient,
  contract: ContractForView,
  role: string | undefined,
  now: Date = new Date(),
): Promise<ContractInputVatView> {
  const empty: ContractInputVatView = {
    status: contract.inputVatStatus, amount: null, journalEntryNo: null, taxInvoice: null,
    grNumber: null, receivingId: null, poId: null, poNumber: null, reason: contract.inputVatReason ?? null,
  };
  if (contract.inputVatStatus === 'NONE') return empty;
  const amount = contract.inputVatAmount != null && canSeeInputVat(role) ? new Decimal(contract.inputVatAmount.toString()).toFixed(2) : null;
  const item = await client.goodsReceivingItem.findUnique({
    where: { productId: contract.productId },
    select: { receiving: { select: {
      id: true, grNumber: true, supplierDocType: true, supplierDocNumber: true, supplierDocDate: true, taxInvoiceNumber: true, taxInvoiceDate: true,
      po: { select: { id: true, poNumber: true } },
    } } },
  });
  const gr = item?.receiving ?? null;
  const inv = gr ? receivingTaxInvoice(gr) : null;
  const je = contract.inputVatJournalEntryId
    ? await client.journalEntry.findUnique({ where: { id: contract.inputVatJournalEntryId }, select: { entryNumber: true } })
    : null;
  return {
    ...empty,
    amount,
    journalEntryNo: je?.entryNumber ?? null,
    taxInvoice: inv ? { number: inv.number, date: bangkokDateString(inv.date), ageMonths: invoiceAgeMonths(inv.date, now) } : null,
    grNumber: gr?.grNumber ?? null,
    receivingId: gr?.id ?? null,
    poId: gr?.po?.id ?? null,
    poNumber: gr?.po?.poNumber ?? null,
  };
}
