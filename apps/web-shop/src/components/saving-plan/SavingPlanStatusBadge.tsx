import { Badge } from '@/components';
import type { SavingPlanStatus } from '@/types/saving-plan';

const statuses = {
  ACTIVE: { label: 'กำลังออม', variant: 'primary' },
  COMPLETED: { label: 'ออมครบแล้ว', variant: 'success' },
  APPLIED: { label: 'นำไปใช้ดาวน์แล้ว', variant: 'default' },
  CANCELLED: { label: 'ยกเลิก', variant: 'outline' },
} as const;

export default function SavingPlanStatusBadge({
  status,
  size,
}: {
  status: SavingPlanStatus;
  size: 'sm' | 'md';
}) {
  const config = statuses[status];
  return (
    <Badge variant={config?.variant} size={size}>
      {config?.label}
    </Badge>
  );
}
