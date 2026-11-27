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

/** "มือ" กับเลขติดกันเสมอ (เว้นวรรคแบบไม่ตัดบรรทัด) — แถบแคบ (จอ 1024) ตัดเป็น "iPhone / มือ 1" ไม่ทิ้งเลขโดดบรรทัด */
const NBSP = String.fromCharCode(0xa0);
const DEVICE_TYPES = [
  { v: 'NEW' as const, label: `iPhone มือ${NBSP}1`, Icon: Sparkles },
  { v: 'USED' as const, label: `iPhone มือ${NBSP}2`, Icon: Smartphone },
];

function bandId(f: CatalogFilters): string {
  const hit = PRICE_BANDS.find((b) => b.id !== '' && b.min === f.minPrice && b.max === f.maxPrice);
  return hit?.id ?? '';
}

const selectCls =
  'w-full h-11 rounded-xl border-0 bg-muted px-3.5 text-base md:text-sm text-foreground leading-snug ' +
  'focus:outline-none focus:ring-2 focus:ring-ring/50';

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
    filters.minPrice !== undefined ||
    filters.maxPrice !== undefined ||
    (plan != null && (plan.down != null || plan.freeDown));

  function pickType(v: 'NEW' | 'USED') {
    const next = filters.condition === v ? undefined : v;
    onChange({ ...filters, condition: next });
  }

  const body = (
    <div
      className={cn(
        'font-head space-y-5',
        // แถบข้างติดจอและสูงไม่เกินจอ (CatalogPage) — เนื้อหาเลื่อนในกล่อง หัว "ตัวกรองสินค้า" ค้างอยู่ ·
        // ขอบบน/ล่าง 0.75rem จางลง บอกว่ายังเลื่อนต่อได้ (ระยะ pt-4/pb-4 กว้างกว่า จึงไม่จางทับปุ่มตอนสุดทาง)
        bare
          ? 'pt-1'
          : 'min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4 scrollbar-thin mask-[linear-gradient(to_bottom,transparent,black_0.75rem,black_calc(100%-0.75rem),transparent)]',
      )}
    >
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
                  'flex flex-col items-center justify-center gap-1.5 rounded-2xl px-1.5 py-3 text-center text-sm leading-snug text-balance transition-colors',
                  on
                    ? 'bg-accent text-accent-foreground ring-2 ring-inset ring-primary/45'
                    : 'bg-muted text-muted-foreground hover:bg-zinc-200',
                )}
              >
                <Icon
                  className={cn('size-6', on ? 'text-primary' : 'text-zinc-400')}
                  aria-hidden
                />
                {label}
              </button>
            );
          })}
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

      {/* อยู่ใต้ "รุ่น" (คำสั่งเจ้าของ 2026-11-27) — เลือกรุ่นก่อน แล้วค่อยเลือกไทย/นอก */}
      <div role="group" aria-labelledby={`${idPrefix}-origin-label`}>
        <span id={`${idPrefix}-origin-label`} className={labelCls}>
          เครื่องไทย / เครื่องนอก
        </span>
        {/* แถบข้าง (lg+) แคบเกินวางสามปุ่มแถวเดียว — "ทั้งหมด" เต็มแถว แล้วไทย/นอก คู่กันใต้ลงไป */}
        <div className="flex flex-wrap gap-1.5 lg:grid lg:grid-cols-2">
          {ORIGINS.map((o) => (
            <Pill
              key={o.label}
              active={filters.deviceOrigin === o.v}
              onClick={() => onChange({ ...filters, deviceOrigin: o.v })}
              className={cn('px-3.5 lg:w-full lg:px-2', o.v === undefined && 'lg:col-span-2')}
            >
              {o.label}
            </Pill>
          ))}
        </div>
      </div>

      <div role="group" aria-labelledby={`${idPrefix}-price-label`}>
        <span id={`${idPrefix}-price-label`} className={labelCls}>
          ช่วงราคา
        </span>
        {/* แถบข้าง (lg+) — ช่วงละแถว กว้างเท่ากัน แทนปุ่มยาวไม่เท่ากันที่ตกบรรทัดเป็นขั้นบันได */}
        <div className="flex flex-wrap gap-1.5 lg:grid lg:grid-cols-1">
          {PRICE_BANDS.map((b) => (
            <Pill
              key={b.id || 'all'}
              active={bandId(filters) === b.id}
              onClick={() => onChange({ ...filters, minPrice: b.min, maxPrice: b.max })}
              className="num px-3.5 lg:w-full"
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
    // min-h-0: ให้กล่องหดตามความสูงจอของคอลัมน์ได้ (ค่าตั้งต้นของ flex ไม่ยอมหดต่ำกว่าเนื้อหา) ·
    // pb-3: เนื้อหาที่เลื่อนอยู่ไม่ถูกมุมโค้ง 40px ตัด
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-[40px] border border-border bg-card pb-3 shadow-lg">
      <div className="flex shrink-0 items-center gap-2.5 px-4 pt-4">
        <span className="size-7 rounded-xl bg-ink grid place-items-center shrink-0">
          <SlidersHorizontal className="size-4 text-ink-foreground" aria-hidden />
        </span>
        <h2 className="text-base font-semibold text-foreground leading-snug">ตัวกรองสินค้า</h2>
      </div>
      <hr className="mt-3.5 mx-4 shrink-0 border-0 border-t border-border" />
      {body}
    </aside>
  );
}

/** กล่องเงินดาวน์ของตัวกรอง: เงินดาวน์เป็นบาท · ติ๊กฟรีดาวน์ · จำนวนงวด (สเปค 2026-11-25 หัวข้อ 5–6) */
function PlanBlock({ plan, bare }: { plan: PlanControls; bare?: boolean }) {
  const downId = bare ? 'mobile-filter-down' : 'filter-down';
  const monthsId = bare ? 'mobile-filter-months' : 'filter-months';
  return (
    <div className="rounded-2xl bg-muted p-3.5">
      <DownAmountField
        id={downId}
        hintId={`${downId}-hint`}
        value={plan.down}
        disabled={plan.freeDown}
        onCommit={plan.onDown}
      />
      <p id={`${downId}-hint`} className="mt-1.5 text-xs text-muted-foreground leading-snug">
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
              : 'bg-card text-foreground',
          )}
        >
          <input
            type="checkbox"
            checked={plan.freeDown}
            onChange={(e) => plan.onFreeDown(e.target.checked)}
            className="size-5 shrink-0 accent-primary"
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
            className="block text-sm text-foreground mb-2 leading-snug"
            htmlFor={monthsId}
          >
            จำนวนงวด
          </label>
          <NativeSelect wrapperClassName="max-w-full w-full"
            id={monthsId}
            className="h-10 rounded-xl border-0 bg-card px-3 text-base md:text-sm text-foreground leading-snug focus:outline-none focus:ring-2 focus:ring-ring/50"
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
