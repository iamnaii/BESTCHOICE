import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatThaiDate } from '@/lib/date';
import { formatNumberDecimal } from '@/utils/formatters';

export type AccrualMode = '2B_ONLY' | 'CONSOLIDATED_PAYING_AHEAD' | 'CONSOLIDATED_BACKFILL';
/** รายการ 2A ที่จะลง: ทั้งงวด / เท่ายอดที่รับ (ใบบางส่วนก่อนวันครบกำหนด) / ส่วนที่เหลือของงวด */
export type AccrualPortion = 'FULL' | 'PARTIAL' | 'REMAINDER';

const BANGKOK = 'Asia/Bangkok';

/**
 * ป้ายอธิบายสถานะการตั้งลูกหนี้งวด (2A) ของงวดที่กำลังรับชำระ.
 * งวดที่ยังตั้งไม่ครบจะถูกตั้งลูกหนี้งวดในการบันทึกเดียวกัน (คำตัดสินฝ่ายบัญชี 2026-09-28 + ก1 2026-09-29):
 * รับก่อนครบกำหนด = ลงวันที่รับเงิน · รับในหรือหลังวันครบกำหนด = ลงวันครบกำหนด · ใบบางส่วนก่อนครบกำหนด
 * ตั้งเท่ายอดที่รับ · ใบที่ทำให้งวดครบตั้งส่วนที่เหลือ.
 * ชำระผ่าน QR: รายการลงเมื่อผู้ให้บริการยืนยันว่าเงินเข้า — ป้ายจึงไม่บอกวันที่จากหน้าจอ.
 */
export function AccrualModeChip({
  mode,
  dueDate,
  accrualPostedAt,
  viaGateway = false,
  portion = 'FULL',
  accrualAmount,
  accruedBefore,
}: {
  mode: AccrualMode;
  dueDate?: string;
  /** วันที่ที่รายการ 2A จะถูกลง (ISO) — มาจาก preview ฝั่ง server */
  accrualPostedAt?: string;
  /** เลือกชำระผ่าน QR — วันที่ลงรายการคือวันที่เงินเข้าจริง ไม่ใช่วันที่บนหน้าจอ */
  viaGateway?: boolean;
  /** รายการ 2A ที่จะลง (server: accrualPortion) — ไม่ส่ง = ทั้งงวด */
  portion?: AccrualPortion;
  /** ยอด Dr 11-2103 ของรายการ 2A ที่จะลง (server: accrualAmount) */
  accrualAmount?: string;
  /** ยอดที่ตั้งลูกหนี้งวดไปแล้วก่อนรายการนี้ (server: accruedBefore) */
  accruedBefore?: string;
}) {
  if (mode === '2B_ONLY') return null;

  const dueLabel = dueDate ? formatThaiDate(new Date(dueDate), BANGKOK) : '';
  const postedLabel = accrualPostedAt ? formatThaiDate(new Date(accrualPostedAt), BANGKOK) : '';
  const amountLabel = accrualAmount ? formatNumberDecimal(accrualAmount) : '';
  const accruedLabel = accruedBefore ? formatNumberDecimal(accruedBefore) : '';
  const isAhead = mode === 'CONSOLIDATED_PAYING_AHEAD';
  const dateKind = isAhead ? '(วันที่รับเงิน)' : '(วันครบกำหนด)';

  const detail = (() => {
    if (portion === 'PARTIAL') {
      return viaGateway
        ? `เมื่อลูกค้าจ่ายผ่าน QR ระบบจะตั้งลูกหนี้งวด (2A) เท่ายอดที่รับ ${amountLabel} บาท ลงวันที่เงินเข้าจริง ` +
            'แล้วลงรับชำระ (2B) ในคราวเดียวกัน — ถ้าเงินเข้าตั้งแต่วันครบกำหนด ระบบตั้งลูกหนี้งวดของงวดนี้ไปแล้วในวันครบกำหนด ' +
            'จึงลงเฉพาะรับชำระ (2B)'
        : `เมื่อบันทึก ระบบจะตั้งลูกหนี้งวด (2A) เท่ายอดที่รับ ${amountLabel} บาท ลงวันที่ ${postedLabel} (วันที่รับเงิน) ` +
            'แล้วลงรับชำระ (2B) ในคราวเดียวกัน — ดอกเบี้ยและภาษีขายตามสัดส่วนของยอดนี้รับรู้ ณ วันที่ดังกล่าว ' +
            'ส่วนที่เหลือของงวดตั้งเมื่อรับชำระครบ หรือเมื่อถึงวันครบกำหนด';
    }
    if (portion === 'REMAINDER') {
      return viaGateway
        ? `เมื่อลูกค้าจ่ายผ่าน QR ระบบจะตั้งลูกหนี้งวด (2A) ส่วนที่เหลือของงวด ${amountLabel} บาท ลงวันที่เงินเข้าจริง ` +
            '(ถ้าเงินเข้าหลังวันครบกำหนด จะลงวันครบกำหนด) แล้วลงรับชำระ (2B) ในคราวเดียวกัน — ' +
            'วันที่อาจไม่ตรงกับวันที่ที่เลือกบนหน้านี้'
        : `เมื่อบันทึก ระบบจะตั้งลูกหนี้งวด (2A) ส่วนที่เหลือของงวด ${amountLabel} บาท (ตั้งไปแล้ว ${accruedLabel} บาท) ` +
            `ลงวันที่ ${postedLabel} ${dateKind} แล้วลงรับชำระ (2B) ในคราวเดียวกัน — ` +
            'ดอกเบี้ยและภาษีขายส่วนที่เหลือของงวดนี้รับรู้ ณ วันที่ดังกล่าว';
    }
    return viaGateway
      ? 'เมื่อลูกค้าจ่ายผ่าน QR ระบบจะตั้งลูกหนี้งวด (2A) เต็มงวด ลงวันที่เงินเข้าจริง ' +
          '(ถ้าเงินเข้าหลังวันครบกำหนด จะลงวันครบกำหนด) แล้วลงรับชำระ (2B) ในคราวเดียวกัน — ' +
          'วันที่อาจไม่ตรงกับวันที่ที่เลือกบนหน้านี้'
      : `เมื่อบันทึก ระบบจะตั้งลูกหนี้งวด (2A) เต็มงวด ลงวันที่ ${postedLabel} ` +
          `${dateKind} แล้วลงรับชำระ (2B) ในคราวเดียวกัน — ` +
          'ดอกเบี้ยและภาษีขายของงวดนี้รับรู้ ณ วันที่ดังกล่าว';
  })();

  const headline = isAhead
    ? portion === 'PARTIAL'
      ? `ลูกค้าจ่ายล่วงหน้าบางส่วน · งวดนี้ครบกำหนด ${dueLabel}`
      : `ลูกค้าจ่ายล่วงหน้า · งวดนี้ครบกำหนด ${dueLabel}`
    : portion === 'REMAINDER'
      ? `งวดนี้ถึงกำหนดแล้ว (${dueLabel}) แต่ยังตั้งลูกหนี้งวดไม่ครบ`
      : `งวดนี้ถึงกำหนดแล้ว (${dueLabel}) แต่ยังไม่ได้ตั้งลูกหนี้งวด`;

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
        <div className="font-medium">{headline}</div>
        <div className="text-[11px] opacity-80">{detail}</div>
      </div>
    </div>
  );
}
