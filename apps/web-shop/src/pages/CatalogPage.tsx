import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { SlidersHorizontal, ChevronDown, X, Banknote, CalendarClock } from '@/lib/icons';
import ShopLayout from '@/components/layout/ShopLayout';
import {
  FilterSidebar,
  type CatalogFilters,
  type ModelOption,
} from '@/components/catalog/FilterSidebar';
import { WaitlistCard } from '@/components/catalog/WaitlistCard';
import { CatalogResults } from '@/components/catalog/CatalogResults';
import { Pill } from '@/components/catalog/Pill';
import { DownAmountField } from '@/components/catalog/DownAmountField';
import {
  Container,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  type ProductGroup,
} from '@/components';
import { api } from '@/lib/api';
import { copy } from '@/lib/copy';
import { usePageMeta } from '@/hooks/usePageMeta';
import { cn } from '@/lib/utils';
import { deviceOriginLabel, parseDeviceOrigin } from '@/lib/device-origin';
import { buildCatalogParams, parseDownParam } from './catalog-params';

interface CatalogResponse {
  data: ProductGroup[];
  total: number;
  page: number;
  limit: number;
  /** Tenures the rate table allows. */
  monthsOptions: number[];
  /** จำนวนเครื่องฟรีดาวน์ตามตัวกรองอื่น. ไม่มีใน API รุ่นเก่า. */
  freeDownCount?: number;
  /** สถานะ ②: จำนวนเครื่องที่ต้องดาวน์มากกว่าเงินที่ใส่. ไม่มีใน API รุ่นเก่า. */
  overBudgetCount?: number;
  /** เงินดาวน์น้อยสุดที่ทำให้เครื่องถัดไปขึ้น. ไม่มีใน API รุ่นเก่า. */
  nextDownFrom?: number | null;
}

const CONDITIONS: Array<{ v: '' | 'NEW' | 'USED'; label: string }> = [
  { v: '', label: 'ทั้งหมด' },
  { v: 'NEW', label: 'มือ 1' },
  { v: 'USED', label: 'มือ 2' },
];

/** สด/ผ่อน — flips which number leads on every card. Installment is the
    shop's main business, so it is the default view. */
type PriceMode = 'cash' | 'installment';
const PRICE_MODES: Array<{ v: PriceMode; label: string; icon: typeof Banknote }> = [
  { v: 'installment', label: 'ผ่อน', icon: CalendarClock },
  { v: 'cash', label: 'ซื้อสด', icon: Banknote },
];

const SORTS: Array<{ v: string; label: string }> = [
  { v: 'popular', label: 'รุ่นใหม่ → เก่า' },
  { v: 'newest', label: 'ใหม่ล่าสุด' },
  { v: 'price_asc', label: 'ราคา ต่ำ → สูง' },
  { v: 'price_desc', label: 'ราคา สูง → ต่ำ' },
];

