import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * คำขอคืนเงินที่ "อนุมัติแล้วแต่ยังไม่ได้บันทึกผลธนาคาร" (`Refund.status = APPROVED`) — กติกาเดียวของคำตัดสินเจ้าของ #24 (2026-10-31):
 * ขณะสัญญามีคำขอแบบนี้ **ห้ามปิดยอดก่อนกำหนด (JP4) และห้ามยืนยันรับเครื่องคืน/ยึด (JP5)** เพราะเมื่อธนาคารคืนเงินแล้ว `markReversed`
 * จะกลับรายการรับชำระและคืนงวดเป็นค้างบนสัญญาที่ปิดไปแล้ว (Task 28 M1 — `contractClosedAtProcessing` คงไว้เป็นตาข่าย)
 *
 * ทางเคลียร์ที่มีจริงวันนี้ (`refunds.controller.ts`): `POST /refunds/:id/mark-reversed` (คืนสำเร็จ) / `POST /refunds/:id/mark-failed`
 * (คืนไม่สำเร็จ — ปิดคำขอ) · `@Roles('OWNER', 'FINANCE_MANAGER')` + สิทธิ์ "อนุมัติคืนเงินเข้าบัญชี" (`REFUND` — `refundActor`) ·
 * **เว็บไม่มีหน้าจอคืนเงิน** (ค้น `apps/web` ไม่พบผู้เรียก `/refunds`) ⇒ ข้อความชี้ฝ่ายบัญชี/ทีมระบบ แบบเดียวกับ
 * `RECEIPT_NOT_ISSUED_REFUND_MESSAGE` ไม่อ้างปุ่มที่ไม่มี
 *
 * ผู้ใช้ทุกจุดเรียกไฟล์นี้ — ห้ามเขียนชุดที่สอง:
 * - JP4 ด่านที่ผูกมัด: `ContractPaymentService.earlyPayoff` ในธุรกรรมของการลง (หลังล็อกแถวสัญญา) — ครอบทางคิวอนุมัติ · สลิปตรง · managed
 * - JP4 ด่านต้นทาง (บอกก่อนเสียเวลา): สร้างคำขออนุมัติ (`createEarlyPayoffRequest`) · ตรวจสลิป (`EarlyPayoffSlipService.verify`,
 *   managed `ManagedPayoffEvidenceService`) · LIFF ยอดปิด/ลิงก์ปิดยอด · PaySolutions `createPaymentIntent` แบบไม่ระบุงวด
 *   (ลิงก์ที่ปิดหลายงวด) — **webhook ไม่ตรวจ** (เงินตัดที่ gateway แล้ว · แบบเดียวกับกติกา "ห้ามข้ามงวด" ที่บังคับตอนส่ง QR)
 * - JP5: `RepossessionsService.createInTx` (หลังล็อกแถวสัญญา) + `previewCalculation` (`eligibility`)
 * - อีกฝั่งของการแข่ง: `RefundsService.approveRefund` ล็อกแถวสัญญา FOR SHARE ก่อนอ่านสถานะ ⇒ ทุกลำดับปลอดภัย แต่ด้วยกลไกต่างกัน
 *   (review m-a · ปักด้วย DB สองคอนเนกชันจริง `__tests__/pending-bank-refund-race.db.spec.ts`):
 *   ปิดมาก่อน → อนุมัติที่รอล็อก (Serializable) ได้ 40001 จากคำสั่ง raw = P2010 → 409 · กดใหม่ = 400 สัญญาปิด ·
 *   อนุมัติมาก่อน + JP4 (Serializable) → ปิดยอดได้ล็อกแล้วอ่านด้วย snapshot เดิม (ยังไม่เห็นคำขอ) แต่ SSI ยกเลิกตอนเขียน → ลองใหม่ = 400 ·
 *   อนุมัติมาก่อน + JP5 (Read Committed) → รอล็อกแล้วอ่านใหม่ เห็นคำขอ APPROVED → 400
 */
export interface PendingBankRefund {
  id: string;
  amount: Prisma.Decimal;
  installmentNo: number;
}

export type PendingBankRefundAction = 'EARLY_PAYOFF' | 'REPOSSESSION';

const ACTION_LABEL: Record<PendingBankRefundAction, string> = {
  EARLY_PAYOFF: 'ปิดยอดก่อนกำหนด',
  REPOSSESSION: 'ยืนยันรับเครื่องคืน/ยึดเครื่อง',
};

/** ข้อความถึงลูกค้า (LIFF / ลิงก์ชำระ) — ไม่มีศัพท์ภายในหรือ role */
export const PENDING_BANK_REFUND_CUSTOMER_MESSAGE =
  'ยังปิดยอดผ่าน LINE ไม่ได้ในขณะนี้ — สัญญานี้มีรายการคืนเงินที่รอธนาคารดำเนินการ กรุณาติดต่อสาขาหรือเจ้าหน้าที่';

export async function findPendingBankRefunds(
  client: Pick<Prisma.TransactionClient, 'refund'>,
  contractId: string,
): Promise<PendingBankRefund[]> {
  const rows = await client.refund.findMany({
    where: { contractId, status: 'APPROVED', deletedAt: null },
    orderBy: { approvedAt: 'asc' },
    select: { id: true, amount: true, payment: { select: { installmentNo: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    amount: r.amount,
    installmentNo: r.payment.installmentNo,
  }));
}

/** ข้อความถึงพนักงาน: เหตุผล + คำขอที่ค้าง (งวด · ยอด) + ทางเคลียร์ที่มีจริง + role ที่ทำได้ */
export function pendingBankRefundMessage(
  refunds: readonly PendingBankRefund[],
  action: PendingBankRefundAction,
): string {
  const items = refunds
    .map((r) => `งวดที่ ${r.installmentNo} ${r.amount.toFixed(2)} บาท`)
    .join(', ');
  return (
    `สัญญานี้มีคำขอคืนเงินที่อนุมัติแล้วแต่ยังไม่ได้บันทึกผลจากธนาคาร (${items}) — ${ACTION_LABEL[action]}ตอนนี้ไม่ได้ ` +
    'เพราะเมื่อบันทึกว่าธนาคารคืนเงินแล้ว ระบบจะยกเลิกการรับชำระของงวดนั้นบนสัญญาที่ปิดไปแล้ว · ' +
    'ให้เจ้าของ (OWNER) หรือผู้จัดการการเงิน (FINANCE_MANAGER) ที่มีสิทธิ์ "อนุมัติคืนเงินเข้าบัญชี" บันทึกผลธนาคารของคำขอนี้ก่อน — ' +
    'คืนสำเร็จ หรือคืนไม่สำเร็จ (ปิดคำขอ) · ยังไม่มีปุ่มในหน้าจอ แจ้งฝ่ายบัญชีให้ทีมระบบบันทึก แล้วจึงทำรายการนี้อีกครั้ง'
  );
}

/** ด่าน: มีคำขอที่รอผลธนาคาร → 400 (พนักงาน = ข้อความเต็ม · ลูกค้า = ข้อความลูกค้า) */
export async function assertNoPendingBankRefund(
  client: Pick<Prisma.TransactionClient, 'refund'>,
  contractId: string,
  action: PendingBankRefundAction,
  audience: 'staff' | 'customer' = 'staff',
): Promise<void> {
  const pending = await findPendingBankRefunds(client, contractId);
  if (pending.length === 0) return;
  throw new BadRequestException(
    audience === 'customer'
      ? PENDING_BANK_REFUND_CUSTOMER_MESSAGE
      : pendingBankRefundMessage(pending, action),
  );
}
