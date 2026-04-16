import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import { CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

function pad2(n: number) {
  return n.toString().padStart(2, '0');
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function formatThaiDisplay(value: string): string {
  if (!value) return '';
  const d = new Date(value + 'T00:00:00');
  if (isNaN(d.getTime())) return value;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear() + 543}`;
}

interface ThaiDateInputProps {
  value: string; // YYYY-MM-DD (CE)
  onChange: (e: { target: { value: string } }) => void;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  min?: string;
  max?: string;
}

export default function ThaiDateInput({
  value,
  onChange,
  className,
  disabled,
  required,
  placeholder = 'วว/ดด/ปปปป',
  min,
  max,
}: ThaiDateInputProps) {
  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'days' | 'months' | 'years'>('days');
  const inputRef = useRef<HTMLInputElement>(null);

  // Current viewed month/year (CE)
  const today = new Date();
  const parsed = value ? new Date(value + 'T00:00:00') : null;
  const [viewYear, setViewYear] = useState(parsed ? parsed.getFullYear() : today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed ? parsed.getMonth() : today.getMonth());
  const [yearRangeStart, setYearRangeStart] = useState(Math.floor((parsed ? parsed.getFullYear() : today.getFullYear()) / 12) * 12);

  // Sync view when value changes externally
  useEffect(() => {
    if (parsed && !isNaN(parsed.getTime())) {
      setViewYear(parsed.getFullYear());
      setViewMonth(parsed.getMonth());
    }
  }, [value]);

  const selectedDate = parsed && !isNaN(parsed.getTime()) ? parsed : null;

  function selectDay(year: number, month: number, day: number) {
    const iso = `${year}-${pad2(month + 1)}-${pad2(day)}`;
    onChange({ target: { value: iso } });
    setOpen(false);
    setViewMode('days');
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    // Allow typing DD/MM/YYYY (พ.ศ.) format
    const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) {
      const day = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      const buddhistYear = parseInt(match[3], 10);
      const ceYear = buddhistYear - 543;
      if (ceYear > 1900 && ceYear < 2200 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const iso = `${ceYear}-${pad2(month)}-${pad2(day)}`;
        onChange({ target: { value: iso } });
        return;
      }
    }
  }

  function handleClear() {
    onChange({ target: { value: '' } });
    setOpen(false);
  }

  // Build calendar grid
  const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
  const totalDays = daysInMonth(viewYear, viewMonth);
  const prevMonthDays = daysInMonth(viewYear, viewMonth === 0 ? 11 : viewMonth - 1, );

  const cells: { day: number; month: number; year: number; outside: boolean }[] = [];
  // Previous month fill
  for (let i = firstDayOfMonth - 1; i >= 0; i--) {
    const pm = viewMonth === 0 ? 11 : viewMonth - 1;
    const py = viewMonth === 0 ? viewYear - 1 : viewYear;
    cells.push({ day: prevMonthDays - i, month: pm, year: py, outside: true });
  }
  // Current month
  for (let d = 1; d <= totalDays; d++) {
    cells.push({ day: d, month: viewMonth, year: viewYear, outside: false });
  }
  // Next month fill
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    const nm = viewMonth === 11 ? 0 : viewMonth + 1;
    const ny = viewMonth === 11 ? viewYear + 1 : viewYear;
    cells.push({ day: d, month: nm, year: ny, outside: true });
  }

  const isSelected = (cell: typeof cells[0]) =>
    selectedDate &&
    cell.day === selectedDate.getDate() &&
    cell.month === selectedDate.getMonth() &&
    cell.year === selectedDate.getFullYear();

  const isToday = (cell: typeof cells[0]) =>
    cell.day === today.getDate() &&
    cell.month === today.getMonth() &&
    cell.year === today.getFullYear();

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setViewMode('days'); }}>
      <PopoverTrigger asChild disabled={disabled}>
        <div
          className={cn(
            'relative flex items-center cursor-pointer',
            disabled && 'opacity-50 pointer-events-none',
          )}
        >
          <input
            ref={inputRef}
            type="text"
            readOnly
            value={formatThaiDisplay(value)}
            placeholder={placeholder}
            required={required}
            disabled={disabled}
            className={cn(
              'w-full px-3 py-2 pr-9 border border-input rounded-lg text-sm bg-background cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-ring/30',
              className,
            )}
          />
          <CalendarIcon className="absolute right-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="p-3 select-none" style={{ minWidth: 280 }}>
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              aria-label="ย้อนกลับ"
              onClick={() => { if (viewMode === 'years') setYearRangeStart(yearRangeStart - 12); else prevMonth(); }}
              className="size-8 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (viewMode === 'days') setViewMode('months');
                else if (viewMode === 'months') { setYearRangeStart(Math.floor(viewYear / 12) * 12); setViewMode('years'); }
                else setViewMode('days');
              }}
              className="text-sm font-medium hover:bg-accent px-2 py-1 rounded-md"
            >
              {viewMode === 'years'
                ? `${yearRangeStart + 543} - ${yearRangeStart + 11 + 543}`
                : viewMode === 'months'
                  ? `${viewYear + 543}`
                  : `${THAI_MONTHS[viewMonth]} ${viewYear + 543}`}
            </button>
            <button
              type="button"
              aria-label="ถัดไป"
              onClick={() => { if (viewMode === 'years') setYearRangeStart(yearRangeStart + 12); else nextMonth(); }}
              className="size-8 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Year picker */}
          {viewMode === 'years' && (
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 12 }, (_, i) => yearRangeStart + i).map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => { setViewYear(y); setViewMode('months'); }}
                  className={cn(
                    'py-2 text-sm rounded-md hover:bg-accent',
                    y === viewYear && 'bg-primary text-primary-foreground hover:bg-primary',
                    y === today.getFullYear() && y !== viewYear && 'text-primary font-semibold',
                  )}
                >
                  {y + 543}
                </button>
              ))}
            </div>
          )}

          {/* Month picker */}
          {viewMode === 'months' && (
            <div className="grid grid-cols-3 gap-1">
              {THAI_MONTHS_SHORT.map((m, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { setViewMonth(i); setViewMode('days'); }}
                  className={cn(
                    'py-2 text-sm rounded-md hover:bg-accent',
                    i === viewMonth && 'bg-primary text-primary-foreground hover:bg-primary',
                    i === today.getMonth() && viewYear === today.getFullYear() && i !== viewMonth && 'text-primary font-semibold',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          )}

          {/* Day picker */}
          {viewMode === 'days' && (
            <>
              <div className="grid grid-cols-7 mb-1">
                {WEEKDAYS.map((wd) => (
                  <div key={wd} className="size-8 flex items-center justify-center text-xs font-medium text-muted-foreground">
                    {wd}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {cells.map((cell, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => selectDay(cell.year, cell.month, cell.day)}
                    className={cn(
                      'size-8 flex items-center justify-center text-sm rounded-md relative',
                      cell.outside ? 'text-muted-foreground/40' : 'hover:bg-accent',
                      isSelected(cell) && 'bg-primary text-primary-foreground hover:bg-primary',
                      isToday(cell) && !isSelected(cell) && 'after:absolute after:bottom-0.5 after:left-1/2 after:-translate-x-1/2 after:size-1 after:rounded-full after:bg-primary',
                    )}
                  >
                    {cell.day}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between mt-2 pt-2 border-t">
            <button
              type="button"
              onClick={handleClear}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ล้าง
            </button>
            <button
              type="button"
              onClick={() => {
                const t = new Date();
                selectDay(t.getFullYear(), t.getMonth(), t.getDate());
              }}
              className="text-xs text-primary hover:text-primary/80 font-medium"
            >
              วันนี้
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
