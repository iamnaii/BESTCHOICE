# Other Income v2.3 UI PDF Gap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 3 remaining UI gaps from the PDF comparison report into Other Income module — Date Range Quick Chips on list page, plus a unified Internal Control Bar (purple-frame sticky bar) that combines pills + state machine + state-aware buttons across Entry and View pages.

**Architecture:** Two new presentational components (`DateRangeChips`, `InternalControlBar`) under `apps/web/src/pages/other-income/components/`. Wire `DateRangeChips` into `OtherIncomeListPage`; wire `InternalControlBar` into both `OtherIncomeEntryPage` (replacing old Section 7 card + old sticky bar) and `OtherIncomeViewPage` (moving state-control actions from `PageHeader` to a new sticky bottom bar; utility actions stay in header).

**Tech Stack:** React 18 + TypeScript + Tailwind CSS + shadcn/ui + lucide-react + @testing-library/react + Vitest.

**Spec:** `docs/superpowers/specs/2026-05-14-other-income-v2-3-ui-pdf-gap-design.md`

---

## File Structure

**New files:**
- `apps/web/src/pages/other-income/components/DateRangeChips.tsx`
- `apps/web/src/pages/other-income/components/__tests__/DateRangeChips.test.tsx`
- `apps/web/src/pages/other-income/components/InternalControlBar.tsx`
- `apps/web/src/pages/other-income/components/__tests__/InternalControlBar.test.tsx`

**Modified files:**
- `apps/web/src/pages/other-income/OtherIncomeListPage.tsx` (wire DateRangeChips, remove old "ล้างตัวกรอง" button)
- `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx` (remove Section 7 card + old sticky bar, wire InternalControlBar)
- `apps/web/src/pages/other-income/OtherIncomeViewPage.tsx` (move state-control actions from header to new bottom InternalControlBar)
- `apps/web/src/index.css` (add `--accent-purple` HSL tokens for the purple frame)

---

## Task 1: DateRangeChips Component

**Files:**
- Create: `apps/web/src/pages/other-income/components/DateRangeChips.tsx`
- Create: `apps/web/src/pages/other-income/components/__tests__/DateRangeChips.test.tsx`

### - [ ] Step 1.1: Write the failing test

Create `apps/web/src/pages/other-income/components/__tests__/DateRangeChips.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateRangeChips } from '../DateRangeChips';

describe('DateRangeChips', () => {
  const onChange = vi.fn();

  beforeEach(() => {
    onChange.mockClear();
    // Freeze "today" so date math is deterministic. 2026-05-14 BKK.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T05:00:00.000Z')); // 12:00 BKK
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders 4 chips', () => {
    render(<DateRangeChips startDate="" endDate="" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'ทั้งหมด' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'เดือนนี้' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'เดือนที่แล้ว' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /ช่วงวันที่/ })).toBeInTheDocument();
  });

  it('clicking "เดือนนี้" emits 1st of current month → today', () => {
    render(<DateRangeChips startDate="" endDate="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'เดือนนี้' }));
    expect(onChange).toHaveBeenCalledWith({ startDate: '2026-05-01', endDate: '2026-05-14' });
  });

  it('clicking "เดือนที่แล้ว" emits 1st → last day of last month', () => {
    render(<DateRangeChips startDate="" endDate="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'เดือนที่แล้ว' }));
    expect(onChange).toHaveBeenCalledWith({ startDate: '2026-04-01', endDate: '2026-04-30' });
  });

  it('clicking "ทั้งหมด" clears both dates', () => {
    render(<DateRangeChips startDate="2026-05-01" endDate="2026-05-14" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'ทั้งหมด' }));
    expect(onChange).toHaveBeenCalledWith({ startDate: '', endDate: '' });
  });

  it('right-side label shows "ทั้งหมด" when both dates empty', () => {
    render(<DateRangeChips startDate="" endDate="" onChange={onChange} />);
    expect(screen.getByTestId('date-range-label')).toHaveTextContent('ทั้งหมด');
  });

  it('label shows "พฤษภาคม 2569 (01/05 - 14/05)" for current-month partial', () => {
    render(<DateRangeChips startDate="2026-05-01" endDate="2026-05-14" onChange={onChange} />);
    expect(screen.getByTestId('date-range-label')).toHaveTextContent(
      'พฤษภาคม 2569 (01/05 - 14/05)',
    );
  });

  it('label shows full month name when range exactly covers one calendar month', () => {
    render(<DateRangeChips startDate="2026-04-01" endDate="2026-04-30" onChange={onChange} />);
    expect(screen.getByTestId('date-range-label')).toHaveTextContent('เมษายน 2569');
  });

  it('label shows cross-month format for ranges spanning two months', () => {
    render(<DateRangeChips startDate="2026-04-15" endDate="2026-05-14" onChange={onChange} />);
    expect(screen.getByTestId('date-range-label')).toHaveTextContent('15 เม.ย. - 14 พ.ค. 2569');
  });

  it('"เดือนนี้" chip has aria-checked=true when current month is selected', () => {
    render(<DateRangeChips startDate="2026-05-01" endDate="2026-05-14" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'เดือนนี้' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
```

