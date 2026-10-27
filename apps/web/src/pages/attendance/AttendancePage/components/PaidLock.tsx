import { AlertTriangle, Lock } from 'lucide-react';
import { useAccountingPermissions } from '@/hooks/useAccountingPermissions';
import { thaiMonthLabel } from '../../attendance.util';

/** ชิป "จ่ายเงินเดือนแล้ว" — ไอคอน + คำ (ไม่ใช้สีอย่างเดียว) · `id` ให้ปุ่มที่ถูกปิดอ้างผ่าน aria-describedby */
export function PaidChip({ number, id }: { number: string; id?: string }) {
  return (
    <span id={id} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs leading-snug text-foreground">
      <Lock className="size-3 shrink-0" aria-hidden="true" />
      <span>จ่ายเงินเดือนแล้ว</span>
      <span className="text-muted-foreground">· ใบ {number}</span>
    </span>
  );
}

/** แบนเนอร์บอกว่าเดือนนี้มีคนที่จ่ายเงินเดือนแล้วกี่คน ในใบอะไร (mockup บอร์ด 5) */
export function PaidBanner({ month, numbers, people }: { month: string; numbers: string[]; people: number }) {
  if (people === 0) return null;
  return <PaidBannerBody month={month} numbers={numbers} people={people} />;
}

/** แยกออกมาเพื่อเรียก useAccountingPermissions เฉพาะตอนมีคนจ่ายแล้ว */
function PaidBannerBody({ month, numbers, people }: { month: string; numbers: string[]; people: number }) {
  const permissions = useAccountingPermissions();
  // ปุ่ม "ยกเลิก / กลับรายการ" ในใบเงินเดือนมีเฉพาะผู้ถือสิทธิ์ EXPENSE_CANCEL — คนอื่นต้องให้เจ้าของทำ
  // รอให้โหลดสิทธิ์เสร็จก่อน (ไม่งั้นเจ้าของเห็นประโยคของคนไม่มีสิทธิ์แวบหนึ่ง และ role=status ประกาศซ้ำ)
  const settled = permissions.fetchStatus === 'idle';
  const reversal = !settled ? null : permissions.can('EXPENSE_CANCEL') ? 'ถ้ากลับรายการใบเงินเดือน เดือนนี้แก้ได้อีก' : 'ถ้าเจ้าของกลับรายการใบเงินเดือน เดือนนี้แก้ได้อีก';
  return (
    <div role="status" aria-atomic="true" aria-label="เดือนที่จ่ายเงินเดือนแล้ว" className="flex items-start gap-2 rounded-xl border border-border bg-muted px-4 py-3 text-sm leading-snug">
      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="flex flex-col gap-0.5">
        <b>จ่ายเงินเดือน {thaiMonthLabel(month)} แล้ว {people} คน — ใบ {numbers.join(', ')}</b>
        <span className="text-muted-foreground">แก้เวลา หรือเปลี่ยนประเภทวันของคนเหล่านี้ในเดือนนี้ไม่ได้แล้ว (เจ้าของยังล้างธงเครื่องถูกใช้ซ้อนได้) — ถ้าต้องปรับยอด ให้ใส่รายการปรับปรุงในใบเงินเดือนงวดถัดไป{reversal && ` · ${reversal}`}</span>
      </div>
    </div>
  );
}

export const distinctNumbers = (rows: Array<{ paidDocumentNumber?: string | null }>): string[] =>
  [...new Set(rows.flatMap((r) => (r.paidDocumentNumber ? [r.paidDocumentNumber] : [])))];

/** เดือนที่มีคนจ่ายแล้วบางคน: คนที่ยังไม่อยู่ในใบเงินเดือนแก้ได้ (board 5) — ไอคอน + คำ */
export function UnpaidChip({ editable }: { editable: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs leading-snug text-warning-strong">
      <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />ยังไม่อยู่ในใบเงินเดือน{editable && ' — แก้ได้'}
    </span>
  );
}
