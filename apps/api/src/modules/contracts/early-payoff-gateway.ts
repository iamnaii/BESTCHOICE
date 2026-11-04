import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * ลูกค้าปิดยอดเองผ่าน QR ในไลน์ (Task 41 · คำตัดสินเจ้าของ #43 — แบบเดียวกับสลิปตรงของ 2026-09-24: ยอดตรง = ไม่ผ่านคิวอนุมัติ) — ทางเข้าที่สาม
 * ของ earlyPayoff() คู่กับคิวอนุมัติและสลิปตรง. ผู้เรียกเดียวคือ webhook PaySolutions (`PaySolutionsWebhookService`) หลัง claim แถวติดตาม intent
 * ปิดยอด — JP4 ลง**ในธุรกรรม Serializable ของ webhook** (`tx` — ก้อนเดียวกับการ claim ลิงก์: ส่งซ้ำจบที่ claim · ล้ม = rollback ทั้งก้อน) ·
 * ยอดปิดสดใน tx ต้องตรงเงินที่รับ ±0.01 (ไม่ตรง = `GatewayPayoffMismatchError` → webhook ถอยเป็น FIFO + งานแจ้ง) · ไม่มีพนักงานกด ⇒ ไม่ตรวจ
 * `assertUnmanagedPayoffActor` (`userId` = ผู้ใช้ OWNER ของระบบที่ webhook ใช้ลงรายการรับชำระอยู่แล้ว — เป็น FK ของแถวเท่านั้น) · งานหลัง commit
 * (สัญญาณเตือน · ใบ EARLY_PAYOFF · journey) ส่งผ่าน `onCommit` ให้ webhook เรียกหลัง `$transaction` คืนค่า
 */
export interface GatewayMatchAuthorization {
  /** ธุรกรรมของ webhook ที่ claim แถวติดตามแล้ว */
  tx: Prisma.TransactionClient;
  /** เงินที่ PaySolutions แจ้งว่ารับ (`total`) */
  paidAmount: Prisma.Decimal;
  refno: string;
  transactionId: string | null;
  /** id ของแถวติดตาม intent ปิดยอด (`PaymentLink`) */
  paymentLinkId: string;
  /** ยอดปิดที่ server คำนวณตอนสร้าง intent (snapshot บนแถวติดตาม) — บันทึกใน audit เทียบกับยอดปิด ณ เวลาที่เงินเข้า */
  quoteSnapshot: { totalPayoff: string; discountPct: number; quoteDate: string };
  webhookData: Record<string, string>;
  /** งานหลัง commit ของการปิดยอด — webhook เรียกตามลำดับหลังธุรกรรม commit */
  onCommit: (work: () => Promise<void>) => void;
}

/** ยอดปิดสด ณ เวลาที่เงินเข้าไม่ตรงเงินที่รับผ่าน PaySolutions (±0.01) — webhook ถอยเป็น FIFO + งานแจ้ง (ไม่ใช่ error ถึงผู้ใช้) */
export class GatewayPayoffMismatchError extends ConflictException {
  constructor(
    readonly liveTotalPayoff: number,
    readonly paidAmount: string,
  ) {
    super('ยอดที่ชำระผ่าน Pay Solutions ไม่ตรงยอดปิดสัญญา ณ เวลาที่เงินเข้า');
  }
}
