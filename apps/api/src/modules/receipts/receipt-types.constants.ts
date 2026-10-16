/**
 * Receipt types that represent actual installment money (ค่างวด) — the single
 * source of truth for every "receipts of this installment" query.
 *
 * 'INSTALLMENT' = current writer; 'PAYMENT' = legacy rows predating the
 * receiptType split (column default). Everything else sharing a
 * paymentId/installmentNo (CREDIT_NOTE reversals, RESCHEDULE_FEE collects,
 * EARLY_PAYOFF, DOWN_PAYMENT) is a different document class and must not be
 * counted into partial sequences, cumulative amounts, or first-receipt
 * fee-display decisions. Mirrors EXCLUDED_TYPES in the web's
 * computeReceiptFeeDisplay.ts (inverse formulation).
 */
export const INSTALLMENT_MONEY_RECEIPT_TYPES = ['INSTALLMENT', 'PAYMENT'] as const;

/**
 * ใบรับเงินส่วนเกินจากลิงก์ชำระ Pay Solutions (PR4ข — ฝ่ายบัญชี 16/10/2569 ข้อ 23.2 แยกใบ): เงินที่เกินงวดถูกพักเป็น
 * เงินรับล่วงหน้าของสัญญา (รายการ `paysolutions-surplus-advance`) — หนึ่งใบต่อหนึ่งรายการ · paymentId/installmentNo ว่าง ·
 * เป็นใบกำกับภาษี (ภาษีรับรู้ ณ วันรับตั้งแต่ PR4) · ยกเลิกไม่ได้ (ไม่มีเส้นทางกลับรายการ — เงินพักใน 21-1103; ส่วนเกินเกิดเมื่อ
 * ทุกงวดจ่ายครบแล้ว จึงไม่มีงวดถัดไปให้หัก รอบกวาด ต6 ลงเป็นรายได้ 42-1106 วันถัดไป)
 */
export const ADVANCE_SURPLUS_RECEIPT_TYPE = 'ADVANCE_SURPLUS' as const;

/**
 * ใบที่ยอดคงเหลือ/สถานะสัญญาบนเอกสารอ่านจากประวัติบัญชี ณ วันออกใบ (receipt-document-balance.ts) แทนคอลัมน์
 * `remainingBalance` ที่คำนวณหยาบ ๆ ตอนออกใบ — ใบค่างวด · ใบปรับดิว · ใบส่วนเกินลิงก์ชำระ
 */
export const DOCUMENT_BALANCE_RECEIPT_TYPES = [
  ...INSTALLMENT_MONEY_RECEIPT_TYPES,
  'RESCHEDULE_FEE',
  ADVANCE_SURPLUS_RECEIPT_TYPE,
] as const;

