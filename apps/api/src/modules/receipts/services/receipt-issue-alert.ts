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
