import type { CellStatus, TodayStatus } from '@/hooks/useAttendance';
import { statusView } from '../../attendance.util';

interface Props {
  status: CellStatus | TodayStatus;
  lateMinutes?: number;
  otHours?: number;
  className?: string;
}

/** ชิปสถานะ = ไอคอน + คำ ในองค์ประกอบเดียว (สีจาก token) */
export default function StatusChip({ status, lateMinutes = 0, otHours = 0, className = '' }: Props) {
  const view = statusView(status, lateMinutes, otHours);
  const Icon = view.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium leading-snug ${view.className} ${className}`}>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {view.label}
    </span>
  );
}
