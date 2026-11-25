import { NativeSelect } from '@/components/ui/native-select';
import { SlidersHorizontal, Sparkles, Smartphone, X } from '@/lib/icons';
import { copy } from '@/lib/copy';
import { cn } from '@/lib/utils';
import type { DeviceOrigin } from '@/lib/device-origin';
import { DownAmountField } from './DownAmountField';
import { Pill } from './Pill';

export interface CatalogFilters {
  deviceOrigin?: DeviceOrigin;
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
  /** เงินดาวน์ที่ลูกค้าพิมพ์ (บาท) — null = ไม่ได้ใส่ */
  down: number | null;
  months: number | null;
  monthsOptions: number[];
  /** 0 = ไม่มีเงินดาวน์ (หน้ารวมแปลงเป็นติ๊กฟรีดาวน์) */
  onDown: (v: number | null) => void;
  onMonths: (v: number | null) => void;
  /** ลูกค้าติ๊ก "ฟรีดาวน์" อยู่ */
  freeDown: boolean;
  /** จำนวนเครื่องฟรีดาวน์ตามตัวกรองอื่น */
  freeDownCount: number;
  onFreeDown: (v: boolean) => void;
}

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

/** ตัวกรองสภาพเครื่อง (เกรด) ถูกเอาออกจาก UI — เจ้าของ 2026-11-25 · ป้ายเกรดบนการ์ดยังอยู่ */
const ORIGINS: Array<{ v: DeviceOrigin | undefined; label: string }> = [
  { v: undefined, label: 'ทั้งหมด' },
  { v: 'THAI', label: 'เครื่องไทย' },
  { v: 'IMPORTED', label: 'เครื่องนอก' },
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
  'w-full h-11 rounded-xl border-0 bg-muted px-3.5 text-base md:text-sm text-foreground leading-snug ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-500/50';

const labelCls = 'block text-sm text-muted-foreground mb-2 leading-snug';

interface Props {
  filters: CatalogFilters;
  onChange: (next: CatalogFilters) => void;
  models?: ModelOption[];
  plan?: PlanControls;
  /** ล้างตัวกรองทั้งหมด รวมเงินดาวน์/ฟรีดาวน์ ในครั้งเดียว — ไม่ส่ง = ล้างเฉพาะตัวกรองผ่าน onChange */
  onClearAll?: () => void;
  /** Inside the mobile dialog the panel drops its own chrome. */
  bare?: boolean;
}

export function FilterSidebar({ filters, onChange, models, plan, onClearAll, bare }: Props) {
  const idPrefix = bare ? 'mobile-filter' : 'filter';
  const modelId = `${idPrefix}-model`;
  const active =
    filters.deviceOrigin ||
    filters.condition ||
    filters.model ||
    filters.conditionGrade ||
    filters.minPrice !== undefined ||
    filters.maxPrice !== undefined ||
    (plan != null && (plan.down != null || plan.freeDown));

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
    <div className={cn('font-head space-y-5', bare ? 'pt-1' : 'px-4 pb-5 pt-4')}>
      {/* "ดาวน์เท่าไหร่ ผ่อนเดือนละเท่าไหร่" is the first question in a Thai
          phone shop, so it sits above the filters. */}
      {plan && <PlanBlock plan={plan} bare={bare} />}

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
                  'flex flex-col items-center justify-center gap-2 rounded-2xl px-2 py-4 text-sm leading-snug transition-colors',
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

      <div role="group" aria-labelledby={`${idPrefix}-origin-label`}>
        <span id={`${idPrefix}-origin-label`} className={labelCls}>
          เครื่องไทย / เครื่องนอก
        </span>
        <div className="flex flex-wrap gap-1.5">
          {ORIGINS.map((o) => (
            <Pill
              key={o.label}
              active={filters.deviceOrigin === o.v}
              onClick={() => onChange({ ...filters, deviceOrigin: o.v })}
              className="px-3.5"
            >
              {o.label}
            </Pill>
          ))}
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor={modelId}>
          รุ่น
        </label>
        <NativeSelect wrapperClassName="max-w-full w-full"
          id={modelId}
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
        </NativeSelect>
      </div>

      <div role="group" aria-labelledby={`${idPrefix}-price-label`}>
        <span id={`${idPrefix}-price-label`} className={labelCls}>
          ช่วงราคา
        </span>
        <div className="flex flex-wrap gap-1.5">
          {PRICE_BANDS.map((b) => (
            <Pill
              key={b.id || 'all'}
              active={bandId(filters) === b.id}
              onClick={() => onChange({ ...filters, minPrice: b.min, maxPrice: b.max })}
              className="num px-3.5"
            >
              {b.label}
            </Pill>
          ))}
        </div>
      </div>

      {active && (
        <button
          type="button"
          onClick={() =>
            onClearAll
              ? onClearAll()
              : onChange({
                  search: filters.search,
                  condition: undefined,
                  model: undefined,
                  conditionGrade: undefined,
                  minPrice: undefined,
                  maxPrice: undefined,
                })
          }
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors leading-snug"
        >
          <X className="size-4" aria-hidden />
          {copy.catalog.clearAll}
        </button>
      )}
    </div>
  );

  if (bare) return <div>{body}</div>;

  return (
    <aside className="rounded-[40px] border border-border bg-card shadow-lg">
      <div className="flex items-center gap-2.5 px-4 pt-4">
        <span className="size-7 rounded-xl bg-ink grid place-items-center shrink-0">
          <SlidersHorizontal className="size-4 text-ink-foreground" aria-hidden />
        </span>
        <h2 className="text-base font-semibold text-foreground leading-snug">ตัวกรองสินค้า</h2>
      </div>
      <hr className="mt-3.5 mx-4 border-0 border-t border-border" />
      {body}
    </aside>
  );
}

