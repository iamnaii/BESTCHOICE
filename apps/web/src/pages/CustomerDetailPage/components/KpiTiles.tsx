import { cn } from '@/lib/utils';
import type { KpiTile, KpiTone } from '../utils/kpiTiles';

const TONE_TEXT: Record<KpiTone, string> = {
  default: 'text-foreground',
  primary: 'text-primary',
  success: 'text-success',
  destructive: 'text-destructive',
};

// R8 real-screen measurement (1280×900): 5 คอลัมน์ที่ xl (1280px) บีบชนกับแผงข้าง
// 360px ของ index.tsx ที่กาง xl เหมือนกัน — ค่าประกัน/งวดถัดไปโดนตัด (ellipsis overflow)
// เลื่อนเป็น 5 คอลัมน์ตอน 2xl (1536px) แทน ช่วง xl-2xl ยังคง 4 คอลัมน์ตามเดิม
export default function KpiTiles({ tiles }: { tiles: KpiTile[] }) {
  return (
    <div className={cn('mb-5 grid grid-cols-2 gap-4 md:grid-cols-4', tiles.length === 5 ? '2xl:grid-cols-5' : 'xl:grid-cols-4')}>
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
