import { Badge } from '@/components/ui/badge';

export type RepairStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'READY_FOR_PICKUP'
  | 'CLOSED'
  | 'REPLACED'
  | 'CANCELLED';

const LABEL: Record<RepairStatus, string> = {
  OPEN: 'รับเข้า',
  IN_PROGRESS: 'กำลังซ่อม',
  READY_FOR_PICKUP: 'รอลูกค้ารับ',
  CLOSED: 'คืนแล้ว',
  REPLACED: 'เปลี่ยนแล้ว',
  CANCELLED: 'ยกเลิก',
};

type BadgeVariant = 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'outline';

const VARIANT: Record<RepairStatus, BadgeVariant> = {
  OPEN: 'primary',
  IN_PROGRESS: 'warning',
  READY_FOR_PICKUP: 'info',
  CLOSED: 'success',
  REPLACED: 'secondary',
  CANCELLED: 'outline',
};

export function RepairStatusBadge({ status }: { status: RepairStatus }) {
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>;
}