### - [ ] Step 1.2: Run tests to verify they fail

Run: `cd apps/web && npx vitest run src/pages/other-income/components/__tests__/DateRangeChips.test.tsx`

Expected: FAIL with `Cannot find module '../DateRangeChips'`.

### - [ ] Step 1.3: Write the DateRangeChips component

Create `apps/web/src/pages/other-income/components/DateRangeChips.tsx`:

```tsx
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
```

### - [ ] Step 1.4: Run tests to verify they pass

Run: `cd apps/web && npx vitest run src/pages/other-income/components/__tests__/DateRangeChips.test.tsx`

Expected: 9/9 PASS.

### - [ ] Step 1.5: Wire DateRangeChips into OtherIncomeListPage

Edit `apps/web/src/pages/other-income/OtherIncomeListPage.tsx`.

Add import near the existing imports (around line 13):

```tsx
import { DateRangeChips } from './components/DateRangeChips';
```

Replace the date inputs block at lines 282–295 and the "ล้างตัวกรอง" button at lines 296–304 with:

```tsx
        {/* Date Range Quick Chips (v2.3 — replaces old date inputs + clear button) */}
        <div className="w-full">
          <DateRangeChips
            startDate={startDate}
            endDate={endDate}
            onChange={({ startDate: sd, endDate: ed }) => {
              setStartDate(sd);
              setEndDate(ed);
              setPage(1);
            }}
          />
        </div>
        {/* Custom-range inputs: always rendered so users can type exact dates;
            the "ช่วงวันที่..." chip focuses the first input via DOM query. */}
        <div className="flex flex-wrap items-center gap-2 w-full">
          <input
            type="date"
            data-date-range-custom-start="true"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
            className="border rounded-md px-3 py-2 text-sm bg-background"
            placeholder="วันที่เริ่ม"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
            className="border rounded-md px-3 py-2 text-sm bg-background"
            placeholder="วันที่สิ้นสุด"
          />
        </div>
```

Also: change initial state at line 107–108 to default to "this month":

```tsx
  const todayInit = new Date();
  const firstOfMonthInit = `${todayInit.getFullYear()}-${String(todayInit.getMonth() + 1).padStart(2, '0')}-01`;
  const todayIsoInit = `${todayInit.getFullYear()}-${String(todayInit.getMonth() + 1).padStart(2, '0')}-${String(todayInit.getDate()).padStart(2, '0')}`;
  const [startDate, setStartDate] = useState(firstOfMonthInit);
  const [endDate, setEndDate] = useState(todayIsoInit);
```

### - [ ] Step 1.6: TypeScript check

Run: `./tools/check-types.sh web`

Expected: `Web: OK`.

### - [ ] Step 1.7: Commit

```bash
git add apps/web/src/pages/other-income/components/DateRangeChips.tsx \
        apps/web/src/pages/other-income/components/__tests__/DateRangeChips.test.tsx \
        apps/web/src/pages/other-income/OtherIncomeListPage.tsx
git commit -m "feat(other-income): add DateRangeChips quick filter to list page"
```

---

## Task 2: InternalControlBar Component (Standalone)

**Files:**
- Modify: `apps/web/src/index.css` (add `--accent-purple` token)
- Create: `apps/web/src/pages/other-income/components/InternalControlBar.tsx`
- Create: `apps/web/src/pages/other-income/components/__tests__/InternalControlBar.test.tsx`

### - [ ] Step 2.1: Add the purple HSL token to index.css

Locate the existing `:root { ... }` block in `apps/web/src/index.css` (search for `--primary:` to find it). Inside that block, just before its closing `}`, add:

```css
    --accent-purple: 280 60% 55%;
    --accent-purple-foreground: 280 80% 95%;
```

Then locate the `.dark { ... }` block (same file). Inside it, before the closing `}`, add:

```css
    --accent-purple: 280 65% 65%;
    --accent-purple-foreground: 280 30% 12%;
```

### - [ ] Step 2.2: Write the failing test

Create `apps/web/src/pages/other-income/components/__tests__/InternalControlBar.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InternalControlBar } from '../InternalControlBar';

describe('InternalControlBar', () => {
  const handlers = {
    onCancel: vi.fn(),
    onSaveDraft: vi.fn(),
    onPost: vi.fn(),
    onSubmitForApproval: vi.fn(),
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onReverse: vi.fn(),
  };

  beforeEach(() => {
    Object.values(handlers).forEach((h) => h.mockClear());
  });

  const baseProps = {
    recorder: { name: 'เอกนรินทร์' },
    approver: { name: 'เอกนรินทร์' },
    makerCheckerEnabled: false,
    ...handlers,
  };

  it('renders ผู้บันทึก + ผู้อนุมัติ pills always', () => {
    render(<InternalControlBar {...baseProps} status="DRAFT" />);
    expect(screen.getByText(/ผู้บันทึก:/)).toBeInTheDocument();
    expect(screen.getByText(/ผู้อนุมัติ:/)).toBeInTheDocument();
    expect(screen.getAllByText('เอกนรินทร์')).toHaveLength(2);
  });

  it('does NOT show "ต้องอนุมัติ" badge when Maker-Checker disabled', () => {
    render(<InternalControlBar {...baseProps} status="DRAFT" makerCheckerEnabled={false} />);
    expect(screen.queryByText('ต้องอนุมัติ')).not.toBeInTheDocument();
  });

  it('shows "ต้องอนุมัติ" badge when Maker-Checker enabled and status=DRAFT', () => {
    render(<InternalControlBar {...baseProps} status="DRAFT" makerCheckerEnabled={true} />);
    expect(screen.getByText('ต้องอนุมัติ')).toBeInTheDocument();
  });

  it('does NOT show "ต้องอนุมัติ" badge when status=POSTED even if Maker-Checker on', () => {
    render(<InternalControlBar {...baseProps} status="POSTED" makerCheckerEnabled={true} />);
    expect(screen.queryByText('ต้องอนุมัติ')).not.toBeInTheDocument();
  });

  it('DRAFT + maker-checker OFF: shows ยกเลิก / บันทึกร่าง / บันทึก & POST', () => {
    render(<InternalControlBar {...baseProps} status="DRAFT" />);
    expect(screen.getByRole('button', { name: /ยกเลิก/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /บันทึกร่าง/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /บันทึก & POST/ })).toBeInTheDocument();
  });

  it('DRAFT + maker-checker ON: replaces POST with "ส่งให้อนุมัติ"', () => {
    render(<InternalControlBar {...baseProps} status="DRAFT" makerCheckerEnabled={true} />);
    expect(screen.queryByRole('button', { name: /บันทึก & POST/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ส่งให้อนุมัติ/ })).toBeInTheDocument();
  });

  it('POSTED: shows ปิด + กลับรายการ', () => {
    render(<InternalControlBar {...baseProps} status="POSTED" />);
    expect(screen.getByRole('button', { name: /ปิด/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /กลับรายการ/ })).toBeInTheDocument();
  });

  it('REVERSED: shows only ปิด', () => {
    render(<InternalControlBar {...baseProps} status="REVERSED" />);
    expect(screen.getByRole('button', { name: /ปิด/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /กลับรายการ/ })).not.toBeInTheDocument();
  });

  it('READY + viewer is approver: shows ปฏิเสธ + อนุมัติ & POST', () => {
    render(
      <InternalControlBar
        {...baseProps}
        status="READY"
        makerCheckerEnabled={true}
        isViewerApprover={true}
      />,
    );
    expect(screen.getByRole('button', { name: /ปฏิเสธ/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /อนุมัติ & POST/ })).toBeInTheDocument();
  });

  it('READY + viewer is NOT approver: shows only กลับ + รออนุมัติ banner', () => {
    render(
      <InternalControlBar
        {...baseProps}
        status="READY"
        makerCheckerEnabled={true}
        isViewerApprover={false}
      />,
    );
    expect(screen.queryByRole('button', { name: /อนุมัติ/ })).not.toBeInTheDocument();
    expect(screen.getByText(/รออนุมัติ/)).toBeInTheDocument();
  });

  it('fires onPost when "บันทึก & POST" clicked', () => {
    render(<InternalControlBar {...baseProps} status="DRAFT" />);
    fireEvent.click(screen.getByRole('button', { name: /บันทึก & POST/ }));
    expect(handlers.onPost).toHaveBeenCalledTimes(1);
  });

  it('fires onReverse when "กลับรายการ" clicked', () => {
    render(<InternalControlBar {...baseProps} status="POSTED" />);
    fireEvent.click(screen.getByRole('button', { name: /กลับรายการ/ }));
    expect(handlers.onReverse).toHaveBeenCalledTimes(1);
  });

  it('state machine bar shows 4 dots when maker-checker enabled', () => {
    render(<InternalControlBar {...baseProps} status="DRAFT" makerCheckerEnabled={true} />);
    expect(screen.getAllByTestId('state-machine-dot')).toHaveLength(4);
  });

  it('state machine bar shows 3 dots when maker-checker disabled', () => {
    render(<InternalControlBar {...baseProps} status="DRAFT" makerCheckerEnabled={false} />);
    expect(screen.getAllByTestId('state-machine-dot')).toHaveLength(3);
  });

  it('active dot has data-state="active"', () => {
    render(<InternalControlBar {...baseProps} status="POSTED" />);
    const dots = screen.getAllByTestId('state-machine-dot');
    const active = dots.find((d) => d.getAttribute('data-state') === 'active');
    expect(active).toHaveAttribute('data-label', 'POSTED');
  });
});
```