/** กล่องเงินดาวน์ของตัวกรอง: เงินดาวน์เป็นบาท · ติ๊กฟรีดาวน์ · จำนวนงวด (สเปค 2026-11-25 หัวข้อ 5–6) */
function PlanBlock({ plan, bare }: { plan: PlanControls; bare?: boolean }) {
  const downId = bare ? 'mobile-filter-down' : 'filter-down';
  const monthsId = bare ? 'mobile-filter-months' : 'filter-months';
  return (
    <div className="rounded-2xl bg-emerald-50 p-3.5">
      <DownAmountField
        id={downId}
        hintId={`${downId}-hint`}
        value={plan.down}
        disabled={plan.freeDown}
        onCommit={plan.onDown}
      />
      <p id={`${downId}-hint`} className="mt-1.5 text-xs text-emerald-800/70 leading-snug">
        {plan.freeDown
          ? 'กำลังแสดงเฉพาะเครื่องที่ไม่ต้องวางดาวน์ — เอาติ๊กออกเพื่อตั้งเงินดาวน์เอง'
          : copy.catalog.downHint}
      </p>

      {(plan.freeDownCount > 0 || plan.freeDown) && (
        <label
          className={cn(
            'mt-3 flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-3 text-sm leading-snug',
            plan.freeDown
              ? 'bg-sand-50 font-semibold text-sand-900 ring-1 ring-inset ring-promo/60'
              : 'bg-card text-emerald-900',
          )}
        >
          <input
            type="checkbox"
            checked={plan.freeDown}
            onChange={(e) => plan.onFreeDown(e.target.checked)}
            className="size-5 shrink-0 accent-emerald-600"
          />
          ฟรีดาวน์
          <span className="num ml-auto text-xs font-normal text-muted-foreground">
            {plan.freeDownCount} เครื่อง
          </span>
        </label>
      )}

      {plan.monthsOptions.length > 0 && (
        <div className="mt-3">
          <label
            className="block text-sm text-emerald-900 mb-2 leading-snug"
            htmlFor={monthsId}
          >
            จำนวนงวด
          </label>
          <NativeSelect wrapperClassName="max-w-full w-full"
            id={monthsId}
            className="h-10 rounded-xl border-0 bg-card px-3 text-base md:text-sm text-foreground leading-snug focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            value={plan.months ?? ''}
            disabled={plan.freeDown}
            onChange={(e) => plan.onMonths(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">งวดยาวสุด (ผ่อนถูกที่สุด)</option>
            {plan.monthsOptions.map((m) => (
              <option key={m} value={m}>
                {m} งวด
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
    </div>
  );
}
