import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { LINE_GROUP_REASON_LABEL, lineGroupLabel, type GfinLineGroupStatus } from './gfin';

/** บรรทัดสถานะกลุ่มไลน์ปลายทาง — สถานะต้องมีไอคอน+ข้อความ ไม่ใช่สีอย่างเดียว (frontend.md) */
export default function GfinLineGroupLine({ status }: { status: GfinLineGroupStatus | null }) {
  const name = lineGroupLabel(status);
  if (status?.ready) {
    return <p className="m-0 flex items-center gap-1 text-xs leading-snug"><CheckCircle2 className="size-3.5 shrink-0 text-primary" aria-hidden />{name} · พร้อมส่งด้วยบอท</p>;
  }
  const reason = status?.reason ?? 'NOT_LINKED';
  return (
    <>
      <p className="m-0 flex items-center gap-1 text-xs leading-snug"><AlertTriangle className="size-3.5 shrink-0 text-warning-strong" aria-hidden />{name}</p>
      <p className="m-0 mt-0.5 text-xs leading-snug text-warning-strong">{LINE_GROUP_REASON_LABEL[reason]} · ใช้ "คัดลอกข้อความ + ลิงก์" ไปก่อนได้</p>
    </>
  );
}
