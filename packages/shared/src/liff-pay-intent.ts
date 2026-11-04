import type { LiffPaymentLinkData } from './liff-types';

/** ส่วนของ `GET /line-oa/pay/:token` ที่หน้า `/pay/:token` ใช้ตัดสินว่าจะส่งอะไรไป `POST /paysolutions/create-intent` */
export type LiffPayIntentSource = Pick<LiffPaymentLinkData, 'token' | 'amount' | 'purpose'> & {
  contract: Pick<LiffPaymentLinkData['contract'], 'id' | 'contractNumber'>;
  payment: { installmentNo: number } | null;
};

/** body ของ `POST /paysolutions/create-intent` ที่หน้า `/pay/:token` (`LiffPayment.tsx`) ส่ง */
export interface LiffPayIntentRequest {
  contractId: string;
  amount: number;
  description: string;
  lineId?: string;
  /** ลิงก์ `INSTALLMENT` เท่านั้น — server เทียบยอดกับยอดคงค้างของงวดนี้ */
  installmentNo?: number;
  /** ลิงก์อื่นทั้งหมด (`PAYOFF` / `AMOUNT`) — server ใช้ยอดของลิงก์นี้ (ยอดใน body ต้องตรง) */
  paymentLinkToken?: string;
}

/**
 * สิ่งที่หน้า `/pay/:token` ส่งไปสร้างรายการชำระ — ที่เดียว (หน้าเว็บและสเปค DB ของฝั่ง API เรียกตัวนี้ตัวเดียว)
 *
 * Task 39 — ตัดสินจาก**ข้อมูลของลิงก์** (`purpose`) ไม่ใช่จากยอด (เดิม "ยอด > ค่างวดที่ผูก + ค่าปรับ + 0.5 = หลายงวด" ⇒ ลิงก์ยอดนัด
 * 1,000 / ยอดค้างรวมแจ้งล็อก 1,615.83 ถูกส่งเป็นงวดเดียวแล้ว intent ปฏิเสธ "ยอดชำระไม่ตรง"):
 * - `INSTALLMENT` → ส่ง `installmentNo` ของงวดที่ผูก (body เดิมทุกตัวอักษร) — server เทียบยอดกับยอดคงค้างของงวดนั้น
 * - อื่น ๆ → ไม่ส่ง `installmentNo` · ส่ง `paymentLinkToken` — server ใช้ยอดของลิงก์ที่เก็บไว้ (ยอดใน body ต้องตรง)
 */
export function liffPayIntentRequest(
  link: LiffPayIntentSource,
  lineId: string | undefined,
): LiffPayIntentRequest {
  const base = {
    contractId: link.contract.id,
    amount: Number(link.amount),
    description: `ชำระค่างวด สัญญา ${link.contract.contractNumber}`,
    lineId,
  };
  return link.purpose === 'INSTALLMENT'
    ? { ...base, installmentNo: link.payment?.installmentNo }
    : { ...base, paymentLinkToken: link.token };
}
