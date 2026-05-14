import { Calendar } from 'lucide-react';

interface DateRangeChipsProps {
  startDate: string; // YYYY-MM-DD or ''
  endDate: string;   // YYYY-MM-DD or ''
  onChange: (next: { startDate: string; endDate: string }) => void;
}

const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const THAI_MONTHS_ABBR = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function thisMonthRange(today: Date): { startDate: string; endDate: string } {
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  return { startDate: toIsoDate(first), endDate: toIsoDate(today) };
}

function lastMonthRange(today: Date): { startDate: string; endDate: string } {
  const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const last = new Date(today.getFullYear(), today.getMonth(), 0);
  return { startDate: toIsoDate(first), endDate: toIsoDate(last) };
}

function isSameRange(
  a: { startDate: string; endDate: string },
  b: { startDate: string; endDate: string },
): boolean {
  return a.startDate === b.startDate && a.endDate === b.endDate;
}

function formatRangeLabel(startDate: string, endDate: string): string {
  if (!startDate && !endDate) return 'ทั้งหมด';
  if (!startDate || !endDate) return `${startDate || endDate}`;

  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  const beYear = start.getFullYear() + 543;
  const startMonthIdx = start.getMonth();
  const endMonthIdx = end.getMonth();
  const startDay = start.getDate();
  const endDay = end.getDate();
  const lastDayOfStartMonth = new Date(start.getFullYear(), startMonthIdx + 1, 0).getDate();

  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && startMonthIdx === endMonthIdx;

  if (sameMonth && startDay === 1 && endDay === lastDayOfStartMonth) {
    return `${THAI_MONTHS_FULL[startMonthIdx]} ${beYear}`;
  }
  if (sameMonth) {
    const sd = String(startDay).padStart(2, '0');
    const ed = String(endDay).padStart(2, '0');
    const mm = String(startMonthIdx + 1).padStart(2, '0');
    return `${THAI_MONTHS_FULL[startMonthIdx]} ${beYear} (${sd}/${mm} - ${ed}/${mm})`;
  }
  return `${startDay} ${THAI_MONTHS_ABBR[startMonthIdx]} - ${endDay} ${THAI_MONTHS_ABBR[endMonthIdx]} ${end.getFullYear() + 543}`;
}

export function DateRangeChips({ startDate, endDate, onChange }: DateRangeChipsProps) {
  const today = new Date();
  const current = { startDate, endDate };
  const presets = {
    all: { startDate: '', endDate: '' },
    thisMonth: thisMonthRange(today),
    lastMonth: lastMonthRange(today),
  };

  const isAll = isSameRange(current, presets.all);
  const isThisMonth = isSameRange(current, presets.thisMonth);
  const isLastMonth = isSameRange(current, presets.lastMonth);
  const isCustom = !isAll && !isThisMonth && !isLastMonth;

  const chipClass = (active: boolean) =>
    `px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
      active
        ? 'bg-primary text-primary-foreground border-primary'
        : 'bg-background text-foreground border-border hover:bg-accent'
    }`;

  return (
    <div className="flex items-center justify-between flex-wrap gap-2 w-full">
      <div role="radiogroup" aria-label="ช่วงวันที่" className="flex flex-wrap gap-2">
        <button
          type="button"
          role="radio"
          aria-checked={isAll}
          className={chipClass(isAll)}
          onClick={() => onChange(presets.all)}
        >
          ทั้งหมด
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={isThisMonth}
          className={chipClass(isThisMonth)}
          onClick={() => onChange(presets.thisMonth)}
        >
          เดือนนี้
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={isLastMonth}
          className={chipClass(isLastMonth)}
          onClick={() => onChange(presets.lastMonth)}
        >
          เดือนที่แล้ว
        </button>
        {/*
          "ช่วงวันที่..." is an INDICATOR chip — active when dates don't match
          a preset. Clicking it focuses the first date input via the parent
          (parent owns the input refs). Component itself only emits a hint.
        */}
        <button
          type="button"
          role="radio"
          aria-checked={isCustom}
          aria-label="ช่วงวันที่ กำหนดเอง"
          className={chipClass(isCustom)}
          onClick={() => {
            // Scroll the date inputs into view (parent ensures they are visible)
            const customInput = document.querySelector<HTMLInputElement>(
              'input[data-date-range-custom-start="true"]',
            );
            customInput?.focus();
          }}
        >
          ช่วงวันที่...
        </button>
      </div>
      <div
        data-testid="date-range-label"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Calendar size={13} />
        {formatRangeLabel(startDate, endDate)}
      </div>
    </div>
  );
}
