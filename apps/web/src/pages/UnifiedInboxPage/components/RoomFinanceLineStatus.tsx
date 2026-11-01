import { CircleCheck, Info, ShieldAlert, Unlink } from 'lucide-react';
import { formatThaiDate } from '@/lib/date';
import { cn } from '@/lib/utils';

/**
 * Task 33 (mockup A2/A3 + A4 "อินบ็อกซ์ — สถานะ LINE การเงิน" ที่เจ้าของอนุมัติ) — สถานะ LINE การเงินของห้องจาก server
 * (`financeLineStatus` ของ `GET /staff-chat/rooms` + `/rooms/:id` — **ไม่มี LINE user id** · ห้องช่องอื่น/ไม่มีลูกค้าจริง = null):
 * - `verified` = กติกาเดียวกับข้อความสำเร็จรูปของห้องการเงิน (แถว OTP ของ LINE ห้องนี้เป็นของลูกค้าของห้อง) → A3 "ยืนยัน OTP แล้ว"
 * - ไม่ verified + `unlinkedAt` = LINE นี้เคยยืนยันกับลูกค้าของห้องแล้วหลุด (ยกเลิกผูก / ลูกค้าเปลี่ยน LINE) → A2 "ยกเลิกผูกแล้ว"
 * - ไม่ verified + ไม่มีวันที่ = พนักงานผูกห้องกับลูกค้าจริงแต่ LINE นี้ไม่เคยยืนยัน OTP → A4 "ยังไม่ยืนยันตัวตน"
 *   (fix round 1 — คำตัดสินเจ้าของข้อ 28 · 1 พ.ย.)
 * ถ้อยคำตาม `A2Unlinked` / `A3Verified` / `A4NotVerified.dc.html` · สถานะบอกด้วยไอคอน + คำ ไม่ใช่สีอย่างเดียว
 */
export interface FinanceLineRoomStatus {
  verified: boolean;
  unlinkedAt: string | null;
}

export type FinanceLineRoomKind = 'verified' | 'unlinked' | 'not_verified';

/** สามสถานะของห้อง (A3 / A2 / A4) · ไม่มีสถานะ (ช่องอื่น/ไม่มีลูกค้าจริง) = null */
export function financeLineRoomKind(
  status: FinanceLineRoomStatus | null | undefined,
): FinanceLineRoomKind | null {
  if (!status) return null;
  if (status.verified) return 'verified';
  return status.unlinkedAt ? 'unlinked' : 'not_verified';
}

/** คำของสถานะ (ตรงกับป้าย) — ใช้ประกอบชื่อปุ่ม/ข้อความสำหรับโปรแกรมอ่านจอ · ไม่มีสถานะ = null */
export function financeLineRoomLabel(
  status: FinanceLineRoomStatus | null | undefined,
): string | null {
  const kind = financeLineRoomKind(status);
  if (kind === 'verified') return 'ยืนยัน OTP แล้ว';
  if (kind === 'unlinked') return 'ยกเลิกผูกแล้ว';
  if (kind === 'not_verified') return 'ยังไม่ยืนยันตัวตน';
  return null;
}

/** ห้องที่ต้องขึ้นป้าย "ยกเลิกผูกแล้ว" (A2) */
export function isFinanceLineUnlinked(
  status: FinanceLineRoomStatus | null | undefined,
): status is FinanceLineRoomStatus & { unlinkedAt: string } {
  return financeLineRoomKind(status) === 'unlinked';
}

/** ห้องที่คนที่คุยอาจไม่ใช่ลูกค้าของห้อง (A2 + A4) — ป้ายในแถว · คำอธิบายใต้หัวห้อง · บรรทัดเตือนเหนือกรอบพิมพ์ */
export function needsFinanceLineCaution(status: FinanceLineRoomStatus | null | undefined): boolean {
  const kind = financeLineRoomKind(status);
  return kind === 'unlinked' || kind === 'not_verified';
}

