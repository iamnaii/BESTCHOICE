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

const VARIANT: Record<RepairStatus, 'default' | 'secondary' | 'outline'> = {
  OPEN: 'default',
  IN_PROGRESS: 'default',
  READY_FOR_PICKUP: 'default',
  CLOSED: 'secondary',
  REPLACED: 'secondary',
  CANCELLED: 'outline',
};

export function RepairStatusBadge({ status }: { status: RepairStatus }) {
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>;
}
