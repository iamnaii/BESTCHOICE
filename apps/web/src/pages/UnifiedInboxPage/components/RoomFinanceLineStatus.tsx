import { CircleCheck, Info, Unlink } from 'lucide-react';
import { formatThaiDate } from '@/lib/date';
import { cn } from '@/lib/utils';

/**
 * Task 33 (mockup A2/A3 "อินบ็อกซ์ — สถานะ LINE การเงิน" ที่เจ้าของอนุมัติ) — สถานะ LINE การเงินของห้องจาก server
 * (`financeLineStatus` ของ `GET /staff-chat/rooms` + `/rooms/:id` — **ไม่มี LINE user id**):
 * - `verified` = กติกาเดียวกับข้อความสำเร็จรูปของห้องการเงิน (แถว OTP ของ LINE ห้องนี้เป็นของลูกค้าของห้อง)
 * - ไม่ verified + `unlinkedAt` = LINE นี้เคยยืนยันกับลูกค้าของห้องแล้วหลุด (ยกเลิกผูก / ลูกค้าเปลี่ยน LINE) → ป้าย "ยกเลิกผูกแล้ว"
 * - ไม่ verified + ไม่มีวันที่ (ไม่เคยผูก LINE นี้กับลูกค้านี้) — **ไม่อยู่ใน mockup** ⇒ ไม่แสดงอะไร (หน้าตาเดิม — รอเจ้าของตัดสิน)
 * ถ้อยคำตาม `A2Unlinked.dc.html` / `A3Verified.dc.html` · สถานะบอกด้วยไอคอน + คำ ไม่ใช่สีอย่างเดียว
 */
export interface FinanceLineRoomStatus {
  verified: boolean;
  unlinkedAt: string | null;
}

/** ห้องที่ต้องขึ้นป้าย "ยกเลิกผูกแล้ว" (A2) */
export function isFinanceLineUnlinked(
  status: FinanceLineRoomStatus | null | undefined,
): status is FinanceLineRoomStatus & { unlinkedAt: string } {
  return !!status && !status.verified && !!status.unlinkedAt;
}

/** ข้อความแนะนำที่พนักงานกดแทรกในช่องพิมพ์ได้ (ทางของลูกค้าเอง — บอทการเงินตอบการ์ด "เริ่มยืนยันตัวตน" ให้ LINE ที่ยังไม่ผูกทุกข้อความ) */
export const FINANCE_LINE_SUGGESTED_REPLY =
  'รบกวนพิมพ์ข้อความอะไรก็ได้ในแชทนี้ แล้วกดปุ่ม “เริ่มยืนยันตัวตน” ในการ์ดที่ระบบตอบกลับนะคะ';

/** ป้าย "ยกเลิกผูกแล้ว" — ใช้ทั้งแถวรายชื่อแชท (ป้ายแรก) และหัวห้อง · ไอคอน + คำ ไม่ตัดบรรทัด */
export function FinanceLineUnlinkedPill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-warning/40 bg-warning/10 px-2 text-xs font-semibold leading-snug text-warning-strong',
        className,
      )}
    >
      <Unlink className="size-3 shrink-0" aria-hidden="true" />
      ยกเลิกผูกแล้ว
    </span>
  );
}

/**
 * หัวห้อง: A2 = ป้าย "ยกเลิกผูกแล้ว" (ข้างชื่อ) · A3 = "ยืนยัน OTP แล้ว" (บรรทัดสถานะ — ผู้เรียกวางตามตำแหน่งของ mockup) ·
 * ไม่เคยผูก / ช่องอื่น = ไม่แสดง
 */
export function FinanceLineRoomHeaderBadge({
  status,
}: {
  status: FinanceLineRoomStatus | null | undefined;
}) {
  if (isFinanceLineUnlinked(status)) return <FinanceLineUnlinkedPill className="px-2.5" />;
  if (status?.verified) {
    return (
      <span className="inline-flex items-center gap-1 font-medium leading-snug text-primary">
        <CircleCheck className="size-3.5 shrink-0" aria-hidden="true" />
        ยืนยัน OTP แล้ว
      </span>
    );
  }
  return null;
}

/** A2 — คำอธิบายหนึ่งบรรทัดใต้หัวห้อง */
export function FinanceLineUnlinkedNote({
  status,
  customerName,
}: {
  status: FinanceLineRoomStatus | null | undefined;
  customerName: string;
}) {
  if (!isFinanceLineUnlinked(status)) return null;
  return (
    <div
      role="note"
      className="flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-[13px] leading-snug text-foreground lg:px-5"
    >
      <Unlink className="size-4 shrink-0 text-warning-strong" aria-hidden="true" />
      <span>
        LINE นี้ยกเลิกผูกกับ {customerName} แล้วเมื่อ {formatThaiDate(status.unlinkedAt)} —{' '}
        <strong className="font-semibold">คนที่คุยในห้องนี้อาจไม่ใช่ลูกค้าคนนี้</strong>
      </span>
    </div>
  );
}

/**
 * A2 — บรรทัดเตือนเหนือกรอบพิมพ์: อยู่ในลำดับปกติของหน้า (ไม่ลอยทับช่องพิมพ์ตอนโฟกัส) · ไม่บล็อกการพิมพ์ ·
 * ผู้เรียกผูก `id` เข้ากับ `aria-describedby` ของช่องพิมพ์ · ปุ่ม "แทรกข้อความแนะนำ" ส่งข้อความแนะนำให้ช่องพิมพ์ (พนักงานแก้ก่อนส่งได้)
 */
export function FinanceLineComposerCaution({
  id,
  status,
  onInsert,
}: {
  id: string;
  status: FinanceLineRoomStatus | null | undefined;
  onInsert: (text: string) => void;
}) {
  if (!isFinanceLineUnlinked(status)) return null;
  return (
    <div
      role="note"
      id={id}
      className="mb-2 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] leading-snug text-foreground"
    >
      <Info className="mt-0.5 size-4 shrink-0 text-warning-strong" aria-hidden="true" />
      <div className="flex min-w-0 flex-col items-start gap-1">
        <span>
          <strong className="font-semibold text-warning-strong">ห้องนี้ยังไม่ยืนยันตัวตน</strong>{' '}
          ตอบได้ แต่อย่าพิมพ์ยอดค้าง เลขสัญญา หรือข้อมูลส่วนตัว ·{' '}
          <strong className="font-semibold">ขั้นต่อไป:</strong> ขอให้เขาส่งข้อความอะไรก็ได้ในแชท
          LINE น้องเบสนี้ แล้วกด “เริ่มยืนยันตัวตน” ในการ์ดที่บอทตอบกลับ
        </span>
        <button
          type="button"
          onClick={() => onInsert(FINANCE_LINE_SUGGESTED_REPLY)}
          className="inline-flex min-h-11 items-center rounded-md px-1 text-xs font-medium text-primary underline underline-offset-2 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:min-h-9"
        >
          แทรกข้อความแนะนำ
        </button>
      </div>
    </div>
  );
}