### - [ ] Step 2.3: Run tests to verify they fail

Run: `cd apps/web && npx vitest run src/pages/other-income/components/__tests__/InternalControlBar.test.tsx`

Expected: FAIL with `Cannot find module '../InternalControlBar'`.

### - [ ] Step 2.4: Write the InternalControlBar component

Create `apps/web/src/pages/other-income/components/InternalControlBar.tsx`:

```tsx
import { ArrowLeft, Save, Send, CheckCircle2, XCircle, Undo2, Lock, ShieldAlert, User as UserIcon } from 'lucide-react';

export type DocStatus = 'DRAFT' | 'READY' | 'POSTED' | 'REVERSED';

export interface InternalControlBarProps {
  status: DocStatus;
  recorder: { name: string };
  approver: { name: string };
  makerCheckerEnabled: boolean;
  isViewerApprover?: boolean;
  isLoading?: boolean;
  errorCount?: number;
  canPost?: boolean;

  onCancel: () => void;
  onSaveDraft?: () => void;
  onPost?: () => void;
  onSubmitForApproval?: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onReverse?: () => void;
}

const STATE_LABELS: Record<DocStatus, string> = {
  DRAFT: 'DRAFT',
  READY: 'READY',
  POSTED: 'POSTED',
  REVERSED: 'REVERSED',
};

function StateMachineBar({
  status,
  makerCheckerEnabled,
}: {
  status: DocStatus;
  makerCheckerEnabled: boolean;
}) {
  const statesAll: DocStatus[] = ['DRAFT', 'READY', 'POSTED', 'REVERSED'];
  const states = makerCheckerEnabled ? statesAll : (['DRAFT', 'POSTED', 'REVERSED'] as DocStatus[]);
  const currentIndex = states.indexOf(status);

  return (
    <div className="flex items-center gap-2 w-full">
      {states.map((s, i) => {
        const isActive = i === currentIndex;
        const isPast = i < currentIndex;
        const state = isActive ? 'active' : isPast ? 'past' : 'future';
        const dotClasses =
          state === 'active'
            ? 'w-3 h-3 rounded-full bg-primary ring-4 ring-primary/20'
            : state === 'past'
              ? 'w-2.5 h-2.5 rounded-full bg-muted-foreground'
              : 'w-2.5 h-2.5 rounded-full border-2 border-border bg-background';
        const labelClasses =
          state === 'active'
            ? 'text-xs font-semibold text-primary'
            : state === 'past'
              ? 'text-xs text-muted-foreground'
              : 'text-xs text-muted-foreground/60';
        return (
          <div key={s} className="flex items-center gap-2 flex-1">
            <div className="flex flex-col items-center gap-1">
              <div data-testid="state-machine-dot" data-state={state} data-label={s} className={dotClasses} />
              <span className={labelClasses}>{STATE_LABELS[s]}</span>
            </div>
            {i < states.length - 1 && (
              <div className="flex-1 border-t-2 border-dashed border-border" />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function InternalControlBar({
  status,
  recorder,
  approver,
  makerCheckerEnabled,
  isViewerApprover = false,
  isLoading = false,
  errorCount = 0,
  canPost = true,
  onCancel,
  onSaveDraft,
  onPost,
  onSubmitForApproval,
  onApprove,
  onReject,
  onReverse,
}: InternalControlBarProps) {
  const showApprovalBadge =
    makerCheckerEnabled && (status === 'DRAFT' || status === 'READY');

  const frameClass =
    'fixed bottom-0 left-0 right-0 z-40 px-4 md:px-6 py-3 ' +
    'border-t-2 bg-[hsl(var(--accent-purple)/0.04)] border-[hsl(var(--accent-purple)/0.3)] ' +
    'shadow-lg backdrop-blur-sm';

  return (
    <div className={frameClass}>
      <div className="max-w-5xl mx-auto space-y-3">
        {/* Row 1 — Internal Control label + pills */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[hsl(var(--accent-purple))]">
            <Lock size={13} />
            ควบคุมภายใน
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-info/10 text-info text-xs"
              title="ระบบกำหนดอัตโนมัติตาม user ที่เข้าใช้งานในขณะนี้"
            >
              <UserIcon size={13} />
              <span className="text-muted-foreground">ผู้บันทึก:</span>
              <span className="font-semibold text-foreground">{recorder.name}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-success/10 text-success text-xs">
              <CheckCircle2 size={13} />
              <span className="text-muted-foreground">ผู้อนุมัติ:</span>
              <span className="font-semibold text-foreground">{approver.name}</span>
            </span>
            {showApprovalBadge && (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/15 text-amber-600 text-xs font-semibold"
                title="เอกสารนี้ต้องผ่านการอนุมัติก่อนลงบัญชี"
              >
                <ShieldAlert size={13} />
                ต้องอนุมัติ
              </span>
            )}
          </div>
        </div>

        {/* Row 2 — State Machine Bar */}
        <div className="hidden md:block">
          <StateMachineBar status={status} makerCheckerEnabled={makerCheckerEnabled} />
        </div>
        <div className="md:hidden text-xs text-muted-foreground">
          สถานะ: <span className="font-semibold text-primary">● {STATE_LABELS[status]}</span>
        </div>

        {/* Row 3 — State-aware action buttons */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-xs">
            {status === 'DRAFT' && errorCount > 0 && (
              <span className="text-destructive font-semibold">มี {errorCount} ข้อต้องแก้ไข</span>
            )}
            {status === 'READY' && !isViewerApprover && (
              <span className="text-muted-foreground">รออนุมัติจากผู้ตรวจสอบ</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border rounded-md hover:bg-accent disabled:opacity-50"
            >
              <ArrowLeft size={14} />
              {status === 'POSTED' || status === 'REVERSED' ? 'ปิด' : status === 'READY' ? 'กลับ' : 'ยกเลิก'}
            </button>

            {/* DRAFT actions */}
            {status === 'DRAFT' && (
              <>
                <button
                  type="button"
                  onClick={onSaveDraft}
                  disabled={isLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold border rounded-md hover:bg-accent disabled:opacity-50"
                >
                  <Save size={14} />
                  บันทึกร่าง
                </button>
                {makerCheckerEnabled ? (
                  <button
                    type="button"
                    onClick={onSubmitForApproval}
                    disabled={isLoading || !canPost}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Send size={14} />
                    ส่งให้อนุมัติ
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onPost}
                    disabled={isLoading || !canPost}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <CheckCircle2 size={14} />
                    บันทึก & POST
                  </button>
                )}
              </>
            )}

            {/* READY actions (approver only) */}
            {status === 'READY' && isViewerApprover && (
              <>
                <button
                  type="button"
                  onClick={onReject}
                  disabled={isLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold border border-destructive/40 text-destructive rounded-md hover:bg-destructive/10 disabled:opacity-50"
                >
                  <XCircle size={14} />
                  ปฏิเสธ
                </button>
                <button
                  type="button"
                  onClick={onApprove}
                  disabled={isLoading}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-40"
                >
                  <CheckCircle2 size={14} />
                  อนุมัติ & POST
                </button>
              </>
            )}

            {/* POSTED actions */}
            {status === 'POSTED' && onReverse && (
              <button
                type="button"
                onClick={onReverse}
                disabled={isLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border border-destructive/40 text-destructive rounded-md hover:bg-destructive/10 disabled:opacity-50"
              >
                <Undo2 size={14} />
                กลับรายการ
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

### - [ ] Step 2.5: Run tests to verify they pass

Run: `cd apps/web && npx vitest run src/pages/other-income/components/__tests__/InternalControlBar.test.tsx`

Expected: 14/14 PASS.

### - [ ] Step 2.6: TypeScript check

Run: `./tools/check-types.sh web`

Expected: `Web: OK`.

### - [ ] Step 2.7: Commit

```bash
git add apps/web/src/index.css \
        apps/web/src/pages/other-income/components/InternalControlBar.tsx \
        apps/web/src/pages/other-income/components/__tests__/InternalControlBar.test.tsx