export default function CatalogPage() {
  // หัวข้อในผลค้นหามีคำที่คนค้น (เจ้าของเลือก 27 พ.ย. 2569) · ชื่อเมนู/breadcrumb ยังเป็น "สินค้าทั้งหมด"
  usePageMeta(
    'iPhone มือ 1 และมือสอง ผ่อนบัตรประชาชนใบเดียว',
    'iPhone มือ 1 และมือสอง ตรวจ 30 จุด ผ่อนบัตรประชาชนใบเดียว ร้านมือถือลพบุรี',
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<CatalogFilters>(() => ({
    deviceOrigin: parseDeviceOrigin(searchParams.get('deviceOrigin')),
    condition: (searchParams.get('condition') as 'NEW' | 'USED' | null) ?? undefined,
    model: searchParams.get('model') ?? undefined,
    search: searchParams.get('search') ?? undefined,
  }));
  const [sort, setSort] = useState<string>('popular');
  const [months, setMonths] = useState<number | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const sortBtnRef = useRef<HTMLButtonElement>(null);

  const { data: models } = useQuery<ModelOption[]>({
    queryKey: ['shop', 'models'],
    queryFn: () => api.get('/api/shop/models').then((r) => r.data),
  });

  // The header search submits to /products?search=… — also while already on
  // this page, so keep listening to URL changes after the initial state.
  useEffect(() => {
    const condition = (searchParams.get('condition') as 'NEW' | 'USED' | null) ?? undefined;
    const search = searchParams.get('search') ?? undefined;
    const model = searchParams.get('model') ?? undefined;
    const deviceOrigin = parseDeviceOrigin(searchParams.get('deviceOrigin'));
    setFilters((f) =>
      f.condition === condition &&
      f.search === search &&
      f.model === model &&
      f.deviceOrigin === deviceOrigin
        ? f
        : { ...f, condition, search, model, deviceOrigin },
    );
  }, [searchParams]);

  // ทุกตัวเขียน URL เริ่มจากพารามิเตอร์ล่าสุดที่เขียนไปแล้ว ไม่ใช่ closure ของ render —
  // react-router ใช้ startTransition จึงค้างค่าเก่า: blur (commit ?down=) แล้วคลิกปุ่มกรองอื่น
  // ใน task เดียวกันจะเขียนทับกัน
  const latestParams = useRef(searchParams);
  useEffect(() => {
    latestParams.current = searchParams;
  }, [searchParams]);
  function writeParams(mutate: (sp: URLSearchParams) => void) {
    const sp = new URLSearchParams(latestParams.current);
    mutate(sp);
    latestParams.current = sp;
    setSearchParams(sp, { replace: true });
  }

  // Single write path: keep condition+search mirrored into the URL so header
  // search, pill clicks, and deep links never fight over the state.
  function updateFilters(next: CatalogFilters) {
    setFilters(next);
    writeParams((sp) => {
      if (next.deviceOrigin) sp.set('deviceOrigin', next.deviceOrigin);
      else sp.delete('deviceOrigin');
      if (next.condition) sp.set('condition', next.condition);
      else sp.delete('condition');
      if (next.model) sp.set('model', next.model);
      else sp.delete('model');
      if (next.search) sp.set('search', next.search);
      else sp.delete('search');
    });
  }

  function clearSearch() {
    updateFilters({ ...filters, search: undefined });
  }

  // ล้างตัวกรอง + เงินดาวน์ + ติ๊กฟรีดาวน์ ด้วยการเขียน URL ครั้งเดียว (คำค้นหาและโหมดราคายังอยู่)
  function clearAllFilters() {
    setFilters({ search: filters.search });
    writeParams((sp) => {
      for (const key of ['deviceOrigin', 'condition', 'model', 'down', 'freeDown']) sp.delete(key);
    });
  }

  // Derived straight from the URL (no shadow state) — updateFilters copies the
  // existing params, so the mode survives every filter/search change and a
  // shared link opens in the same view.
  const priceMode: PriceMode = searchParams.get('mode') === 'cash' ? 'cash' : 'installment';
  function setPriceMode(next: PriceMode) {
    writeParams((sp) => {
      if (next === 'cash') {
        sp.set('mode', 'cash');
        // เงินดาวน์และฟรีดาวน์เป็นเรื่องผ่อนอย่างเดียว
        sp.delete('freeDown');
        sp.delete('down');
      } else sp.delete('mode');
    });
  }

  // เงินดาวน์ (บาท) และฟรีดาวน์อยู่ใน URL เหมือนโหมดราคา — ลิงก์โฆษณา/ลิงก์แชร์เปิดมาในสถานะเดียวกันได้
  const rawDown = priceMode === 'installment' ? parseDownParam(searchParams.get('down')) : null;
  // พิมพ์ 0 = ติ๊กฟรีดาวน์ · ฟรีดาวน์ชนะเงินดาวน์ (กติกาเดียวกับ API)
  const freeDown =
    priceMode === 'installment' && (searchParams.get('freeDown') === '1' || rawDown === 0);
  const down = freeDown ? null : rawDown;
  // เขียน URL ครั้งเดียวต่อการกระทำ — setSearchParams ไม่ต่อคิวกัน
  function setDown(next: number | null) {
    writeParams((sp) => {
      sp.delete('down');
      if (next === 0) sp.set('freeDown', '1');
      else if (next != null) sp.set('down', String(next));
    });
  }
  function setFreeDown(next: boolean) {
    // ติ๊ก = ไม่มีเงินดาวน์ · เอาติ๊กออก = กลับสถานะไม่ใส่อะไร (สเปคหัวข้อ 5)
    writeParams((sp) => {
      sp.delete('down');
      if (next) sp.set('freeDown', '1');
      else sp.delete('freeDown');
    });
  }
  // ช่องเงินดาวน์ commit ตอนออกจากช่อง / กด Enter แล้วหน่วง 250ms ก่อนเปลี่ยนคำขอ · ล้างค่ามีผลทันที
  const [committedDown, setCommittedDown] = useState<number | null>(down);
  useEffect(() => {
    if (down == null) {
      setCommittedDown(null);
      return;
    }
    const t = setTimeout(() => setCommittedDown(down), 250);
    return () => clearTimeout(t);
  }, [down]);
  // ค่าที่ใช้กับคำขอและการ์ด — มีเฉพาะสถานะ ② (โหมดผ่อน · ไม่ได้ติ๊กฟรีดาวน์)
  const activeDown = priceMode === 'installment' && !freeDown ? committedDown : null;

  // Close sort menu on Escape; return focus to the trigger.
  useEffect(() => {
    if (!sortOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setSortOpen(false);
        sortBtnRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sortOpen]);

  const {
    data,
    isLoading,
    isError,
    isFetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<CatalogResponse>({
    queryKey: ['shop', 'catalog', filters, sort, activeDown, months, freeDown],
    queryFn: ({ pageParam }) => {
      const params = buildCatalogParams({
        filters,
        sort,
        downAmount: activeDown,
        months,
        freeDown,
        page: pageParam as number,
      });
      return api.get(`/api/shop/products?${params}`).then((r) => r.data);
    },
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
  });

  const groups = data?.pages.flatMap((p) => p.data);
  const first = data?.pages[0];
  const total = first?.total ?? 0;
  // ตัวควบคุมแผนผ่อน (งวด · ช่องฟรีดาวน์) ต้องไม่หายระหว่างโหลดรายการใหม่ —
  // จำค่าล่าสุดจากหน้าแรกที่เคยได้ แล้วอ่านจากนั้นตอน data ยังเป็น undefined
  // (ห้ามใช้ keepPreviousData: การ์ดเก่าจะค้างใต้ตัวกรองใหม่)
  const lastMeta = useRef<{
    monthsOptions: number[];
    freeDownCount: number;
    freeDownSupported: boolean;
    overBudgetCount: number;
    overBudgetSupported: boolean;
    nextDownFrom: number | null;
  } | null>(null);
  if (first) {
    lastMeta.current = {
      monthsOptions: first.monthsOptions ?? [],
      freeDownCount: first.freeDownCount ?? 0,
      freeDownSupported: first.freeDownCount !== undefined,
      overBudgetCount: first.overBudgetCount ?? 0,
      overBudgetSupported: first.overBudgetCount !== undefined,
      nextDownFrom: first.nextDownFrom ?? null,
    };
  }
  const monthsOptions = lastMeta.current?.monthsOptions ?? [];
  const freeDownCount = lastMeta.current?.freeDownCount ?? 0;
  const overBudgetCount = lastMeta.current?.overBudgetCount ?? 0;
  const nextDownFrom = lastMeta.current?.nextDownFrom ?? null;
  // API รุ่นเก่าไม่ส่ง overBudgetCount และไม่รู้จัก downAmount — อย่าบอกลูกค้าว่ากรองด้วยเงินที่ใส่
  const downSupported = lastMeta.current?.overBudgetSupported ?? false;
  // API รุ่นเก่าไม่ส่ง freeDownCount และไม่รู้จักตัวกรอง — อย่าให้การ์ดขึ้นโหมดฟรีดาวน์ล้วน
  const freeDownOnly = freeDown && (lastMeta.current?.freeDownSupported ?? false);
  const showFreeDown = priceMode === 'installment' && (freeDownCount > 0 || freeDown);

  const plan = {
    down,
    months,
    monthsOptions,
    onDown: setDown,
    onMonths: setMonths,
    freeDown,
    freeDownCount,
    onFreeDown: setFreeDown,
  };
  const activeCondition = filters.condition ?? '';
  const activeSortLabel = SORTS.find((s) => s.v === sort)?.label ?? '';

  return (
    // ปุ่มแชทลอยสีส้มขึ้นบนมือถือด้วย เหมือนหน้าอื่น (ส่วน B2 — เดิมหน้านี้ซ่อนบนมือถือ)
    <ShopLayout>
      <Container className="py-3 md:py-6">
        {/* Hero plate — เตี้ยลง (ส่วน B2) ให้การ์ดแถวแรกพร้อมราคาขึ้นในจอแรกของมือถือ ·
            พื้นไล่จาก mint-tint ไปขาว · บรรทัดที่สองเขียวเข้ม · ไอคอนมือถือโทนเขียว (ส่วน A3) */}
        <section className="rounded-3xl md:rounded-[40px] bg-linear-to-br from-mint-tint to-white px-4 py-3 sm:px-6 sm:py-5 md:px-10 md:py-8 shadow-sm border border-border">
          <div className="flex items-center gap-6 md:gap-10">
            <div className="hidden sm:block shrink-0">
              <svg width="96" height="96" viewBox="0 0 118 118" aria-hidden="true">
                <rect x="30" y="10" width="58" height="98" rx="13" fill="var(--color-brand-green)" />
                <rect x="35" y="15" width="48" height="88" rx="9" fill="var(--color-mint-tint)" />
                <rect x="41" y="21" width="21" height="21" rx="7" fill="var(--color-brand-mint)" />
                <circle cx="47" cy="27" r="3.6" fill="var(--color-brand-green-dark)" />
                <circle cx="56" cy="36" r="3.6" fill="var(--color-brand-green-dark)" />
                <rect
                  x="49"
                  y="16.5"
                  width="10"
                  height="3.4"
                  rx="1.7"
                  fill="var(--color-brand-green-dark)"
                />
                <path
                  d="M41 84h36"
                  stroke="var(--color-brand-green)"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
                <path
                  d="M41 92h22"
                  stroke="var(--color-brand-mint)"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div>
              <h1 className="font-display text-xl sm:text-3xl md:text-4xl font-bold text-primary leading-snug">
                รวม iPhone มือ 1 และมือสอง
                <br />
                <span className="text-brand-green-dark">คัดแล้ว ผ่อนได้บัตรเดียว</span>
              </h1>
              <p className="mt-1 sm:mt-3 text-xs sm:text-sm md:text-base text-muted-foreground leading-snug">
                ตรวจ 30 จุด · มือสองรับประกันร้าน 60 วัน · ไม่ติด iCloud ทุกเครื่อง
              </p>
            </div>
          </div>
        </section>

        <div
          id="catalog"
          className="grid lg:grid-cols-[18rem_minmax(0,1fr)] gap-4 md:gap-6 mt-4 md:mt-6"
        >
          {/* Sidebar — desktop only (mobile uses the dialog). One scroll for the whole page:
              the filter box never scrolls inside itself (owner 2026-11-27 — two scrollbars side by
              side were hard to use). Fixed 18rem so paired buttons fit at every desktop width.
              It stays pinned under the header only when the screen is tall enough to show all of
              it (~790px tall + top-20): pinned and taller than the screen would hide the price
              buttons until the end of the list. Shorter screens let it scroll away with the page.
              Raise the min-height below if the panel grows. */}
          <div className="hidden lg:block lg:self-start [@media(min-height:57rem)]:lg:sticky lg:top-20">
            <FilterSidebar
              filters={filters}
              onChange={updateFilters}
              onClearAll={clearAllFilters}
              models={models}
              plan={priceMode === 'installment' ? plan : undefined}
            />
          </div>

          <div className="min-w-0">
            {filters.deviceOrigin && (
              <button
                type="button"
                onClick={() => updateFilters({ ...filters, deviceOrigin: undefined })}
                aria-label={`ล้างตัวกรอง${deviceOriginLabel(filters.deviceOrigin)}`}
                className="mb-3 min-h-11 inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1.5 font-head text-sm text-accent-foreground"
              >
                {deviceOriginLabel(filters.deviceOrigin)}
                <X className="size-4" aria-hidden />
              </button>
            )}
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {/* สด/ผ่อน — a view switch, not a filter, so it gets a distinct
                  segmented look: mint track, white active thumb. The filter
                  chips next to it stay white-with-border / solid-green. */}
              <div
                role="group"
                aria-label="รูปแบบราคา"
                className="flex w-full sm:w-auto rounded-full bg-muted p-0.5 ring-1 ring-inset ring-border/70"
              >
                {PRICE_MODES.map((m) => {
                  const Icon = m.icon;
                  const active = priceMode === m.v;
                  return (
                    <button
                      key={m.v}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setPriceMode(m.v)}
                      className={cn(
                        'min-h-11 flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-1 font-head text-sm rounded-full leading-snug whitespace-nowrap transition-[color,background-color,box-shadow]',
                        active
                          ? 'bg-white text-primary font-semibold shadow-sm'
                          : 'font-medium text-zinc-600 hover:text-primary',
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                      {m.label}
                    </button>
                  );
                })}
              </div>

              {/* มือถือไม่มีแถบข้าง — ใส่เงินดาวน์ / ติ๊กฟรีดาวน์ได้เลยโดยไม่ต้องเปิดแผงตัวกรอง (สเปคหัวข้อ 6) */}
              {priceMode === 'installment' && (
                <div data-mobile-plan className="flex w-full flex-wrap items-center gap-2 lg:hidden">
                  <DownAmountField
                    id="toolbar-down"
                    variant="pill"
                    value={down}
                    disabled={freeDown}
                    onCommit={setDown}
                  />
                  {showFreeDown && (
                    <label
                      className={cn(
                        'inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full px-3 font-head text-sm leading-snug whitespace-nowrap',
                        freeDown
                          ? 'bg-sand-50 font-semibold text-sand-900 ring-1 ring-inset ring-promo/60'
                          : 'bg-card text-accent-foreground ring-1 ring-inset ring-border',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={freeDown}
                        onChange={(e) => setFreeDown(e.target.checked)}
                        className="size-4 shrink-0 accent-primary"
                      />
                      ฟรีดาวน์
                      <span className="num text-xs font-normal text-muted-foreground">
                        {freeDownCount}
                      </span>
                    </label>
                  )}
                </div>
              )}

              <div className="flex lg:hidden gap-2">
                {CONDITIONS.map((c) => (
                  <Pill
                    key={c.v || 'all'}
                    active={activeCondition === c.v}
                    onClick={() =>
                      updateFilters({
                        ...filters,
                        condition: c.v || undefined,
                        // มือ 1 ไม่มีเกรดตำหนิ — ล้างตัวกรองเกรดทิ้ง
                        conditionGrade: c.v === 'NEW' ? undefined : filters.conditionGrade,
                      })
                    }
                  >
                    {c.label}
                  </Pill>
                ))}
              </div>

              <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className="min-h-11 lg:hidden inline-flex items-center gap-1.5 px-4 py-1.5 font-head text-sm rounded-full bg-card text-foreground ring-1 ring-inset ring-border leading-snug"
                  >
                    <SlidersHorizontal className="size-4" aria-hidden />
                    ตัวกรอง
                  </button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>ตัวกรองสินค้า</DialogTitle>
                    <DialogDescription className="sr-only">
                      เลือกเงื่อนไขเพื่อกรองรายการสินค้า
                    </DialogDescription>
                  </DialogHeader>
                  <FilterSidebar
                    filters={filters}
                    onChange={updateFilters}
                    onClearAll={clearAllFilters}
                    models={models}
                    plan={priceMode === 'installment' ? plan : undefined}
                    bare
                  />
                </DialogContent>
              </Dialog>

              {filters.search && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="min-h-11 inline-flex items-center gap-1.5 px-3 py-1.5 font-head text-sm rounded-full bg-accent text-accent-foreground hover:bg-navy-200 transition-colors leading-snug"
                >
                  ค้นหา: “{filters.search}”
                  <X className="size-4" aria-label="ล้างคำค้นหา" />
                </button>
              )}

              <div className="hidden sm:block flex-1" />

              {/* Sort dropdown — listbox semantics for screen readers + ESC to
                 close (handled by effect). Outside-click closes via overlay. */}
              <div className="relative">
                <button
                  ref={sortBtnRef}
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={sortOpen}
                  onClick={() => setSortOpen((o) => !o)}
                  className="min-h-11 flex items-center gap-1.5 px-4 py-1.5 font-head text-sm rounded-full bg-card text-foreground ring-1 ring-inset ring-border hover:ring-foreground/25 transition-shadow leading-snug"
                >
                  <span className="text-muted-foreground">เรียง:</span>
                  <span>{activeSortLabel}</span>
                  <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
                </button>
                {sortOpen && (
                  <>
                    <button
                      type="button"
                      aria-label="ปิดเมนูเรียง"
                      tabIndex={-1}
                      className="fixed inset-0 z-10"
                      onClick={() => setSortOpen(false)}
                    />
                    <ul
                      role="listbox"
                      aria-label="เรียงโดย"
                      className="absolute right-0 mt-2 w-52 bg-card border border-border rounded-2xl shadow-xl z-20 py-1.5 overflow-hidden"
                    >
                      {SORTS.map((s) => {
                        const selected = sort === s.v;
                        return (
                          <li key={s.v}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={selected}
                              onClick={() => {
                                setSort(s.v);
                                setSortOpen(false);
                                sortBtnRef.current?.focus();
                              }}
                              className={cn(
                                'min-h-11 sm:min-h-0 block w-full text-left px-3.5 py-2 font-head text-sm leading-snug',
                                selected
                                  ? 'text-accent-foreground font-medium bg-accent'
                                  : 'text-foreground hover:bg-muted',
                              )}
                            >
                              {s.label}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </div>
            </div>

            <CatalogResults
              products={groups}
              total={total}
              loading={isLoading}
              error={isError}
              updating={isFetching}
              resultKey={JSON.stringify([filters, sort, activeDown, months, freeDown])}
              priceMode={priceMode}
              freeDownOnly={freeDownOnly}
              down={downSupported ? activeDown : null}
              hasMore={hasNextPage}
              overBudgetCount={overBudgetCount}
              nextDownFrom={nextDownFrom}
              freeDownCount={freeDownCount}
              onClearDown={() => setDown(null)}
              onShowFreeDown={() => setFreeDown(true)}
              onRetry={() => refetch()}
            />

            {hasNextPage && (
              <div className="flex justify-center mt-8 md:mt-10">
                <button
                  type="button"
                  disabled={isFetchingNextPage}
                  onClick={() => fetchNextPage()}
                  className="h-11 px-8 rounded-full bg-card ring-1 ring-inset ring-border text-sm font-medium hover:ring-foreground/25 transition-shadow disabled:opacity-50 leading-snug"
                >
                  {isFetchingNextPage ? copy.common.loading : 'โหลดเพิ่ม'}
                </button>
              </div>
            )}

            {/* Waitlist block at the end of the list — "didn't find the model?" comes
                after browsing, and keeps the sticky filter column free for filters. */}
            <div className="mt-6 lg:mx-auto lg:mt-10 lg:max-w-md">
              <WaitlistCard />
            </div>
          </div>
        </div>
      </Container>
    </ShopLayout>
  );
}
