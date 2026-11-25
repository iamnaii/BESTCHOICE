import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PillProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  /** ปรับระยะ/ตัวเลขเฉพาะจุด — สีและความสูงมาจากตัวปุ่มเอง */
  className?: string;
}

/** ปุ่มกดเลือกของหน้ารวมสินค้า (`aria-pressed`) — ตัวที่เลือกอยู่พื้นเขียวเข้มตัวขาว · สูง 44px */
export function Pill({ active, onClick, children, className }: PillProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'min-h-11 px-4 py-1.5 font-head text-sm font-medium rounded-full transition-colors leading-snug whitespace-nowrap',
        active
          ? 'bg-ink text-ink-foreground font-semibold'
          : 'bg-card text-accent-foreground ring-1 ring-inset ring-border hover:bg-muted',
        className,
      )}
    >
      {children}
    </button>
  );
}
