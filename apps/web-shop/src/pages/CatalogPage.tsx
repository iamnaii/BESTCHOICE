import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { Search, SlidersHorizontal, ChevronDown, X } from 'lucide-react';
import ShopLayout from '@/components/layout/ShopLayout';
import {
  FilterSidebar,
  type CatalogFilters,
  type ModelOption,
} from '@/components/catalog/FilterSidebar';
import { WaitlistCard } from '@/components/catalog/WaitlistCard';
import {
  Container,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  StatefulList,
  ProductCard,
  type ProductGroup,
} from '@/components';
import { api } from '@/lib/api';
import { copy } from '@/lib/copy';
import { useTrackEvent } from '@/hooks/useTrackEvent';
import { usePageMeta } from '@/hooks/usePageMeta';
import { cn } from '@/lib/utils';

interface CatalogResponse {
  data: ProductGroup[];
  total: number;
  page: number;
  limit: number;
  /** Floor for the down-payment slider — the API refuses to quote below it. */
  minDownPct: number | null;
  /** Tenures the rate table allows. */
  monthsOptions: number[];
}

const CONDITIONS: Array<{ v: '' | 'NEW' | 'USED'; label: string }> = [
  { v: '', label: 'ทั้งหมด' },
  { v: 'NEW', label: 'มือ 1' },
  { v: 'USED', label: 'มือ 2' },
];

const SORTS: Array<{ v: string; label: string }> = [
  { v: 'popular', label: 'รุ่นใหม่ → เก่า' },
  { v: 'newest', label: 'ใหม่ล่าสุด' },
  { v: 'price_asc', label: 'ราคา ต่ำ → สูง' },
  { v: 'price_desc', label: 'ราคา สูง → ต่ำ' },
];