git commit -m "feat(other-income): add InternalControlBar component + accent-purple token"
```

---

## Task 3: Wire InternalControlBar into Entry Page

**Files:**
- Modify: `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx`

### - [ ] Step 3.1: Add import for InternalControlBar

Near the top of `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx`, after the other component imports, add:

```tsx
import { InternalControlBar } from './components/InternalControlBar';
```

### - [ ] Step 3.2: Remove Section 7 card

Delete lines 972–1000 (the entire `{/* Section 7 — Recorder & Approver */}` block — from the opening `<section ...>` to its closing `</section>`). The block to remove starts with `{/* Section 7 — Recorder & Approver */}` and ends with `</section>` immediately before the next `</div>` or section.

### - [ ] Step 3.3: Replace the old sticky bottom bar with InternalControlBar

Replace the entire block at lines 1130–1208 (`{/* Sticky bottom action bar */}` through its closing `</div>` of the outer fixed div) with:

```tsx
      {/* Internal Control Bar (v2.3 — replaces Section 7 card + old sticky bar) */}
      <InternalControlBar
        status="DRAFT"
        recorder={{ name: userDisplayName }}
        approver={{ name: userDisplayName }}
        makerCheckerEnabled={makerCheckerEnabled}
        isLoading={isSubmitting}
        errorCount={errorCount}
        canPost={canPost}
        onCancel={() => navigate('/other-income')}
        onSaveDraft={() => {
          const raw = form.getValues();
          const result = otherIncomeFormSchema.safeParse(raw);
          if (!result.success) {
            toast.error('กรุณาตรวจสอบข้อมูลให้ครบถ้วน');
            return;
          }
          saveDraftMutation.mutate(result.data);
        }}
        onPost={() => {
          const raw = form.getValues();
          const result = otherIncomeFormSchema.safeParse(raw);
          if (!result.success) {
            toast.error('กรุณาตรวจสอบข้อมูลให้ครบถ้วน');
            return;
          }
          saveAndPostMutation.mutate(result.data);
        }}
        onSubmitForApproval={() => {
          const raw = form.getValues();
          const result = otherIncomeFormSchema.safeParse(raw);
          if (!result.success) {
            toast.error('กรุณาตรวจสอบข้อมูลให้ครบถ้วน');
            return;
          }
          saveAndRequestApprovalMutation.mutate(result.data);
        }}
      />
