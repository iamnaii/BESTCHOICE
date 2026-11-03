/**
 * ผลของปุ่ม "ส่ง LINE" / ส่งรวดของคิวทวงถาม (`POST /overdue/:id/send-line-adhoc` · `POST /overdue/bulk/send-line`) — Task 34 ข้อ 2:
 * `sent` = ส่งถึงแล้วเท่านั้น · `notSent` = สัญญาที่ไม่ได้ส่ง (ถูกระงับ / รอเวลาทำการ / ส่งไม่ผ่านแล้วเข้าคิวส่งซ้ำ) พร้อมเหตุผลภาษาไทยจาก API
 * (ข้อความชุดเดียว `apps/api/src/modules/notifications/send-outcome.ts` — หน้าเว็บแสดงตามที่ได้ ไม่แปลเอง)
 */
export interface LineSendNotSent {
  contractId: string;
  contractNumber: string;
  reason: string;
  reasonText: string;
}

export interface LineSendResult {
  sent: number;
  failed: number;
  total: number;
  /** API ก่อน Task 34 ไม่ส่งช่องนี้ */
  notSent?: LineSendNotSent[];
}

/** สัญญาที่ไม่ได้ส่ง รวมตามเหตุผล — บรรทัดละเหตุผล "<เหตุผล> (<เลขสัญญา>, …)" ตามลำดับที่พบ */
export function describeNotSent(notSent: readonly LineSendNotSent[]): string {
  const byReason = new Map<string, string[]>();
  for (const n of notSent) {
    const list = byReason.get(n.reasonText) ?? [];
    list.push(n.contractNumber);
    byReason.set(n.reasonText, list);
  }
  return [...byReason].map(([text, numbers]) => `${text} (${numbers.join(', ')})`).join('\n');
}

/**
 * เหตุผลที่ "ยังไม่ได้ส่ง แต่ระบบจะส่งเอง" (Task 34 รีวิว M6) — นอกเวลาทำการ (แถวรอเวลาที่คิวส่งซ้ำส่งให้) · ส่ง LINE ไม่ผ่านแล้วเข้าคิวส่งซ้ำ ·
 * ไม่ใช่ข้อผิดพลาด ⇒ แจ้งด้วย toast เตือน · รหัสตรงกับ `NotSentReason` ของ API (`send-outcome.ts`)
 */
const SEND_LATER_REASONS: ReadonlySet<string> = new Set(['OUTSIDE_HOURS', 'DELIVERY_FAILED']);

export function willSendLater(n: Pick<LineSendNotSent, 'reason'>): boolean {
  return SEND_LATER_REASONS.has(n.reason);
}