interface PillProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function Pill({ active, onClick, children }: PillProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'px-4 py-1.5 text-[13px] rounded-full transition-colors leading-snug whitespace-nowrap',
        active
          ? 'bg-ink text-ink-foreground'
          : 'bg-card text-muted-foreground ring-1 ring-inset ring-border hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

export default function CatalogPage() {
  usePageMeta(
    'สินค้าทั้งหมด',
    'iPhone มือ 1 และมือสอง ตรวจ 30 จุด ผ่อนบัตรประชาชนใบเดียว ร้านมือถือลพบุรี',
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<CatalogFilters>(() => ({
    condition: (searchParams.get('condition') as 'NEW' | 'USED' | null) ?? undefined,
    model: searchParams.get('model') ?? undefined,
    search: searchParams.get('search') ?? undefined,
  }));
  const [sort, setSort] = useState<string>('popular');
  // null = "not chosen yet", so the first response's minimum can seed it without
  // fighting a value the shopper actually picked.
  const [downPct, setDownPct] = useState<number | null>(null);
  const [months, setMonths] = useState<number | null>(null);
  // The range input fires on every pixel of a drag; refetching that often would
  // hammer the API for figures nobody reads. Commit shortly after they stop.
  const [committedDown, setCommittedDown] = useState<number | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const sortBtnRef = useRef<HTMLButtonElement>(null);
  const track = useTrackEvent();

  const { data: models } = useQuery<ModelOption[]>({
    queryKey: ['shop', 'models'],
    queryFn: () => api.get('/api/shop/models').then((r) => r.data),
  });

  useEffect(() => {
    track('ViewContent', { content_type: 'catalog' });
  }, [track]);

  useEffect(() => {
    const t = setTimeout(() => setCommittedDown(downPct), 250);
    return () => clearTimeout(t);
  }, [downPct]);

  // The header search submits to /products?search=… — also while already on
  // this page, so keep listening to URL changes after the initial state.
  useEffect(() => {
    const condition = (searchParams.get('condition') as 'NEW' | 'USED' | null) ?? undefined;
    const search = searchParams.get('search') ?? undefined;
    const model = searchParams.get('model') ?? undefined;
    setFilters((f) =>
      f.condition === condition && f.search === search && f.model === model
        ? f
        : { ...f, condition, search, model },
    );
  }, [searchParams]);

  // Single write path: keep condition+search mirrored into the URL so header
  // search, pill clicks, and deep links never fight over the state.
  function updateFilters(next: CatalogFilters) {
    setFilters(next);
    const sp = new URLSearchParams(searchParams);
    if (next.condition) sp.set('condition', next.condition);
    else sp.delete('condition');
    if (next.model) sp.set('model', next.model);
    else sp.delete('model');
    if (next.search) sp.set('search', next.search);
    else sp.delete('search');
    setSearchParams(sp, { replace: true });
  }

  function clearSearch() {
    updateFilters({ ...filters, search: undefined });
  }

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

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery<CatalogResponse>({
      queryKey: ['shop', 'catalog', filters, sort, committedDown, months],
      queryFn: ({ pageParam }) => {
        const params = new URLSearchParams();
        if (filters.condition) params.set('condition', filters.condition);
        if (filters.model) params.set('model', filters.model);
        if (filters.conditionGrade) params.set('conditionGrade', filters.conditionGrade);
        if (filters.minPrice !== undefined) params.set('minPrice', String(filters.minPrice));
        if (filters.maxPrice !== undefined) params.set('maxPrice', String(filters.maxPrice));
        if (filters.search) params.set('search', filters.search);
        params.set('sort', sort);
        if (committedDown != null) params.set('downPct', String(committedDown));
        if (months != null) params.set('months', String(months));
        params.set('page', String(pageParam));
        return api.get(`/api/shop/products?${params}`).then((r) => r.data);
      },
      initialPageParam: 1,
      getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
    });

  const groups = data?.pages.flatMap((p) => p.data);
  const first = data?.pages[0];
  const total = first?.total ?? 0;
  const minDownPct = first?.minDownPct ?? null;
  const monthsOptions = first?.monthsOptions ?? [];

  // Seed the slider from the API's floor the first time we learn it.
  useEffect(() => {
    if (minDownPct != null && downPct == null) {
      setDownPct(minDownPct);
      setCommittedDown(minDownPct);
    }
  }, [minDownPct, downPct]);

  const plan =
    minDownPct != null
      ? {
          downPct: downPct ?? minDownPct,
          months,
          minDownPct,
          monthsOptions,
          onDownPct: setDownPct,
          onMonths: setMonths,
        }
      : undefined;
  const activeCondition = filters.condition ?? '';
  const activeSortLabel = SORTS.find((s) => s.v === sort)?.label ?? '';

  return (
    <ShopLayout>
      <Container className="py-4 md:py-6">
        {/* Hero plate — a white card on the tinted canvas, same family as the
            product cards rather than a full-bleed band. */}
        <section className="rounded-[28px] md:rounded-[40px] bg-card px-6 py-8 md:px-10 md:py-11 shadow-md">
          <div className="flex items-center gap-6 md:gap-10">
            <div className="hidden sm:block shrink-0">
              <svg width="112" height="112" viewBox="0 0 118 118" aria-hidden="true">
                <rect x="30" y="10" width="58" height="98" rx="13" fill="var(--color-zinc-200)" />
                <rect x="35" y="15" width="48" height="88" rx="9" fill="var(--color-zinc-100)" />
                <rect x="41" y="21" width="21" height="21" rx="7" fill="var(--color-zinc-300)" />
                <circle cx="47" cy="27" r="3.6" fill="var(--color-zinc-400)" />
                <circle cx="56" cy="36" r="3.6" fill="var(--color-zinc-400)" />
                <rect x="49" y="16.5" width="10" height="3.4" rx="1.7" fill="var(--color-zinc-300)" />
                <path
                  d="M41 84h36"
                  stroke="var(--color-emerald-500)"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
                <path
                  d="M41 92h22"
                  stroke="var(--color-zinc-300)"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div>
              <h1 className="font-display text-[26px] sm:text-3xl md:text-4xl font-bold tracking-tight text-foreground leading-snug">
                รวม iPhone มือ 1 และมือสอง
                <br />
                <span className="text-primary">คัดแล้ว ผ่อนได้บัตรเดียว</span>
              </h1>
              <p className="mt-3 text-[13.5px] md:text-[15px] text-muted-foreground leading-snug">
                ตรวจ 30 จุด · รับประกันร้าน 30 วัน · ไม่ติด iCloud ทุกเครื่อง
              </p>
            </div>
          </div>
        </section>

        <div id="catalog" className="grid lg:grid-cols-4 gap-4 md:gap-6 mt-4 md:mt-6">
          {/* Sidebar — sticky on desktop, replaced by a dialog on mobile. */}
          <div className="hidden lg:flex lg:flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
            <FilterSidebar
              filters={filters}
              onChange={updateFilters}
              models={models}
              plan={plan}
            />
            <WaitlistCard />
          </div>

          <div className="lg:col-span-3 min-w-0">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
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
                    className="lg:hidden inline-flex items-center gap-1.5 px-4 py-1.5 text-[13px] rounded-full bg-card text-foreground ring-1 ring-inset ring-border leading-snug"
                  >
                    <SlidersHorizontal className="size-3.5" aria-hidden />
                    ตัวกรอง
                  </button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>ตัวกรองสินค้า</DialogTitle>
                  </DialogHeader>
                  <FilterSidebar
                    filters={filters}
                    onChange={updateFilters}
                    models={models}
                    plan={plan}
                    bare
                  />
                </DialogContent>
              </Dialog>

              {filters.search && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors leading-snug"
                >
                  ค้นหา: “{filters.search}”
                  <X className="size-3.5" aria-label="ล้างคำค้นหา" />
                </button>
              )}

              <span className="hidden sm:block text-[13px] text-muted-foreground leading-snug">
                {total > 0 ? `พร้อมจัด ${total} รุ่น` : ''}
              </span>

              <div className="flex-1" />

              {/* Sort dropdown — listbox semantics for screen readers + ESC to
                 close (handled by effect). Outside-click closes via overlay. */}
              <div className="relative">
                <button
                  ref={sortBtnRef}
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={sortOpen}
                  onClick={() => setSortOpen((o) => !o)}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-[13px] rounded-full bg-card text-foreground ring-1 ring-inset ring-border hover:ring-foreground/25 transition-shadow leading-snug"
                >
                  <span className="text-muted-foreground">เรียง:</span>
                  <span>{activeSortLabel}</span>
                  <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
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
                                'block w-full text-left px-3.5 py-2 text-[13px] leading-snug',
                                selected
                                  ? 'text-emerald-700 font-medium bg-emerald-50'
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

            <StatefulList<ProductGroup>
              isLoading={isLoading}
              isError={isError}
              data={groups}
              loadingVariant="card-grid"
              onRetry={() => refetch()}
              emptyState={{
                icon: <Search className="size-12" />,
                title: copy.catalog.emptyTitle,
                description: copy.catalog.emptyDescription,
              }}
              wrapperClassName="grid grid-cols-2 lg:grid-cols-3 gap-2.5 md:gap-3"
              renderItem={(p) => <ProductCard key={p.id} product={p} />}
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

            {/* Mobile gets the waitlist block at the end of the list instead of
                in a sidebar it does not have. */}
            <div className="lg:hidden mt-6">
              <WaitlistCard />
            </div>
          </div>
        </div>
      </Container>
    </ShopLayout>
  );
}
