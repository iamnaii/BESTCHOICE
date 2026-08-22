import { useEffect, useState } from 'react';
import { SlidersHorizontal, Sparkles, Smartphone, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CatalogFilters {
  brand?: string;
  condition?: 'NEW' | 'USED';
  model?: string;
  conditionGrade?: string;
  minPrice?: number;
  maxPrice?: number;
  search?: string;
}

export interface ModelOption {
  model: string;
  count: number;
}

export interface PlanControls {
  downPct: number;
  months: number | null;
  /** Floor from the API — the finance side rejects anything under it. */
  minDownPct: number;
  monthsOptions: number[];
  onDownPct: (v: number) => void;
  onMonths: (v: number | null) => void;
}

/**
 * Ceiling for the down payment, shared by the slider and the typed box so the
 * two can never disagree about what is in range. The DTO allows up to 90; 80
 * keeps the useful 15–40 zone readable on the track.
 */
const MAX_DOWN_PCT = 80;

/**
 * Budget buckets, not a free-form min/max pair. Thai shoppers pick a band
 * ("ไม่เกินหมื่นห้า"), and the two number inputs this replaced were the least
 * used control on the page. Values map straight onto the existing
 * minPrice/maxPrice query params — no API change needed.
 */
const PRICE_BANDS: Array<{ id: string; label: string; min?: number; max?: number }> = [
  { id: '', label: 'ทุกช่วงราคา' },
  { id: '0-10000', label: 'ไม่เกิน ฿10,000', max: 10000 },
  { id: '10000-15000', label: '฿10,000 – ฿15,000', min: 10000, max: 15000 },
  { id: '15000-20000', label: '฿15,000 – ฿20,000', min: 15000, max: 20000 },
  { id: '20000-30000', label: '฿20,000 – ฿30,000', min: 20000, max: 30000 },
  { id: '30000-', label: '฿30,000 ขึ้นไป', min: 30000 },
];

const GRADES: Array<{ v: string; label: string }> = [
  { v: '', label: 'ทุกเกรด' },
  { v: 'A', label: 'เกรด A — สภาพสวยมาก' },
  { v: 'B', label: 'เกรด B — มีร่องรอยการใช้งาน' },
  { v: 'C', label: 'เกรด C — ตำหนิชัด ราคาคุ้ม' },
];

const DEVICE_TYPES = [
  { v: 'NEW' as const, label: 'iPhone มือ 1', Icon: Sparkles },
  { v: 'USED' as const, label: 'iPhone มือ 2', Icon: Smartphone },
];

function bandId(f: CatalogFilters): string {
  const hit = PRICE_BANDS.find((b) => b.id !== '' && b.min === f.minPrice && b.max === f.maxPrice);
  return hit?.id ?? '';
}

const selectCls =
  'w-full h-11 rounded-xl border-0 bg-muted px-3.5 text-[13.5px] text-foreground leading-snug ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-500/50';

const labelCls = 'block text-[13px] text-muted-foreground mb-2 leading-snug';

interface Props {
  filters: CatalogFilters;
  onChange: (next: CatalogFilters) => void;
  models?: ModelOption[];
  plan?: PlanControls;
  /** Inside the mobile dialog the panel drops its own chrome. */
  bare?: boolean;
}

export function FilterSidebar({ filters, onChange, models, plan, bare }: Props) {
  const isNew = filters.condition === 'NEW';
  const active =
    filters.condition ||
    filters.model ||
    filters.conditionGrade ||
    filters.minPrice !== undefined ||
    filters.maxPrice !== undefined;

  function pickType(v: 'NEW' | 'USED') {
    const next = filters.condition === v ? undefined : v;
    onChange({
      ...filters,
      condition: next,
      // มือ 1 ไม่มีเกรดตำหนิ — ล้างตัวกรองเกรดทิ้ง
      conditionGrade: next === 'NEW' ? undefined : filters.conditionGrade,
    });
  }

  const body = (
    <div className={cn('space-y-5', bare ? 'pt-1' : 'px-4 pb-5 pt-4')}>
      {/* "ดาวน์เท่าไหร่ ผ่อนเดือนละเท่าไหร่" is the first question in a Thai
          phone shop, so it sits above the filters. */}
      {plan && <PlanBlock plan={plan} />}

      <div>
        <span className={labelCls}>ประเภทเครื่อง</span>
        <div className="grid grid-cols-2 gap-2">
          {DEVICE_TYPES.map(({ v, label, Icon }) => {
            const on = filters.condition === v;
            return (
              <button
                key={v}
                type="button"
                aria-pressed={on}
                onClick={() => pickType(v)}
                className={cn(
                  'flex flex-col items-center justify-center gap-2 rounded-2xl px-2 py-4 text-[12.5px] leading-snug transition-colors',
                  on
                    ? 'bg-emerald-50 text-emerald-700 ring-2 ring-inset ring-emerald-500/45'
                    : 'bg-muted text-muted-foreground hover:bg-zinc-200',
                )}
              >
                <Icon
                  className={cn('size-6', on ? 'text-emerald-600' : 'text-zinc-400')}
                  aria-hidden
                />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor="filter-model">
          รุ่น
        </label>
        <select
          id="filter-model"
          className={selectCls}
          value={filters.model ?? ''}
          onChange={(e) => onChange({ ...filters, model: e.target.value || undefined })}
        >
          <option value="">ทุกรุ่น</option>
          {models?.map((m) => (
            <option key={m.model} value={m.model}>
              {m.model} ({m.count})
            </option>
          ))}
        </select>
      </div>

      {!isNew && (
        <div>
          <label className={labelCls} htmlFor="filter-grade">
            สภาพเครื่อง
          </label>
          <select
            id="filter-grade"
            className={selectCls}
            value={filters.conditionGrade ?? ''}
            onChange={(e) => onChange({ ...filters, conditionGrade: e.target.value || undefined })}
          >
            {GRADES.map((g) => (
              <option key={g.v} value={g.v}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className={labelCls} htmlFor="filter-price">
          ช่วงราคา
        </label>
        <select
          id="filter-price"
          className={selectCls}
          value={bandId(filters)}
          onChange={(e) => {
            const band = PRICE_BANDS.find((b) => b.id === e.target.value);
            onChange({ ...filters, minPrice: band?.min, maxPrice: band?.max });
          }}
        >
          {PRICE_BANDS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </div>

      {active && (
        <button
          type="button"
          onClick={() =>
            onChange({
              search: filters.search,
              condition: undefined,
              model: undefined,
              conditionGrade: undefined,
              minPrice: undefined,
              maxPrice: undefined,
            })
          }
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors leading-snug"
        >
          <X className="size-3.5" aria-hidden />
          ล้างตัวกรองทั้งหมด
        </button>
      )}
    </div>
  );

  if (bare) return <div>{body}</div>;

  return (
    <aside className="rounded-[40px] border-8 border-card bg-zinc-50 shadow-lg">
      <div className="flex items-center gap-2.5 px-4 pt-4">
        <span className="size-7 rounded-xl bg-ink grid place-items-center shrink-0">
          <SlidersHorizontal className="size-3.5 text-ink-foreground" aria-hidden />
        </span>
        <h2 className="text-[14.5px] font-semibold text-foreground leading-snug">ตัวกรองสินค้า</h2>
      </div>
      <hr className="mt-3.5 mx-4 border-0 border-t border-border" />
      {body}
    </aside>
  );
}

/**
 * Down payment + tenure. The typed box keeps its own raw string while the
 * shopper is mid-type: clamping on every keystroke would turn "25" into "15"
 * the moment they pressed 2. It commits — and clamps — on blur or Enter.
 */
function PlanBlock({ plan }: { plan: PlanControls }) {
  const [raw, setRaw] = useState(String(plan.downPct));
  useEffect(() => setRaw(String(plan.downPct)), [plan.downPct]);

  const typed = Number(raw);
  const belowMin = raw.trim() !== '' && Number.isFinite(typed) && typed < plan.minDownPct;

  function commit() {
    const n = Number(raw.replace(/[^\d]/g, ''));
    if (!Number.isFinite(n) || raw.trim() === '') {
      setRaw(String(plan.downPct));
      return;
    }
    const clamped = Math.min(MAX_DOWN_PCT, Math.max(plan.minDownPct, n));
    setRaw(String(clamped));
    plan.onDownPct(clamped);
  }

  return (
    <div className="rounded-2xl bg-emerald-50 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[13px] text-emerald-900 leading-snug" htmlFor="filter-down-num">
          เงินดาวน์
        </label>
        <div className="flex items-center gap-1">
          <input
            id="filter-down-num"
            type="number"
            inputMode="numeric"
            min={plan.minDownPct}
            max={MAX_DOWN_PCT}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            aria-describedby="filter-down-hint"
            className={cn(
              'num w-16 h-8 rounded-lg bg-card px-2 text-right text-[13px] font-bold leading-snug',
              'focus:outline-none focus:ring-2',
              belowMin
                ? 'text-orange-700 ring-1 ring-orange-400 focus:ring-orange-500/50'
                : 'text-emerald-800 focus:ring-emerald-500/50',
            )}
          />
          <span className="num text-[13px] font-bold text-emerald-800">%</span>
        </div>
      </div>

      <input
        aria-label="เลื่อนปรับเงินดาวน์"
        type="range"
        min={plan.minDownPct}
        max={MAX_DOWN_PCT}
        step={5}
        value={plan.downPct}
        onChange={(e) => plan.onDownPct(Number(e.target.value))}
        className="mt-2 w-full accent-emerald-600"
      />
      <div className="num flex justify-between text-[10.5px] text-emerald-700/70 leading-snug">
        <span>{plan.minDownPct}%</span>
        <span>{MAX_DOWN_PCT}%</span>
      </div>

      <p
        id="filter-down-hint"
        className={cn(
          'mt-1.5 text-[11px] leading-snug',
          belowMin ? 'text-orange-700 font-medium' : 'text-emerald-800/70',
        )}
      >
        {belowMin
          ? `ดาวน์ขั้นต่ำ ${plan.minDownPct}% — จะปรับขึ้นให้เมื่อออกจากช่อง`
          : `พิมพ์ตัวเลขเองได้ ขั้นต่ำ ${plan.minDownPct}%`}
      </p>

      {plan.monthsOptions.length > 0 && (
        <div className="mt-3">
          <label
            className="block text-[13px] text-emerald-900 mb-2 leading-snug"
            htmlFor="filter-months"
          >
            จำนวนงวด
          </label>
          <select
            id="filter-months"
            className="w-full h-10 rounded-xl border-0 bg-card px-3 text-[13.5px] text-foreground leading-snug focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            value={plan.months ?? ''}
            onChange={(e) => plan.onMonths(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">งวดยาวสุด (ผ่อนถูกที่สุด)</option>
            {plan.monthsOptions.map((m) => (
              <option key={m} value={m}>
                {m} งวด
              </option>
            ))}
          </select>
        </div>
      )}

      <p className="mt-2.5 text-[11px] text-emerald-800/70 leading-snug">
        เลื่อนหรือพิมพ์แล้วค่างวดบนการ์ดทุกใบคำนวณใหม่ทันที
      </p>
    </div>
  );
}