```

### - [ ] Step 3.4: Add bottom padding to the form so content isn't hidden behind the sticky bar

In `OtherIncomeEntryPage.tsx`, find the outermost form container `<div>` (it wraps the whole page; look near the start of the JSX return). Add `pb-44` (or whatever existing pb-* value the old sticky bar required) to its className. If the page already has `pb-32` or similar from the previous bar, bump it to `pb-44 md:pb-40` to accommodate the new 3-row bar.

If the page does not currently have bottom padding, add a wrapper around the main content:

```tsx
<div className="pb-44 md:pb-40">
  {/* existing page content */}
</div>
```

### - [ ] Step 3.5: TypeScript check

Run: `./tools/check-types.sh web`

Expected: `Web: OK`.

If errors mention removed imports (e.g. `CloudUpload`, `Save`, `ArrowLeft`, `Send`, `CheckCircle2`, `AlertTriangle`, `SectionHeader`), remove those unused imports from the top of the file.

### - [ ] Step 3.6: Run all Other Income vitest tests

Run: `cd apps/web && npx vitest run src/pages/other-income`

Expected: all existing tests PASS (new DateRangeChips + InternalControlBar tests included).

### - [ ] Step 3.7: Commit

```bash
git add apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx
git commit -m "feat(other-income): wire InternalControlBar into Entry Page (remove Section 7 + old sticky bar)"
```

---

## Task 4: Wire InternalControlBar into View Page

**Files:**
- Modify: `apps/web/src/pages/other-income/OtherIncomeViewPage.tsx`

### - [ ] Step 4.1: Add import for InternalControlBar

Near the top of `apps/web/src/pages/other-income/OtherIncomeViewPage.tsx`, with the other component imports, add:

```tsx
import { InternalControlBar } from './components/InternalControlBar';
```

### - [ ] Step 4.2: Identify which header buttons get moved to the bottom bar

Looking at `OtherIncomeViewPage.tsx` around lines 244–393 (the `action={...}` prop of `<PageHeader>`):

**Keep in the top header (utility actions):**
- `คัดลอก` (Copy)
- `บันทึกเป็น Template`
- `พิมพ์ใบเสร็จ`
- `แก้ไข` (DRAFT only — this is a navigation, not a state-control action)

**Move to bottom bar (state-control actions):**
- `ส่งขออนุมัติ` (DRAFT + maker-checker on)
- `แก้ไขและ POST` (DRAFT + maker-checker off — but since edit-and-post navigates to edit page, treat this as a navigation and KEEP in header; the bottom bar will instead show a different note)
- `อนุมัติ` and `ปฏิเสธ` (READY)
- `กลับรายการ` (POSTED)

For simplicity and to avoid behavior change on existing DRAFT-from-list flow, **only move POSTED/READY actions** to the bottom bar in this task. Keep DRAFT actions in the header. The Entry Page (Task 3) covers DRAFT/edit flow.

### - [ ] Step 4.3: Remove POSTED "กลับรายการ" button from the header

In the `<PageHeader action={...}>` block in `OtherIncomeViewPage.tsx`, locate the existing POSTED-status `กลับรายการ` button (it lives inside the `doc.status === 'POSTED'` branch). Delete that single button. Keep the other POSTED buttons (`บันทึกเป็น Template`, `พิมพ์ใบเสร็จ`).

### - [ ] Step 4.4: Remove READY approve/reject buttons from the header

Locate the `doc.status === 'READY'` branch in the same `<PageHeader action={...}>` block. Delete the `อนุมัติ` button and the `ปฏิเสธ` button. Keep the `rejectNote` banner if present.

### - [ ] Step 4.5: Add InternalControlBar at the bottom of the view page JSX

At the very end of the View Page's main return JSX (just before the closing `</div>` of the outer page container), add:

```tsx
      {/* Internal Control Bar — bottom sticky (v2.3) */}
      {doc && (
        <InternalControlBar
          status={doc.status}
          recorder={{ name: doc.createdByName ?? doc.createdBy ?? '—' }}
          approver={{ name: doc.approvedByName ?? doc.approvedBy ?? doc.createdByName ?? '—' }}
          makerCheckerEnabled={makerCheckerEnabled}
          isViewerApprover={user?.id !== doc.createdById}
          isLoading={isActionLoading}
          onCancel={() => navigate('/other-income')}
          onApprove={() => approveMutation.mutate()}
          onReject={() => rejectMutation.mutate()}
          onReverse={canReverse ? () => reverseMutation.mutate() : undefined}
        />
      )}
