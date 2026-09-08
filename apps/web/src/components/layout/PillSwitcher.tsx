import { ShoppingCart, CircleDollarSign } from 'lucide-react';
import { useNavigate } from 'react-router';
import { cn } from '@/lib/utils';
import { getWorkZoneHref, getZoneEntryPathForRole, type Zone } from '@/config/menu';
import { useAuth } from '@/contexts/AuthContext';

interface PillSwitcherProps {
  zones: Zone[];
  current: Zone;
}

const ZONE_META: Record<Exclude<Zone, 'settings'>, { label: string; icon: typeof ShoppingCart }> = {
  shop: { label: 'งานหน้าร้าน', icon: ShoppingCart },
  fin: { label: 'งานการเงิน', icon: CircleDollarSign },
};

export function PillSwitcher({ zones, current }: PillSwitcherProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Only render pills for shop+fin (settings is accessed via GearButton)
  const pillZones = zones.filter((z): z is 'shop' | 'fin' => z === 'shop' || z === 'fin');
  if (pillZones.length < 2) return null;

  return (
    <div className="px-3 py-2.5 border-b border-sidebar-border bg-card">
      <p className="mb-1.5 text-xs font-medium leading-snug text-muted-foreground">หมวดงาน</p>
      <div role="tablist" aria-label="หมวดงาน" className="flex gap-1.5">
        {pillZones.map((zone) => {
          const meta = ZONE_META[zone];
          const Icon = meta.icon;
          const active = current === zone;
          return (
            <button
              key={zone}
              type="button"
              role="tab"
              aria-label={`${meta.label} (${zone === 'shop' ? 'SHOP' : 'FINANCE'})`}
              aria-selected={active}
              onClick={() => {
                if (zone !== current) {
                  navigate(getWorkZoneHref(getZoneEntryPathForRole(user?.role ?? '', zone), zone));
                }
              }}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 min-h-11 px-2 py-1.5 rounded-lg text-[12px] font-semibold leading-snug transition-colors duration-150',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground border border-border hover:text-foreground',
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              <span>{meta.label}<span className="block text-[10px] font-normal">{zone === 'shop' ? 'SHOP' : 'FINANCE'}</span></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
