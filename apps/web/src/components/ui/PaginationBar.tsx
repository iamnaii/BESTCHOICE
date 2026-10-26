import { useState } from 'react';
import { Button } from './button';
import { Input } from './input';
import { NativeSelect } from './native-select';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

type Props = {
  total: number;
  page: number;
  size: number;
  sizeOptions?: number[];
  onPageChange: (page: number) => void;
  onSizeChange: (size: number) => void;
};

function pagesAround(current: number, total: number, span = 5): number[] {
  if (total <= span) return Array.from({ length: total }, (_, i) => i + 1);
  let start = Math.max(1, current - Math.floor(span / 2));
  const end = Math.min(total, start + span - 1);
  start = Math.max(1, end - span + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export function PaginationBar({
  total,
  page,
  size,
  sizeOptions = [20, 50, 100],
  onPageChange,
  onSizeChange,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / size));
  const start = total === 0 ? 0 : (page - 1) * size + 1;
  const end = Math.min(page * size, total);
  const [jumpValue, setJumpValue] = useState('');

  const handleJump = () => {
    const n = Number(jumpValue);
    if (Number.isFinite(n) && n >= 1 && n <= totalPages) {
      onPageChange(Math.floor(n));
      setJumpValue('');
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap py-2 text-sm">
      <span className="text-muted-foreground">
        แสดง {start.toLocaleString()}-{end.toLocaleString()} จาก {total.toLocaleString()} รายการ
      </span>

      <div className="flex max-w-full flex-wrap items-center gap-1 [&_button]:max-lg:min-w-11">
        <Button className="hidden sm:inline-flex" variant="ghost" size="sm" aria-label="หน้าแรก" onClick={() => onPageChange(1)} disabled={page === 1}>
          <ChevronsLeft className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="sm" aria-label="ก่อนหน้า" onClick={() => onPageChange(page - 1)} disabled={page === 1}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        {pagesAround(page, totalPages).map((p) => (
          <Button
            key={p}
            className={Math.abs(p - page) > 1 ? 'hidden sm:inline-flex' : undefined}
            variant={p === page ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => onPageChange(p)}
            aria-current={p === page ? 'page' : undefined}
            aria-label={String(p)}
          >
            {p}
          </Button>
        ))}
        <Button variant="ghost" size="sm" aria-label="ถัดไป" onClick={() => onPageChange(page + 1)} disabled={page === totalPages}>
          <ChevronRight className="w-4 h-4" />
        </Button>
        <Button className="hidden sm:inline-flex" variant="ghost" size="sm" aria-label="หน้าสุดท้าย" onClick={() => onPageChange(totalPages)} disabled={page === totalPages}>
          <ChevronsRight className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex max-w-full flex-wrap items-center gap-2">
        <Input
          className="w-16 h-8 text-sm"
          placeholder="ไปหน้า"
          aria-label="ไปหน้าที่"
          value={jumpValue}
          onChange={(e) => setJumpValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleJump()}
        />
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          แสดงต่อหน้า:
          <NativeSelect
            aria-label="แสดงต่อหน้า"
            value={size}
            onChange={(e) => onSizeChange(Number(e.target.value))}
            wrapperClassName="w-24"
          >
            {sizeOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </NativeSelect>
        </label>
      </div>
    </div>
  );
}