```

**Note:** Field names like `doc.createdByName`, `doc.approvedByName`, `doc.createdById` come from the existing `OtherIncome` API shape. If any of these names are inaccurate, use the actual field on `doc` (run `grep "createdBy\|approvedBy" apps/web/src/types/otherIncome.ts` or similar to find the right names). The pills will gracefully fall back to `'—'` if missing.

### - [ ] Step 4.6: Add bottom padding to the View Page main container

Find the outermost `<div className="p-6 max-w-7xl mx-auto">` at line 237 and change to `<div className="p-6 max-w-7xl mx-auto pb-44 md:pb-40">`.

### - [ ] Step 4.7: TypeScript check

Run: `./tools/check-types.sh web`

Expected: `Web: OK`.

If errors mention `doc.createdByName` etc. not existing on the type, use whichever fields actually exist on the `OtherIncome` type — adjust the props in Step 4.5 accordingly. Acceptable fallback fields: `createdById`, `approvedById`, or simply `user?.name` for both pills.

### - [ ] Step 4.8: Run all Other Income vitest tests

Run: `cd apps/web && npx vitest run src/pages/other-income`

Expected: all PASS.

### - [ ] Step 4.9: Commit

```bash
git add apps/web/src/pages/other-income/OtherIncomeViewPage.tsx
git commit -m "feat(other-income): wire InternalControlBar into View Page (move state actions from header)"
```

---

## Final Verification

### - [ ] Step F.1: Full TypeScript check

Run: `./tools/check-types.sh all`

Expected: `TypeScript check passed!`

### - [ ] Step F.2: Full Other Income test suite

Run: `cd apps/web && npx vitest run src/pages/other-income`

Expected: all PASS, no skipped tests.

### - [ ] Step F.3: Manual smoke (start dev server)

Run in one terminal: `cd apps/web && npm run dev`

Open `http://localhost:5173/other-income` and verify:

