import { cn } from '@/lib/utils';

/**
 * บรรทัดเบอร์ในตัวเลือกลูกค้า (POS · ใบจอง · ตรวจเครดิต) — ผู้สนใจจากแชทที่ยังไม่มีเบอร์ต้อง "เห็น ไม่ซ่อน"
 * (ค้นชื่อ Facebook เจอได้เป็นฟีเจอร์ — สเปค 3.6) แต่แทนบรรทัดว่างด้วยป้ายที่บอกว่าทำไมไม่มีเบอร์
 * ธง `chatPlaceholder` มาจาก API เท่านั้น
 */
export default function ProspectPhoneLine({ phone, chatPlaceholder, className }: { phone?: string | null; chatPlaceholder?: boolean; className?: string }) {
  if (chatPlaceholder) {
    return <span className={cn('inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold leading-4 text-primary', className)}>จากแชท · ยังไม่มีเบอร์</span>;
  }
  if (!phone) return <span className={cn('text-muted-foreground', className)}>—</span>;
  return <span className={cn('tabular-nums', className)}>{phone}</span>;
}
