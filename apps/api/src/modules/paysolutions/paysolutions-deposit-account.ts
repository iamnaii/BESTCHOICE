import type { Prisma } from '@prisma/client';

/** บัญชีรับเงินของ Pay Solutions เมื่อไม่ได้ตั้งค่า — กสิกรไทย (คำตัดสินเจ้าของ #45 · 2026-11-03) */
export const PAYSOLUTIONS_DEFAULT_DEPOSIT_ACCOUNT = '11-1201';

/**
 * คำตัดสินเจ้าของ #45 — บัญชีรับเงิน (ขา Dr) ของเงินที่เข้าทาง Pay Solutions **ทุกทาง** ตัดสินที่นี่ที่เดียว:
 * บัญชีของช่องทาง `QR` ค่าเริ่มต้นใน `PaymentMethodConfig` (ค่าตั้งเดียวที่มีอยู่ — หน้าตั้งค่าช่องทางรับเงิน · seed ของ migration
 * `20260808000000` = 11-1201 "PaySolutions deposits here") · ไม่มีแถว = 11-1201
 *
 * ผู้เรียก (ห้ามมีชุดที่สอง): webhook ลิงก์ชำระ/QR ไลน์ — ใบรับชำระงวด (FIFO) · รายการเงินส่วนเกิน · ปิดยอดก่อนกำหนด (JP4 · Task 41) ·
 * แถว Payment ของทางเหล่านั้น (`depositAccountCode`) · QR แบ่งชำระ / QR ปรับดิวของพนักงาน (`handlePartialPaymentCallback`)
 * — เดิม webhook ใช้ค่าคงที่ 11-1202 ขณะที่ QR ของพนักงานอ่านค่าตั้งนี้ (เงินเข้าเดียวกันลงสองบัญชี)
 */
export async function resolvePaySolutionsDepositAccount(
  client: Pick<Prisma.TransactionClient, 'paymentMethodConfig'>,
): Promise<string> {
  const qrDefault = await client.paymentMethodConfig.findFirst({
    where: { method: 'QR', isDefault: true, enabled: true, deletedAt: null },
    select: { accountCode: true },
  });
  return qrDefault?.accountCode ?? PAYSOLUTIONS_DEFAULT_DEPOSIT_ACCOUNT;
}