1. **List page:**
   - 4 chips render: ทั้งหมด, เดือนนี้, เดือนที่แล้ว, ช่วงวันที่...
   - "เดือนนี้" is selected by default (chip has primary background)
   - Right-side label shows `📅 พฤษภาคม 2569 (01/05 - 14/05)` (or current month)
   - Clicking "เดือนที่แล้ว" updates the list query and the label
   - Clicking "ช่วงวันที่..." reveals the 2 native date inputs

2. **Entry page** (`/other-income/new`):
   - No more Section 7 card mid-page (no "ผู้บันทึก & ผู้อนุมัติ" section above the action bar)
   - Bottom sticky bar has a purple-tinged border
   - Bar shows: 🔐 ควบคุมภายใน label + pills (ผู้บันทึก, ผู้อนุมัติ) + (if Maker-Checker on) ต้องอนุมัติ badge
   - State machine bar shows 4 dots (DRAFT highlighted) when Maker-Checker on, 3 dots when off
   - Buttons: ← ยกเลิก, 💾 บันทึกร่าง, ✓ บันทึก & POST (or ส่งให้อนุมัติ)

3. **View page on a POSTED doc:**
   - Top header no longer shows "กลับรายการ" button
   - Bottom sticky InternalControlBar shows: ← ปิด + ↩ กลับรายการ
   - State machine bar dot is on POSTED

4. **Settings → toggle Maker-Checker ON → reload entry page:**
   - "ต้องอนุมัติ" badge appears in the bar
   - POST button text changes to "ส่งให้อนุมัติ"
   - State machine bar now shows 4 dots

### - [ ] Step F.4: Push branch and open PR

```bash
git push -u origin feat/other-income-v2-3-ui-pdf-gap
gh pr create --title "feat(other-income): v2.3 UI PDF gap — DateRangeChips + InternalControlBar" --body "$(cat <<'EOF'
## Summary
- เพิ่ม DateRangeChips quick filter (ทั้งหมด/เดือนนี้/เดือนที่แล้ว/ช่วงวันที่) ในหน้ารายการ default = "เดือนนี้"
- เพิ่ม InternalControlBar (กรอบม่วง sticky bottom) รวม pills ผู้บันทึก/อนุมัติ + State Machine bar + ปุ่ม state-aware
- ใช้ใน Entry Page (แทน Section 7 card + sticky bar เดิม) และ View Page (ย้ายปุ่ม state-control จาก header มาที่ bar)

ปิด 3/10 จุดสุดท้ายของ PDF UI Comparison Report (7 ข้อแรกชิปไปแล้วใน PR #827 v2.2)

## Test plan
- [x] TypeScript: 0 errors
- [x] Vitest: 23 tests ใหม่ (9 + 14)
- [ ] Manual: list page chips + entry page bar + view page bar (smoke checklist in spec)

Spec: docs/superpowers/specs/2026-05-14-other-income-v2-3-ui-pdf-gap-design.md
Plan: docs/superpowers/plans/2026-05-14-other-income-v2-3-ui-pdf-gap.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

### - [ ] Step F.5: Merge after manual smoke approval

Once owner manually smokes and approves:

```bash
gh pr merge <PR_NUMBER> --squash --delete-branch
git checkout main && git pull origin main
```
