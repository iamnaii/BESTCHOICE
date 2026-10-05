/**
 * ก้อน 5 — ภาษีซื้อของเครื่องที่ขายผ่อน (สมุด FINANCE เคลม Dr 11-4101 / Cr 42-1108) — กระจกของกติกาฝั่ง API
 * (`journal/input-vat/input-vat-visibility.util.ts` · `goods-receiving-tax-invoice.service.ts`)
 */
export type InputVatStatus = 'NONE' | 'NOT_ELIGIBLE' | 'PENDING_INVOICE' | 'CLAIMED' | 'REVERSED';

export interface ContractInputVat {
  status: InputVatStatus;
  /** 2dp · null = ไม่มีสิทธิ์เห็น (Q5) หรือไม่มียอด */
  amount: string | null;
  journalEntryNo: string | null;
  taxInvoice: { number: string; date: string; ageMonths: number } | null;
  grNumber: string | null;
  receivingId: string | null;
  poId: string | null;
  poNumber: string | null;
  reason: string | null;
}

/** Q5 — ใครเห็นตัวเลขภาษีซื้อ (allow-list ตรงกับ API) */
export const INPUT_VAT_ROLES = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'] as const;
export const canSeeInputVat = (role?: string | null): boolean => !!role && (INPUT_VAT_ROLES as readonly string[]).includes(role);
/** Q1 — ใครบันทึกใบกำกับภาษีที่มาทีหลังได้ */
export const canRecordTaxInvoice = (role?: string | null): boolean => ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'].includes(role ?? '');
/** Q1 — ใครแก้ใบกำกับที่บันทึกแล้วได้ */
export const canEditTaxInvoice = (role?: string | null): boolean => ['OWNER', 'ACCOUNTANT'].includes(role ?? '');
/** อายุใบกำกับที่ขึ้นป้ายเตือน (แสดงอย่างเดียว ไม่บล็อก — ฝ่ายบัญชียืนยัน 2 ครั้ง) */
export const INPUT_VAT_AGE_WARN_MONTHS = 6;
