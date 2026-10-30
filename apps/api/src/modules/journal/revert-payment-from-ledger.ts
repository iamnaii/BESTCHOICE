import { Prisma } from '@prisma/client';
import { reconstructPriorCleared } from './reconstruct-prior';

/**
 * คืนแถวงวด (`Payment`) หลังกลับรายการรับชำระของงวด — ตัวเดียวของยกเลิกใบเสร็จ (`receipt-void-core.ts`) และคืนเงิน
 * (`RefundsService.markReversed`) · เรียก**หลัง**ลงรายการกลับแล้ว (ต้นฉบับต้องมี `metadata.reversed = true` ก่อนอ่าน)
 *
 * `amountPaid` = ยอดที่ยังล้างลูกหนี้ของงวดอยู่ในบัญชี (`reconstructPriorCleared` ของแถวตารางงวด — Cr 11-2103 + ค่าปรับ 42-1103
 * ของรายการที่ยังมีผล) ไม่ใช่ 0 ตายตัว: บางส่วนของ `amountPaid` ไม่ได้มาจากใบเสร็จที่ถูกกลับ —
 * - รอบกลางคืนหักเงินรับล่วงหน้า / เงินพักปรับดิวเข้างวด (`advance-consume-on-accrual` / `reschedule-park-consume` — ไม่มี `paymentId`)
 * - marker ยอดรับก่อนวันตัดของงวดที่นำเข้าจากระบบเก่า (`legacy-prior-receipt` — ไม่มี `paymentId`)
 * ตั้ง 0 ⇒ ทะเบียนค้างเกินลูกหนี้ในบัญชีเท่ายอดนั้น และใบรับชำระเต็มงวดใบถัดไปชนเกณฑ์ ≤ 1 บาท
 *
 * สถานะ: ยังเหลือยอด → `PARTIALLY_PAID` · ไม่เหลือ → `OVERDUE` เมื่อเลยวันครบกำหนดแล้ว ไม่งั้น `PENDING` (ฝั่งอ่านไม่เทียบ
 * วันครบกำหนดเอง — รอบเปลี่ยนเป็น OVERDUE รันครั้งถัดไป) · `paidDate` = null · งวดที่ไม่มีแถวตารางงวด = ไม่เหลือยอด
 */
export type PaymentLedgerRevert = {
  /** แถวตารางงวดของงวด — ผู้เรียกใช้ต่อ (กลับรายการตั้งลูกหนี้งวด ณ วันรับเงิน) · ไม่มีแถว = null */
  scheduleId: string | null;
  survivingPaid: Prisma.Decimal;
  fullyReverted: boolean;
  status: 'OVERDUE' | 'PENDING' | 'PARTIALLY_PAID';
};

export async function revertPaymentFromLedger(
  tx: Prisma.TransactionClient,
  payment: {
    id: string;
    contractId: string;
    installmentNo: number;
    amountDue: Prisma.Decimal.Value;
    dueDate: Date;
  },
): Promise<PaymentLedgerRevert> {
  let survivingPaid = new Prisma.Decimal(0);
  const schedule = await tx.installmentSchedule.findUnique({
    where: {
      contractId_installmentNo: {
        contractId: payment.contractId,
        installmentNo: payment.installmentNo,
      },
    },
    select: { id: true },
  });
  if (schedule) {
    const prior = await reconstructPriorCleared(
      tx,
      schedule.id,
      new Prisma.Decimal(payment.amountDue),
    );
    survivingPaid = prior.priorPrincipalCleared.plus(prior.priorLateFeeBooked);
  }
  const fullyReverted = survivingPaid.lte(0);
  const status = fullyReverted
    ? payment.dueDate < new Date()
      ? 'OVERDUE'
      : 'PENDING'
    : 'PARTIALLY_PAID';
  await tx.payment.update({
    where: { id: payment.id },
    data: {
      status,
      amountPaid: fullyReverted ? 0 : survivingPaid,
      paidDate: null,
    },
  });
  return { scheduleId: schedule?.id ?? null, survivingPaid, fullyReverted, status };
}
