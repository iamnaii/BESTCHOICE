import * as Sentry from '@sentry/nestjs';

/** ทางที่ออกใบเสร็จหลังธุรกรรมเงิน commit (PR3) */
export type PostCommitReceiptPath = 'auto-allocate' | 'apply-credit' | 'paysolutions-webhook';

export interface ReceiptIssueFailure {
  path: PostCommitReceiptPath;
  contractId: string;
  paymentId: string;
  installmentNo: number;
  /** เลขที่รายการรับชำระของงวด — ใช้ออกใบซ้ำ (generateReceipt คืนใบเดิมถ้ารายการนี้มีใบแล้ว) */
  journalEntryNumber: string | null;
  // ค่าที่เหลือของการออกใบซ้ำ (final review I3(c)) — อาร์กิวเมนต์เดียวกับที่ทางนั้นส่งให้ generateReceipt
  /** ช่องทางของใบ — ช่องทางของการกระจายเงินอยู่ที่นี่และที่ payments.payment_method เท่านั้น */
  paymentMethod: string;
  /** ยอดของใบ (สตริง 2 ตำแหน่ง) — ต้องเท่า metadata.receiptTax.amount ของรายการพอดี ไม่งั้นใบไม่เก็บค่าและพิมพ์แบบเดิม */
  amount: string;
  /** เลขอ้างอิงธุรกรรม — ลิงก์ชำระ: transaction_id หรือ refno · กระจายเงิน / ใช้เครดิต: null */
  transactionRef: string | null;
  /** ผู้ออกใบ — ผู้บันทึกรับเงิน (กระจายเงิน / ใช้เครดิต) · ผู้ใช้ OWNER ของระบบ (ลิงก์ชำระ) */
  issuedById: string;
  /** วันที่รับเงินที่ใบต้องลง (ISO) */
  paidDate: string;
}

/**
 * ใบเสร็จที่ออกไม่สำเร็จหลังเงินลงบัญชีแล้ว (PR3): ส่ง Sentry ระดับ error พร้อมข้อมูลที่ต้องใช้ออกใบซ้ำ
 * (.claude/rules/accounting.md หัวข้อ "ออกใบเสร็จซ้ำ") — logger.error อย่างเดียวไม่ถึง Sentry.
 * ไม่ใช้ emitDeferredWarnings ของ PR2ข เพราะตัวนั้นส่งระดับ warning เท่านั้น. ไม่ throw ไม่ว่ากรณีใด —
 * การรับเงินที่ commit แล้วต้องไม่ล้มเพราะการแจ้งเตือน
 */
export function reportReceiptIssueFailure(error: unknown, failure: ReceiptIssueFailure): void {
  try {
    Sentry.captureException(error, {
      level: 'error',
      tags: { module: 'receipts', action: 'post-commit-receipt-failed', path: failure.path },
      extra: { ...failure },
    });
  } catch {
    // การแจ้งเตือนห้ามทำให้งานที่ commit แล้วล้ม
  }
}
