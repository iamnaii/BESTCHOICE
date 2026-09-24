import { dayTimeOf, type TimelineItem } from './after-sales';

/**
 * ป้ายชนิดเหตุการณ์ (Step 4) — ผสมทั้ง AfterSalesEvent (RECEIVED/OUTCOME_SET/REPAIR_SENT/
 * REPAIR_DONE/REPAIR_SENT_BACK/DELIVERED/PHOTO_ADDED/CANCELLED/CLOSED/NOTE/LINE_*) และ
 * RepairStatusLog ที่ map เป็น `REPAIR_<toStatus>` — เฉพาะที่ brief ระบุชื่อไทยไว้เท่านั้น
 * ที่เหลือ (REPAIR_SENT ดิบ, REPAIR_DONE, DELIVERED, NOTE, REPAIR_CANCELLED, REPAIR_REPLACED)
 * ตกไปที่ fallback = คืน kind ดิบ (PR 3 จะเพิ่ม LINE_SENT/LINE_SKIPPED_NO_LINK ตัวเอง)
 *
 * Task 11 — 6 kind ใหม่ของ PR 2 (เปลี่ยนเครื่อง): APPROVED/REJECTED เป็นแถวจริงจาก
 * AfterSalesEvent (confirmSameModel/approvePriced เขียน APPROVED, rejectSameModel/rejectPriced
 * เขียน REJECTED) ส่วน EXCHANGE_REQUESTED/EXCHANGE_APPROVED/EXCHANGE_REJECTED/EXCHANGE_CANCELED
 * เป็นแถว synthesize ที่ query service (Task 7) แปลงจาก ContractExchangeRequest.createdAt/
 * approvedAt/rejectionReason/canceledAt ตอนอ่าน — ไม่ใช่ AfterSalesEventKind enum จริง
 */
const KIND_LABEL: Record<string, string> = {
  RECEIVED: 'รับเรื่อง',
  OUTCOME_SET: 'เลือกทางออก',
  REPAIR_IN_PROGRESS: 'ส่งซ่อม',
  REPAIR_READY_FOR_PICKUP: 'ซ่อมเสร็จ',
  REPAIR_CLOSED: 'ส่งมอบคืน',
  REPAIR_SENT_BACK: 'ส่งซ่อมต่อ',
  PHOTO_ADDED: 'เพิ่มรูป',
  CANCELLED: 'ยกเลิก',
  CLOSED: 'ปิดเคส',
  APPROVED: 'ยืนยัน/อนุมัติ',
  REJECTED: 'ปฏิเสธ',
  EXCHANGE_REQUESTED: 'ยื่นคำขอ',
  EXCHANGE_APPROVED: 'อนุมัติคำขอ',
  EXCHANGE_REJECTED: 'ปฏิเสธคำขอ',
  EXCHANGE_CANCELED: 'ยกเลิกคำขอ',
};

function labelOf(kind: string): string {
  if (kind.startsWith('LINE_')) return 'LINE';
  return KIND_LABEL[kind] ?? kind;
}

interface CaseTimelineProps {
  timeline: TimelineItem[];
  stale: boolean;
  daysInStage: number;
}

export default function CaseTimeline({ timeline, stale, daysInStage }: CaseTimelineProps) {
  const sorted = [...timeline].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <ol aria-label="ไทม์ไลน์เคส" className="space-y-0">
      {stale && (
        <li className="flex items-start gap-2.5 pb-3">
          <span aria-hidden className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-warning" />
          <p className="text-sm font-semibold leading-snug text-warning-strong">
            ค้าง {daysInStage} วัน — เกินเกณฑ์
          </p>
        </li>
      )}
      {sorted.map((item, index) => (
        <li
          key={`${item.kind}-${item.at}-${index}`}
          className="relative flex gap-2.5 pb-4 last:pb-0"
        >
          {index < sorted.length - 1 && (
            <span aria-hidden className="absolute left-[4px] top-3 h-full w-px bg-border" />
          )}
          <span
            aria-hidden
            className="relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary"
          />
          <div className="min-w-0 flex-1 text-sm leading-snug">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold text-foreground">{labelOf(item.kind)}</span>
              <span className="text-xs text-muted-foreground">{dayTimeOf(item.at)}</span>
              {item.actorName && (
                <span className="text-xs text-muted-foreground">· {item.actorName}</span>
              )}
            </div>
            {item.note && <p className="text-muted-foreground">{item.note}</p>}
          </div>
        </li>
      ))}
      {sorted.length === 0 && !stale && (
        <li className="text-sm leading-snug text-muted-foreground">ยังไม่มีความเคลื่อนไหว</li>
      )}
    </ol>
  );
}