/** ข้อความแนะนำที่พนักงานกดแทรกในช่องพิมพ์ได้ (ทางของลูกค้าเอง — บอทการเงินตอบการ์ด "เริ่มยืนยันตัวตน" ให้ LINE ที่ยังไม่ผูกทุกข้อความ) */
export const FINANCE_LINE_SUGGESTED_REPLY =
  'รบกวนพิมพ์ข้อความอะไรก็ได้ในแชทนี้ แล้วกดปุ่ม “เริ่มยืนยันตัวตน” ในการ์ดที่ระบบตอบกลับนะคะ';

const PILL = {
  unlinked: { Icon: Unlink, label: 'ยกเลิกผูกแล้ว' },
  not_verified: { Icon: ShieldAlert, label: 'ยังไม่ยืนยันตัวตน' },
} as const;

/**
 * ป้าย A2 "ยกเลิกผูกแล้ว" / A4 "ยังไม่ยืนยันตัวตน" — ใช้ทั้งแถวรายชื่อแชท (ป้ายแรก) และหัวห้อง · ไอคอน + คำ ไม่ตัดบรรทัด ·
 * ห้องอื่น (ยืนยันแล้ว/ไม่มีสถานะ) = ไม่แสดง
 */
export function FinanceLineRoomPill({
  status,
  className,
}: {
  status: FinanceLineRoomStatus | null | undefined;
  className?: string;
}) {
  const kind = financeLineRoomKind(status);
  if (kind !== 'unlinked' && kind !== 'not_verified') return null;
  const { Icon, label } = PILL[kind];
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-warning/40 bg-warning/10 px-2 text-xs font-semibold leading-snug text-warning-strong',
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}

/** A3 — "ยืนยัน OTP แล้ว" (ไอคอน + คำ) */
function FinanceLineVerifiedLabel() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium leading-snug text-primary">
      <CircleCheck className="size-3.5 shrink-0" aria-hidden="true" />
      ยืนยัน OTP แล้ว
    </span>
  );
}

/**
 * หัวห้อง: A2/A4 = ป้ายข้างชื่อ · A3 = "ยืนยัน OTP แล้ว" (จอใหญ่วางในบรรทัดสถานะตาม mockup · มือถือวางข้างชื่อ — ผู้เรียกเลือกตำแหน่ง) ·
 * ไม่มีสถานะ = ไม่แสดง
 */
export function FinanceLineRoomHeaderBadge({
  status,
}: {
  status: FinanceLineRoomStatus | null | undefined;
}) {
  const kind = financeLineRoomKind(status);
  if (kind === 'verified') return <FinanceLineVerifiedLabel />;
  if (kind) return <FinanceLineRoomPill status={status} className="px-2.5" />;
  return null;
}

/** A2/A4 — คำอธิบายหนึ่งบรรทัดใต้หัวห้อง */
export function FinanceLineRoomNote({
  status,
  customerName,
}: {
  status: FinanceLineRoomStatus | null | undefined;
  customerName: string;
}) {
  const kind = financeLineRoomKind(status);
  if (kind !== 'unlinked' && kind !== 'not_verified') return null;
  const Icon = PILL[kind].Icon;
  return (
    <div
      role="note"
      className="flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-[13px] leading-snug text-foreground lg:px-5"
    >
      <Icon className="size-4 shrink-0 text-warning-strong" aria-hidden="true" />
      <span>
        {kind === 'unlinked'
          ? `LINE นี้ยกเลิกผูกกับ ${customerName} แล้วเมื่อ ${formatThaiDate(status!.unlinkedAt)}`
          : `ห้องนี้ผูกกับ ${customerName} โดยพนักงาน แต่ LINE นี้ยังไม่เคยยืนยันตัวตนด้วยรหัส OTP`}{' '}
        — <strong className="font-semibold">คนที่คุยในห้องนี้อาจไม่ใช่ลูกค้าคนนี้</strong>
      </span>
    </div>
  );
}

/**
 * A2/A4 — บรรทัดเตือนเหนือกรอบพิมพ์ (ชุดเดียวกันทั้งสองสถานะ): อยู่ในลำดับปกติของหน้า (ไม่ลอยทับช่องพิมพ์ตอนโฟกัส) · ไม่บล็อกการพิมพ์ ·
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
  if (!needsFinanceLineCaution(status)) return null;
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
