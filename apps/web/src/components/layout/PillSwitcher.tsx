import type { NavigationIcon } from '@/config/navigation-icons';
import { WORK_ZONE_ICONS } from '@/config/navigation-icons';
import { useNavigate } from 'react-router';
import { cn } from '@/lib/utils';
import { getWorkZoneHref, getZoneEntryPathForRole, type Zone } from '@/config/menu';
import { useAuth } from '@/contexts/AuthContext';

interface PillSwitcherProps {
  zones: Zone[];
  current: Zone;
}

const ZONE_META: Record<Exclude<Zone, 'settings'>, { label: string; icon: NavigationIcon }> = {
  shop: { label: 'งานหน้าร้าน', icon: WORK_ZONE_ICONS.shop },
  fin: { label: 'งานการเงิน', icon: WORK_ZONE_ICONS.fin },
};

export function PillSwitcher({ zones, current }: PillSwitcherProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Only render pills for shop+fin (settings is accessed via GearButton)
  const pillZones = zones.filter((z): z is 'shop' | 'fin' => z === 'shop' || z === 'fin');
  if (pillZones.length < 2) return null;

  return (
    <div className="px-3 pt-3 pb-1 shrink-0">
      <p className="mb-1.5 text-xs font-medium leading-snug text-muted-foreground">หมวดงาน</p>
      <div role="tablist" aria-label="หมวดงาน" className="flex gap-1 rounded-lg border border-sidebar-border bg-muted/40 p-1">
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
                'flex-1 flex items-center justify-center gap-1.5 min-h-11 px-1.5 py-1.5 rounded-md text-[12px] font-semibold leading-snug transition-colors duration-150',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-hover hover:text-foreground',
              )}
            >
              <Icon className="size-[18px]" aria-hidden="true" />
              <span>{meta.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
