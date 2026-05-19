import { Badge } from '@/components/ui/badge';
import { Shield, ShieldAlert, ShieldOff, ShieldCheck } from 'lucide-react';

export type WarrantyStatus =
  | 'IN_7DAY_DEFECT'
  | 'IN_SHOP_WARRANTY'
  | 'IN_MANUFACTURER'
  | 'OUT_OF_WARRANTY'
  | 'WALK_IN';

const LABEL: Record<WarrantyStatus, string> = {
  IN_7DAY_DEFECT: 'ในประกัน 7 วัน (Defect)',
  IN_SHOP_WARRANTY: 'ในประกันร้าน 60 วัน',
  IN_MANUFACTURER: 'ในประกันศูนย์',
  OUT_OF_WARRANTY: 'นอกประกัน',
  WALK_IN: 'ลูกค้าใหม่ (ไม่ผูก)',
};

const ICON: Record<WarrantyStatus, React.ComponentType<{ className?: string }>> = {
  IN_7DAY_DEFECT: ShieldAlert,
  IN_SHOP_WARRANTY: ShieldCheck,
  IN_MANUFACTURER: ShieldCheck,
  OUT_OF_WARRANTY: ShieldOff,
  WALK_IN: Shield,
};

type BadgeVariant = 'primary' | 'secondary' | 'warning' | 'outline';

const VARIANT: Record<WarrantyStatus, BadgeVariant> = {
  IN_7DAY_DEFECT: 'warning',
  IN_SHOP_WARRANTY: 'primary',
  IN_MANUFACTURER: 'primary',
  OUT_OF_WARRANTY: 'secondary',
  WALK_IN: 'outline',
};

export function WarrantyBadge({ status }: { status: WarrantyStatus }) {
  const Icon = ICON[status];
  return (
    <Badge variant={VARIANT[status]} className="gap-1">
      <Icon className="h-3 w-3" />
      {LABEL[status]}
    </Badge>
  );
}
