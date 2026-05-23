import { ShoppingCart, CircleDollarSign } from 'lucide-react';
import { useNavigate } from 'react-router';
import { cn } from '@/lib/utils';
import { ZONE_LANDING, type Zone } from '@/config/menu';

interface PillSwitcherProps {
  zones: Zone[];
  current: Zone;
  onSwitch: (zone: Zone) => void;
}

const ZONE_META: Record<Exclude<Zone, 'settings'>, { label: string; icon: typeof ShoppingCart }> = {
  shop: { label: 'หน้าร้าน', icon: ShoppingCart },
  fin: { label: 'ไฟแนนซ์', icon: CircleDollarSign },
};

export function PillSwitcher({ zones, current, onSwitch }: PillSwitcherProps) {
  const navigate = useNavigate();
  // Only render pills for shop+fin (settings is accessed via GearButton)
  const pillZones = zones.filter((z): z is 'shop' | 'fin' => z === 'shop' || z === 'fin');
  if (pillZones.length < 2) return null;

  return (
    <div
      role="tablist"
      aria-label="สลับโหมดหน้าร้าน/ไฟแนนซ์"
      className="flex gap-1.5 px-3 py-2.5 border-b border-sidebar-border bg-card"
    >
      {pillZones.map((zone) => {
        const meta = ZONE_META[zone];
        const Icon = meta.icon;
        const active = current === zone;
        return (
          <button
            key={zone}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              if (zone !== current) {
                onSwitch(zone);
                navigate(ZONE_LANDING[zone]);
              }
            }}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[12px] font-semibold leading-snug transition-colors duration-150',
              active
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground border border-border hover:text-foreground'
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            <span>{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}
