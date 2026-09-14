import { cn } from '@/lib/utils';
import type { KpiTile, KpiTone } from '../utils/kpiTiles';

const TONE_TEXT: Record<KpiTone, string> = {
  default: 'text-foreground',
  primary: 'text-primary',
  success: 'text-success',
  destructive: 'text-destructive',
};

// แถวช่องตัวเลขอยู่เหนือกริดแท็บ+แผงข้าง จึงกว้างเต็มคอลัมน์เนื้อหา — ข้อจำกัดจริงคือเมนูซ้าย (264px) + ขอบ main
// (28px ต่อข้าง): วัดจริงจอ 1440 เหลือเนื้อหา 1120px พอสำหรับ 5 ช่อง · จอ 1280 เหลือ 960px ค่าประกัน/งวดถัดไปโดนตัด (R8)
// ⇒ 5 คอลัมน์ตั้งแต่ 1400px (87.5rem) ขึ้นไป ต่ำกว่านั้น 4 คอลัมน์
// 🚨 ต้องเขียนเป็น rem: Tailwind v4 เรียง breakpoint แบบ px ไว้ก่อน md: (rem) ใน CSS ⇒ md:grid-cols-4 ทับ min-[1400px] (วัดแล้ว 4 คอลัมน์)
export default function KpiTiles({ tiles }: { tiles: KpiTile[] }) {
  return (
    <div className={cn('mb-5 grid grid-cols-2 gap-4 md:grid-cols-4', tiles.length === 5 ? 'min-[87.5rem]:grid-cols-5' : 'xl:grid-cols-4')}>
      {tiles.map((tile) => (
        <div key={tile.key} className="min-w-0 rounded-xl border border-border/50 bg-card p-4 shadow-sm">
          <div className="truncate text-xs leading-snug text-muted-foreground">{tile.label}</div>
          <div className={cn('mt-1 truncate text-xl font-bold leading-snug tabular-nums', TONE_TEXT[tile.tone])} title={tile.value}>
            {tile.value}
          </div>
          <div className="mt-0.5 truncate text-xs leading-snug text-muted-foreground" title={tile.sub}>
            {tile.sub || ' '}
          </div>
        </div>
      ))}
    </div>
  );
}
