import { Shield, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface WarrantyWindows {
  sevenDayDefect: number | null;
  shopWarranty: number | null;
  mfrWarranty: number | null;
}

interface WindowRowProps {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  daysRemaining: number | null;
  totalDays: number;
}

function windowColor(daysRemaining: number | null, totalDays: number): string {
  if (daysRemaining === null) return 'text-muted-foreground';
  if (daysRemaining === 0) return 'text-red-600';
  const pct = daysRemaining / totalDays;
  if (pct > 0.3) return 'text-emerald-600';
  return 'text-amber-600';
}

function WindowRow({ label, icon: Icon, daysRemaining, totalDays }: WindowRowProps) {
  const color = windowColor(daysRemaining, totalDays);
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className={cn('h-3.5 w-3.5', color)} />
        {label}
      </span>
      <span className={cn('font-medium', color)}>
        {daysRemaining === null
          ? '—'
          : daysRemaining === 0
            ? 'หมดประกัน'
            : `เหลือ ${daysRemaining} วัน`}
      </span>
    </div>
  );
}

export function WarrantyWindowCard({ windows }: { windows: WarrantyWindows }) {
  return (
    <Card className="p-4 space-y-1">
      <WindowRow
        label="รับเครื่อง 7 วัน"
        icon={ShieldAlert}
        daysRemaining={windows.sevenDayDefect}
        totalDays={7}
      />
      <WindowRow
        label="ประกันร้าน 60 วัน"
        icon={ShieldCheck}
        daysRemaining={windows.shopWarranty}
        totalDays={60}
      />
      <WindowRow
        label="ประกันศูนย์"
        icon={Shield}
        daysRemaining={windows.mfrWarranty}
        totalDays={365}
      />
    </Card>
  );
}
