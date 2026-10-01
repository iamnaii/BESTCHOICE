/**
 * ป้ายของรายการใบเสร็จ (หน้ารับชำระ → แท็บใบเสร็จ · หน้าตรวจสอบใบเสร็จ).
 * ใบค่างวดที่ระบบออกใช้ประเภท INSTALLMENT (PAYMENT = ใบรุ่นเก่า).
 * ช่องทาง ONLINE_GATEWAY / CREDIT_BALANCE มีใบเสร็จตั้งแต่ PR3 (เงินเข้าทางลิงก์ชำระ · ใช้เครดิตชำระ) —
 * ข้อความชุดเดียวกับใบเสร็จ PDF (apps/api/src/modules/receipts/services/receipt-pdf.service.ts)
 */
export const RECEIPT_TYPE_LABELS: Record<string, string> = {
  INSTALLMENT: 'งวดผ่อนชำระ',
  PAYMENT: 'งวดผ่อนชำระ',
  DOWN_PAYMENT: 'เงินดาวน์',
  EARLY_PAYOFF: 'ปิดก่อนกำหนด',
  CREDIT_NOTE: 'ใบลดหนี้',
  RESCHEDULE_FEE: 'ปรับดิว',
};

export const RECEIPT_METHOD_LABELS: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  QR_EWALLET: 'QR/E-Wallet',
  CARD: 'บัตร (EDC)',
  ONLINE_GATEWAY: 'ชำระออนไลน์',
  CREDIT_BALANCE: 'ใช้ยอดเครดิตในสัญญา',
};

/**
 * ป้ายประเภทใบในรายการใบเสร็จของลูกค้า (LIFF "ใบเสร็จของฉัน") — ใบค่างวดที่ระบบออกใช้ประเภท INSTALLMENT
 * (PR3: ใบของเงินที่เข้าทางลิงก์ชำระและการใช้เครดิตเริ่มปรากฏในรายการนี้)
 */
export const LIFF_RECEIPT_TYPE_LABELS: Record<
  string,
  { label: string; variant: 'success' | 'info' | 'secondary' }
> = {
  INSTALLMENT: { label: 'ค่างวด', variant: 'success' },
  PAYMENT: { label: 'ค่างวด', variant: 'success' },
  DOWN_PAYMENT: { label: 'เงินดาวน์', variant: 'info' },
  EARLY_PAYOFF: { label: 'ปิดยอด', variant: 'info' },
  CREDIT_NOTE: { label: 'ใบลดหนี้', variant: 'secondary' },
  RESCHEDULE_FEE: { label: 'ปรับดิว', variant: 'info' },
};
