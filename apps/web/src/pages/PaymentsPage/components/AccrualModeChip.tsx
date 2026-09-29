import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatThaiDate } from '@/lib/date';

export type AccrualMode = '2B_ONLY' | 'CONSOLIDATED_PAYING_AHEAD' | 'CONSOLIDATED_BACKFILL';

const BANGKOK = 'Asia/Bangkok';

/**
 * ป้ายอธิบายสถานะการตั้งลูกหนี้งวด (2A) ของงวดที่กำลังรับชำระ.
 * งวดที่ยังไม่มี 2A จะถูกตั้งลูกหนี้งวดในการบันทึกเดียวกัน (คำตัดสินฝ่ายบัญชี 2026-09-28):
 * รับก่อนครบกำหนด = ลงวันที่รับเงิน · รับในหรือหลังวันครบกำหนด = ลงวันครบกำหนด.
 * ชำระผ่าน QR: รายการลงเมื่อผู้ให้บริการยืนยันว่าเงินเข้า — ป้ายจึงไม่บอกวันที่จากหน้าจอ.
 */
export function AccrualModeChip({
  mode,
  dueDate,
  accrualPostedAt,
  viaGateway = false,
}: {
  mode: AccrualMode;
  dueDate?: string;
  /** วันที่ที่รายการ 2A จะถูกลง (ISO) — มาจาก preview ฝั่ง server */
  accrualPostedAt?: string;
  /** เลือกชำระผ่าน QR — วันที่ลงรายการคือวันที่เงินเข้าจริง ไม่ใช่วันที่บนหน้าจอ */
  viaGateway?: boolean;
}) {
  if (mode === '2B_ONLY') return null;

  const dueLabel = dueDate ? formatThaiDate(new Date(dueDate), BANGKOK) : '';
  const postedLabel = accrualPostedAt ? formatThaiDate(new Date(accrualPostedAt), BANGKOK) : '';
  const isAhead = mode === 'CONSOLIDATED_PAYING_AHEAD';
  const detail = viaGateway
    ? 'เมื่อลูกค้าจ่ายผ่าน QR ระบบจะตั้งลูกหนี้งวด (2A) เต็มงวด ลงวันที่เงินเข้าจริง ' +
      '(ถ้าเงินเข้าหลังวันครบกำหนด จะลงวันครบกำหนด) แล้วลงรับชำระ (2B) ในคราวเดียวกัน — ' +
      'วันที่อาจไม่ตรงกับวันที่ที่เลือกบนหน้านี้'
    : `เมื่อบันทึก ระบบจะตั้งลูกหนี้งวด (2A) เต็มงวด ลงวันที่ ${postedLabel} ` +
      `${isAhead ? '(วันที่รับเงิน)' : '(วันครบกำหนด)'} แล้วลงรับชำระ (2B) ในคราวเดียวกัน — ` +
      'ดอกเบี้ยและภาษีขายของงวดนี้รับรู้ ณ วันที่ดังกล่าว';

  return (
    <div
      className={cn(
        'mb-3 rounded-lg border p-2.5 text-xs leading-snug flex gap-2',
        isAhead
          ? 'border-primary/30 bg-primary/5 text-primary'
          : 'border-warning/30 bg-warning/5 text-warning-strong',
      )}
    >
      <Info className="size-3.5 shrink-0 mt-0.5" />
      <div className="space-y-0.5">
        <div className="font-medium">
          {isAhead
            ? `ลูกค้าจ่ายล่วงหน้า · งวดนี้ครบกำหนด ${dueLabel}`
            : `งวดนี้ถึงกำหนดแล้ว (${dueLabel}) แต่ยังไม่ได้ตั้งลูกหนี้งวด`}
        </div>
        <div className="text-[11px] opacity-80">{detail}</div>
      </div>
    </div>
  );
}
