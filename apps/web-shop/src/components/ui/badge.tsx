import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full font-medium leading-snug whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-zinc-100 text-zinc-800',
        primary: 'bg-emerald-100 text-emerald-900',
        // Small white text needs the 600 green for 4.5:1 (guide rule 4).
        success: 'bg-emerald-600 text-white',
        warning: 'bg-amber-100 text-amber-900',
        danger: 'bg-red-100 text-red-900',
        outline: 'bg-transparent border border-zinc-300 text-zinc-700',
        // Price/promo flags — the guide's yellow badge (ดาวน์เริ่ม, ผ่อน 0%).
        promo: 'bg-promo text-promo-foreground font-head font-bold',
        // เกรดเครื่อง = ข้อมูล ไม่ใช่คำเตือน (คำตัดสินเจ้าของ 2026-08-31) —
        // ห้ามเหลือง/ส้ม/แดง ต่างกันแค่ความเข้มในโทนเขียวแบรนด์ ต้องตรงกับ
        // GRADE_STYLES ใน ProductCard เสมอ (ป้ายเดียวกันคนละหน้าจอ)
        // 'condition-new' = เข้มสุด (มือ 1) แล้วไล่อ่อนลงตามเกรด
        'condition-new': 'bg-ink text-white',
        'condition-a': 'bg-primary text-white',
        'condition-b': 'bg-white text-primary ring-1 ring-inset ring-border',
        'condition-c': 'bg-white text-zinc-700 ring-1 ring-inset ring-border',
      },
      size: {
        sm: 'text-xs px-2 py-0.5',
        md: 'text-xs px-2.5 py-1',
        lg: 'text-sm px-3 py-1',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

export { badgeVariants };
