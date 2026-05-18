import { Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

interface GearButtonProps {
  active: boolean;
  onClick: () => void;
}

export function GearButton({ active, onClick }: GearButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="ตั้งค่ากลาง"
      aria-pressed={active}
      className={cn(
        'flex items-center gap-2.5 w-full px-4 py-2.5 border-t border-sidebar-border text-[13px] font-semibold leading-snug transition-colors duration-150',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-hover'
      )}
    >
      <Settings className="size-4 shrink-0" aria-hidden="true" />
      <span>ตั้งค่ากลาง</span>
    </button>
  );
}
